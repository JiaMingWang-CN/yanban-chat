import { Capacitor, registerPlugin, SystemBars, SystemBarsStyle } from '@capacitor/core'
import { useSyncExternalStore } from 'react'
import { useSettings, type ThemePreference } from '../services/settings.js'

/** 原生 Activity 的夜间模式：跟随主题偏好，让系统选择菜单、放大镜等使用一致的深浅色。 */
interface AppAppearancePlugin {
  setNightMode(options: { mode: ThemePreference }): Promise<void>
}

const AppAppearance = registerPlugin<AppAppearancePlugin>('AppAppearance')

export type Theme = 'light' | 'dark'

const query = window.matchMedia('(prefers-color-scheme: dark)')

const subscribeOsTheme = (listener: () => void) => {
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

const getOsTheme = (): Theme => (query.matches ? 'dark' : 'light')

const resolveTheme = (preference: ThemePreference, osTheme: Theme): Theme =>
  preference === 'system' ? osTheme : preference

/** 当前实际生效的深浅色：手动选择优先，「跟随系统」时取系统设置 */
export const useTheme = (): Theme => {
  const preference = useSettings((state) => state.themePreference)
  const osTheme = useSyncExternalStore(subscribeOsTheme, getOsTheme)
  return resolveTheme(preference, osTheme)
}

const syncPageBackground = () => {
  const backgroundColor = getComputedStyle(document.body).backgroundColor
  document.documentElement.style.backgroundColor = backgroundColor
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', backgroundColor)
}

/** 系统栏图标跟随页面深浅色：深色页面用浅色图标，浅色页面用深色图标。 */
const syncSystemBars = (theme: Theme) => {
  if (!Capacitor.isNativePlatform()) {
    return
  }
  void SystemBars.setStyle({
    style: theme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
  })
}

/** 原生 Activity 的夜间模式跟随主题偏好；选「跟随系统」时交还系统，避免两个深浅色来源互相影响。 */
let appliedNativeMode: ThemePreference | null = null
const syncNativeAppearance = (preference: ThemePreference) => {
  if (!Capacitor.isNativePlatform() || preference === appliedNativeMode) {
    return
  }
  appliedNativeMode = preference
  void AppAppearance.setNightMode({ mode: preference })
}

/** 同步页面主题、根画布背景和支持 theme-color 的浏览器栏。 */
const applyTheme = (theme: Theme) => {
  const body = document.body
  // 主题切换帧禁用过渡，使页面颜色同步更新
  body.classList.add('change-theme')
  body.classList.toggle('dark', theme === 'dark')
  body.classList.toggle('light', theme === 'light')
  if (theme === 'dark') {
    body.setAttribute('data-ds-dark-theme', 'dark')
  } else {
    body.removeAttribute('data-ds-dark-theme')
  }
  document.documentElement.style.colorScheme = theme
  syncSystemBars(theme)
  // 首次背景色同步在样式表加载完成后执行，适配 WebKit 的 defer 脚本执行顺序。
  if (document.readyState === 'complete') {
    syncPageBackground()
  }
  setTimeout(() => {
    body.classList.remove('change-theme')
  }, 0)
}

let appliedTheme: Theme | null = null

const syncTheme = () => {
  const preference = useSettings.getState().themePreference
  syncNativeAppearance(preference)
  const theme = resolveTheme(preference, getOsTheme())
  if (theme !== appliedTheme) {
    appliedTheme = theme
    applyTheme(theme)
  }
}

/** 首屏渲染前同步应用一次，之后随主题设置与系统深浅色变化更新 */
export const setupTheme = () => {
  syncTheme()
  if (document.readyState !== 'complete') {
    window.addEventListener('load', syncPageBackground, { once: true })
  }
  query.addEventListener('change', syncTheme)
  useSettings.subscribe(syncTheme)
}
