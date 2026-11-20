import { ApiError, API_ORIGIN, request } from './client.js'
import type { FileBlockParam, TextBlockParam } from './types.js'
import type { FileAttachment } from '../chat/types.js'

const extension = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase()
export const needsOcr = (name: string) => /^(pdf|docx?|pptx?)$/.test(extension(name))
export const unsupportedExternalFile = (name: string) => /^(xlsx?|epub|mobi)$/.test(extension(name))

const toolRequest = (
  tool: 'ocr' | 'search' | 'fetch',
  key: string,
  body: FormData | Record<string, unknown>,
  signal: AbortSignal
) => {
  if (!key) {
    throw new ApiError('protocol', { key: 'deepSeekToolsKeyRequired' })
  }
  const json = !(body instanceof FormData)
  return request(`${API_ORIGIN}/v1/tools/${tool}`, {
    method: 'POST',
    signal,
    redirect: 'error',
    headers: {
      Authorization: `Bearer ${key}`,
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    },
    body: json ? JSON.stringify(body) : body,
  })
}

const imageData = async (blob: Blob, signal: AbortSignal) => {
  const allowed = /^image\/(jpeg|png|webp|gif)$/
  if (allowed.test(blob.type) && blob.size <= 4 * 1024 * 1024) {
    return { blob, mediaType: blob.type }
  }
  const image = await createImageBitmap(blob)
  try {
    signal.throwIfAborted()
    const scale = Math.min(1, 2048 / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.floor(image.width * scale))
    canvas.height = Math.max(1, Math.floor(image.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new ApiError('protocol', 'Unable to prepare image')
    }
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    const encoded = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.8)
    )
    if (!encoded || encoded.size > 4 * 1024 * 1024) {
      throw new ApiError('http', 'Image exceeds the inline size limit', 413)
    }
    return { blob: encoded, mediaType: encoded.type }
  } finally {
    image.close()
  }
}

const base64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const parts: string[] = []
  // 每块字节数是 3 的倍数，只有尾块可能有填充。
  for (let i = 0; i < bytes.length; i += 24_576) {
    parts.push(btoa(String.fromCharCode(...bytes.subarray(i, i + 24_576))))
  }
  return parts.join('')
}

export const prepareExternalFile = async (
  file: FileAttachment,
  blob: Blob,
  apiKey: string,
  signal: AbortSignal
): Promise<FileBlockParam | TextBlockParam> => {
  if (unsupportedExternalFile(file.name)) {
    throw new ApiError('protocol', { key: 'externalUnsupportedFile' })
  }
  if (needsOcr(file.name)) {
    const form = new FormData()
    form.append('purpose', 'text_recognition')
    form.append('file', blob, file.name)
    const response = await toolRequest('ocr', apiKey, form, signal)
    const result = (await response.json()) as {
      error?: { message?: string }
      pages?: { index: number; text: string; finish_reason: string }[]
    }
    if (!Array.isArray(result.pages) || result.pages.length === 0) {
      throw new ApiError('protocol', result.error?.message ?? { key: 'uploadParseFailed' })
    }
    const pages = result.pages.map(({ index, text, finish_reason }) => {
      const clean = text.replace(/<｜box｜>[\s\S]*?<｜\/box｜>/g, '').replace(/<｜\/?ref｜>/g, '')
      return `Page ${index + 1}${finish_reason === 'length' ? ' (truncated)' : ''}:\n${clean}`
    })
    return { type: 'text', text: `Attachment: ${file.name}\n${pages.join('\n\n')}` }
  }
  if (file.isImage) {
    const normalized =
      blob.type || !file.mimeType ? blob : new Blob([blob], { type: file.mimeType })
    const image = await imageData(normalized, signal)
    const data = await base64(image.blob)
    signal.throwIfAborted()
    return { type: 'image', source: { type: 'base64', media_type: image.mediaType, data } }
  }
  const text = await blob.text()
  if (text.includes('\0') || text.includes('\ufffd')) {
    throw new ApiError('protocol', { key: 'uploadUnsupportedFormat' })
  }
  return { type: 'text', text: `Attachment: ${file.name}\n${text}` }
}

const webLinks = (text: string) =>
  [
    ...new Set(
      (text.match(/https?:\/\/[^\s<>「」“”。，；！？（）]+/giu) ?? [])
        .map((url) => url.replace(/[),.;!?\]}]+$/, ''))
        .filter((url) => {
          try {
            const parsed = new URL(url)
            return !parsed.username && !parsed.password
          } catch {
            return false
          }
        })
    ),
  ].slice(0, 2)

export const prepareWebContext = async (
  text: string,
  search: boolean,
  apiKey: string,
  signal: AbortSignal
): Promise<string> => {
  const query = [...text.trim()].slice(0, 128).join('')
  const links = webLinks(text)
  if (!query) {
    return ''
  }
  try {
    const results: string[] = []
    if (search) {
      const response = await toolRequest(
        'search',
        apiKey,
        { query, count: 5, need_content: false },
        signal
      )
      const data = (await response.json()) as {
        results?: { title: string; url: string; summary: string }[]
      }
      if (!Array.isArray(data.results)) {
        throw new Error('Invalid search response')
      }
      results.push(
        data.results.length
          ? data.results
              .map(({ title, url, summary }) => `标题：${title}\n链接：${url}\n摘要：${summary}`)
              .join('\n\n')
          : '（本次检索没有返回相关结果）'
      )
    }
    for (const url of links) {
      const response = await toolRequest('fetch', apiKey, { url }, signal)
      const page = (await response.json()) as { title: string; content: string }
      if (typeof page.content !== 'string') {
        throw new Error('Invalid webpage response')
      }
      results.push(`标题：${page.title}\n链接：${url}\n正文：${page.content.slice(0, 6000)}`)
    }
    // 措辞必须让模型知道「检索已经由客户端完成」，否则它会回答自己没有联网工具。
    return results.length
      ? [
          '下面是本轮已经替你完成的联网检索结果。你不需要、也无法再调用任何搜索工具，直接依据这些资料回答即可。',
          '要求：优先采用资料中的事实；区分资料与常识；引用时给出链接；资料不足以回答时如实说明，不要编造。',
          '',
          '【检索结果】',
          results.join('\n\n'),
        ].join('\n')
      : ''
  } catch (error) {
    if (signal.aborted || (error instanceof ApiError && error.localMessage)) {
      throw error
    }
    throw new ApiError('protocol', {
      key: 'externalWebFailed',
      params: { message: error instanceof Error ? error.message : String(error) },
    })
  }
}
