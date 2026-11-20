import { translate, type TranslationMessage } from '../../i18n/index.js'
import { canStreamNatively, openNativeStream, StreamHttpError } from './nativeStream.js'
import { readMessageEvent } from './parseEvent.js'
import { readServerSentEvents, ServerSentEventDecoder, type ServerSentEvent } from './sse.js'
import type {
  ApiErrorBody,
  CreateMessageRequest,
  FileObject,
  FilePurpose,
  MessageStreamEvent,
} from './types.js'

/** 构建期 API 地址，默认 https://api.deepseek.com；本地开发支持开发服务器代理 */
export const API_ORIGIN = __API_ORIGIN__
/** 对话模型路由，构建期由 provider.config.ts 注入 */
export const CHAT_PROVIDER = __CHAT_PROVIDER__
/** 对话是否走第三方 Anthropic 兼容端点 */
export const IS_THIRD_PARTY_CHAT = CHAT_PROVIDER.kind !== 'deepseek'
/** Anthropic 官方协议版本头；第三方兼容端点普遍要求 */
const ANTHROPIC_VERSION = '2023-06-01'
/** DeepSeek Anthropic 兼容接口的前缀 */
const ANTHROPIC_BASE_URL = `${API_ORIGIN}/anthropic/v1`
/** 引用 Files API 上传的图片、调用 Anthropic 兼容 Files API 时必须携带 */
const FILES_BETA = 'files-api-2025-04-14'

/** 第三方使用独立地址，官方工具绝不复用该地址。 */
const messagesUrl = () => {
  if (!IS_THIRD_PARTY_CHAT) {
    return `${ANTHROPIC_BASE_URL}/messages`
  }
  const url = new URL(CHAT_PROVIDER.baseUrl)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.hostname === 'provider.example' ||
    CHAT_PROVIDER.model === 'your-model-id'
  ) {
    throw new ApiError('protocol', '请先填写有效的第三方 HTTPS Base URL 和模型 ID，再重新构建。')
  }
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = path.endsWith('/v1/messages')
    ? path
    : path.endsWith('/v1')
      ? `${path}/messages`
      : `${path}/v1/messages`
  return url.href
}

export type ApiErrorKind =
  /** 非 2xx 响应 */
  | 'http'
  /** 流中返回的错误帧（如等待生成超时），随后连接关闭 */
  | 'stream'
  /** 请求没有到达服务端（断网、跨域被拦截等） */
  | 'network'
  /** 流在 message_stop 之前结束 */
  | 'interrupted'
  /** 响应不符合协议（如非 SSE 响应） */
  | 'protocol'

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage

  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
  }
}

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.message === 'string'

const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || fallback
  try {
    const body: unknown = JSON.parse(text)
    if (isErrorBody(body)) {
      message = body.error.message
    }
  } catch {
    // 非 JSON 响应体直接展示原文
  }
  return new ApiError(kind, message, response.status)
}

export const request = async (url: string, init: RequestInit): Promise<Response> => {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  return response
}

const anthropicHeaders = (apiKey: string, beta: boolean): Record<string, string> => ({
  // DeepSeek 兼容接口的鉴权方式，也可使用 Authorization: Bearer。
  'x-api-key': apiKey,
  // Files API 和通过 file_id 引用图片时必传；纯文本聊天无需携带。
  ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
})

/**
 * 对话请求头：第三方按 Anthropic 官方协议带版本头，官方兼容层沿用原样。
 * 同时给出 x-api-key 与 Authorization：Claude Code 风格的网关（如火山方舟 Coding Plan）
 * 从 ANTHROPIC_AUTH_TOKEN 发 Bearer，只认 x-api-key 的实现会忽略多出来的那个。
 */
const messageHeaders = (apiKey: string, beta: boolean): Record<string, string> =>
  IS_THIRD_PARTY_CHAT
    ? {
        'x-api-key': apiKey,
        Authorization: `Bearer ${apiKey}`,
        'anthropic-version': ANTHROPIC_VERSION,
      }
    : anthropicHeaders(apiKey, beta)

/** 用 GET /models 校验 API Key（不产生费用） */
export const verifyApiKey = async (apiKey: string, signal?: AbortSignal): Promise<void> => {
  await request(`${API_ORIGIN}/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  })
}

/**
 * POST /anthropic/v1/files 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 */
export const uploadFile = async (
  apiKey: string,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  const response = await request(`${ANTHROPIC_BASE_URL}/files`, {
    method: 'POST',
    headers: anthropicHeaders(apiKey, true),
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

/** DELETE /anthropic/v1/files/{file_id} */
export const deleteFile = async (apiKey: string, fileId: string): Promise<void> => {
  await request(`${ANTHROPIC_BASE_URL}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: anthropicHeaders(apiKey, true),
  })
}

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image' || block.type === 'document')
  )

/** 原生失败的响应体多半是提供方的 JSON 错误，尽量取出可读文案。 */
const nativeFailureMessage = (message: string) => {
  try {
    const parsed: unknown = JSON.parse(message)
    if (isErrorBody(parsed)) {
      return parsed.error.message
    }
  } catch {
    // 非 JSON 直接使用原文
  }
  return message
}

/**
 * 打开对话流，产出 SSE 事件。
 *
 * 第三方端点不允许跨域携带鉴权头，浏览器预检会直接拒绝，因此设备上改走原生请求
 * （见 nativeStream）；Web 端与官方链路仍用 fetch，行为不变。
 */
async function* messageEvents(
  url: string,
  headers: Record<string, string>,
  payload: string,
  signal: AbortSignal
): AsyncGenerator<ServerSentEvent> {
  if (IS_THIRD_PARTY_CHAT && canStreamNatively()) {
    const decoder = new ServerSentEventDecoder()
    try {
      for await (const text of openNativeStream({ url, headers, body: payload, signal })) {
        yield* decoder.push(text)
      }
    } catch (error) {
      if (error instanceof StreamHttpError) {
        throw new ApiError(
          'http',
          nativeFailureMessage(error.message),
          error.status === 0 ? undefined : error.status
        )
      }
      throw error
    }
    yield* decoder.end()
    return
  }
  const response = await request(url, {
    method: 'POST',
    ...(IS_THIRD_PARTY_CHAT ? { redirect: 'error' as const } : {}),
    headers,
    body: payload,
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  yield* readServerSentEvents(response.body, signal)
}

/**
 * POST /anthropic/v1/messages（stream: true），逐个产出流式事件，收到 message_stop 时结束。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 */
export async function* streamMessage(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const url = messagesUrl()
  const headers = {
    ...messageHeaders(apiKey, hasFile(body)),
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  }
  const payload = JSON.stringify({ ...body, stream: true })
  for await (const { event: eventName, data } of messageEvents(url, headers, payload, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    if (eventName === 'error') {
      throw new ApiError('stream', data)
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}
