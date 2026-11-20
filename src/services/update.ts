import { Capacitor, registerPlugin } from '@capacitor/core'
import { ApiError } from './api/client.js'

/** 更新源：GitHub Releases，取最新一次发布 */
const RELEASE_API = 'https://api.github.com/repos/JiaMingWang-CN/yanban-chat/releases/latest'

/** 当前版本，构建期由 package.json 注入 */
export const CURRENT_VERSION = __APP_VERSION__

/** 原生安装插件；只在 Android 上可用 */
interface AppUpdaterPlugin {
  downloadAndInstall(options: { url: string }): Promise<void>
  /** 下载进度，percent 为 0–100 的整数 */
  addListener(
    eventName: 'progress',
    listener: (data: { percent: number }) => void
  ): Promise<{ remove(): Promise<void> }>
}

const AppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater')

export type UpdateInfo = {
  /** 去掉前缀 v 的版本号 */
  version: string
  /** 安装包下载地址 */
  url: string
  /** Release 说明 */
  notes: string
  publishedAt: string
}

const parseVersion = (value: string) =>
  value
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0)

/** 逐段比较，缺失的段按 0 处理 */
export const isNewerVersion = (candidate: string, current: string): boolean => {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index] ?? 0
    const right = b[index] ?? 0
    if (left !== right) {
      return left > right
    }
  }
  return false
}

export const canInstallInApp = () => Capacitor.isNativePlatform()

/**
 * 查询是否有新版本；已是最新时返回 null。
 * 请求失败抛出 ApiError，由界面展示原因。
 */
export const checkForUpdate = async (signal?: AbortSignal): Promise<UpdateInfo | null> => {
  let response: Response
  try {
    response = await fetch(RELEASE_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal,
    })
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    throw new ApiError('http', `GitHub 返回 ${response.status}`, response.status)
  }
  const data = (await response.json()) as {
    tag_name?: unknown
    body?: unknown
    published_at?: unknown
    assets?: { name?: unknown; browser_download_url?: unknown }[]
  }
  if (typeof data.tag_name !== 'string') {
    throw new ApiError('protocol', '发布信息缺少版本号')
  }
  const apk = (data.assets ?? []).find(
    (asset) => typeof asset.name === 'string' && asset.name.toLowerCase().endsWith('.apk')
  )
  if (!apk || typeof apk.browser_download_url !== 'string') {
    throw new ApiError('protocol', '该版本没有提供安装包')
  }
  const version = data.tag_name.replace(/^v/i, '')
  if (!isNewerVersion(version, CURRENT_VERSION)) {
    return null
  }
  return {
    version,
    url: apk.browser_download_url,
    notes: typeof data.body === 'string' ? data.body : '',
    publishedAt: typeof data.published_at === 'string' ? data.published_at : '',
  }
}

/**
 * 下载并唤起系统安装器；下载过程中通过 onProgress 回报百分比。
 * 用户尚未允许「安装未知应用」时抛出的错误 code 为 UNKNOWN_SOURCES，
 * 原生侧已把设置页打开，界面只需提示用户回来重试。
 */
export const installUpdate = async (
  info: UpdateInfo,
  onProgress?: (percent: number) => void
): Promise<void> => {
  if (!canInstallInApp()) {
    throw new ApiError('protocol', 'web')
  }
  // 先挂监听再开始下载，否则第一个进度可能已经错过
  const listener = onProgress
    ? await AppUpdater.addListener('progress', ({ percent }) => onProgress(percent))
    : null
  try {
    await AppUpdater.downloadAndInstall({ url: info.url })
  } finally {
    await listener?.remove()
  }
}

/** 判断是否是「需要先允许安装未知应用」的失败 */
export const isUnknownSourcesError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return /unknown_sources|UNKNOWN_SOURCES/i.test(message)
}
