import { Capacitor } from '@capacitor/core'
import { createId } from '../utils/id.js'
import { CHAT_PROVIDER } from './api/client.js'
import { useSettings } from './settings.js'

/**
 * 错误上报：只把未捕获的异常与未处理的 Promise 拒绝发给自建采集服务，
 * 字段限于错误本身与运行环境，不含对话、附件、密钥等任何用户内容。
 * 用户未明确开启（errorReporting !== true）时一个字节都不发。
 */
const ENDPOINT = 'https://ds.signoff.top/ingest'
/** 写入令牌：采集端只做写入鉴权，读回需要同一令牌 */
const TOKEN = 'cacb9605bc73c7a3a918db09ef0f36bff30c578d1035f15e0f6173213def682f'
/** 单次启动最多上报条数，避免报错风暴打满接口 */
const MAX_REPORTS = 20
const MAX_MESSAGE = 500
const MAX_STACK = 4000
const MAX_SOURCE = 200

export type ErrorKind = 'error' | 'rejection'

type ErrorReport = {
  schema: 1
  id: string
  name: 'error'
  /** 客户端时间；落盘时间以服务端为准 */
  at: string
  /** 应用版本 */
  version: string
  /** 对话模型路由：deepseek / anthropic-compatible */
  provider: string
  /** 运行平台：android / web */
  platform: string
  /** 系统版本，取自 UA，取不到时为空 */
  os: string
  /** 报错时的界面语言 */
  locale: string
  kind: ErrorKind
  message: string
  stack?: string
  source?: string
  line?: number
  column?: number
}

const truncate = (value: string, limit: number) =>
  value.length > limit ? `${value.slice(0, limit)}…` : value

/** 错误对象与非错误值统一成可上报的文案；没有堆栈时省略字段 */
const describe = (value: unknown): { message: string; stack?: string } => {
  if (value instanceof Error) {
    return {
      message: truncate(value.message || value.name || 'Error', MAX_MESSAGE),
      ...(value.stack ? { stack: truncate(value.stack, MAX_STACK) } : {}),
    }
  }
  const text = typeof value === 'string' ? value : String(value)
  return { message: truncate(text || 'Unknown error', MAX_MESSAGE) }
}

const platform = () => (Capacitor.isNativePlatform() ? 'android' : 'web')

/** 只取系统版本号，UA 其余部分不上报 */
const osVersion = () => /Android (\d+(?:\.\d+)?)/.exec(navigator.userAgent)?.[1] ?? ''

/** 已上报的去重键与条数，进程内有效 */
const reported = new Set<string>()
let count = 0

const send = async (report: ErrorReport) => {
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ events: [report] }),
    })
  } catch {
    // 上报失败不影响使用，也不重试
  }
}

/** 记录一次错误；同一错误（类型 + 文案 + 堆栈首帧）只上报一次 */
export const reportError = (
  kind: ErrorKind,
  value: unknown,
  origin?: { file?: string; line?: number; column?: number }
) => {
  if (useSettings.getState().errorReporting !== true || count >= MAX_REPORTS) {
    return
  }
  const { message, stack } = describe(value)
  const key = `${kind}|${message}|${stack?.split('\n')[1] ?? ''}`
  if (reported.has(key)) {
    return
  }
  reported.add(key)
  count += 1
  void send({
    schema: 1,
    id: createId(),
    name: 'error',
    at: new Date().toISOString(),
    version: __APP_VERSION__,
    provider: CHAT_PROVIDER.kind,
    platform: platform(),
    os: osVersion(),
    locale: useSettings.getState().locale,
    kind,
    message,
    ...(stack ? { stack } : {}),
    ...(origin?.file ? { source: truncate(origin.file, MAX_SOURCE) } : {}),
    ...(origin?.line ? { line: origin.line } : {}),
    ...(origin?.column ? { column: origin.column } : {}),
  })
}

/** 接管未捕获异常与未处理的 Promise 拒绝；在渲染前安装，尽早捕获启动错误 */
export const installErrorReporting = () => {
  window.addEventListener('error', (event) => {
    // 资源加载失败没有 error 对象，此时只有一行描述，没有堆栈
    reportError('error', event.error ?? event.message, {
      file: event.filename,
      line: event.lineno,
      column: event.colno,
    })
  })
  window.addEventListener('unhandledrejection', (event) => {
    reportError('rejection', event.reason)
  })
}
