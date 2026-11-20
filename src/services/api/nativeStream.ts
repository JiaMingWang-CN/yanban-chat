import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

/** 原生层回传的正文分块；结束与失败各发一次终态事件。 */
type StreamHttpEvents = {
  data: { id: string; text: string }
  end: { id: string }
  fail: { id: string; status: number; message: string }
}

type StreamHttpPlugin = {
  post(options: {
    id: string
    url: string
    headers: Record<string, string>
    body: string
  }): Promise<void>
  abort(options: { id: string }): Promise<void>
  addListener<K extends keyof StreamHttpEvents>(
    event: K,
    listener: (payload: StreamHttpEvents[K]) => void
  ): Promise<PluginListenerHandle>
}

const StreamHttp = registerPlugin<StreamHttpPlugin>('StreamHttp')

/** 原生流式请求的失败；status 为 0 表示连接阶段就出错。 */
export class StreamHttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'StreamHttpError'
  }
}

/** 只有装了原生插件的设备才走这条路，Web 端继续用 fetch。 */
export const canStreamNatively = () => Capacitor.isNativePlatform()

/**
 * 用原生网络栈发同一个 POST 并逐块取回正文。
 *
 * 存在的理由：第三方对话端点只放行 Content-Type 跨域，鉴权头会触发预检失败，
 * 浏览器把请求挡在本地。原生请求不受同源策略约束，同时保持增量到达。
 */
export async function* openNativeStream(options: {
  url: string
  headers: Record<string, string>
  body: string
  signal: AbortSignal
}): AsyncGenerator<string> {
  const id = crypto.randomUUID()
  const queue: string[] = []
  let finished = false
  let failure: StreamHttpError | null = null
  let wake: (() => void) | null = null
  const notify = () => {
    const pending = wake
    wake = null
    pending?.()
  }

  const handles: PluginListenerHandle[] = []
  handles.push(
    await StreamHttp.addListener('data', (payload) => {
      if (payload.id === id) {
        queue.push(payload.text)
        notify()
      }
    })
  )
  handles.push(
    await StreamHttp.addListener('end', (payload) => {
      if (payload.id === id) {
        finished = true
        notify()
      }
    })
  )
  handles.push(
    await StreamHttp.addListener('fail', (payload) => {
      if (payload.id === id) {
        failure = new StreamHttpError(payload.message, payload.status)
        finished = true
        notify()
      }
    })
  )

  const onAbort = () => {
    finished = true
    notify()
    void StreamHttp.abort({ id }).catch(() => {})
  }
  options.signal.addEventListener('abort', onAbort, { once: true })

  try {
    await StreamHttp.post({
      id,
      url: options.url,
      headers: options.headers,
      body: options.body,
    })
    for (;;) {
      options.signal.throwIfAborted()
      const next = queue.shift()
      if (next !== undefined) {
        yield next
        continue
      }
      if (failure) {
        throw failure
      }
      if (finished) {
        return
      }
      await new Promise<void>((resolve) => {
        wake = resolve
      })
    }
  } finally {
    options.signal.removeEventListener('abort', onAbort)
    for (const handle of handles) {
      void handle.remove().catch(() => {})
    }
    if (!finished) {
      void StreamHttp.abort({ id }).catch(() => {})
    }
  }
}
