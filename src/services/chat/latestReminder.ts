import { getRegionName, provinces, type UserLocation } from '../location.js'
import type { Locale } from '../settings.js'
import { formatDate } from '../../utils/format.js'
import { translate } from '../../i18n/index.js'

const locationName = (location: UserLocation | null, locale: Locale): string => {
  if (!location) {
    return ''
  }
  if (location.region === 'CN' && locale === 'zh-CN') {
    const province = provinces.find((item) => item.code === location.province)
    const city = province?.cities.find((item) => item.code === location.city)
    return city?.name ?? province?.name ?? getRegionName('CN', locale)
  }
  return getRegionName(location.region, locale)
}

/** 模型约定的五项信息；日期与星期使用浏览器本地时区，避免 UTC 日期跨日。 */
export const createLatestReminder = (
  { locale, location }: { locale: Locale; location: UserLocation | null },
  now = new Date()
): string => {
  return [
    formatDate(now),
    new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(now),
    locationName(location, locale),
    'Web',
    translate('latestReminderLanguage'),
  ].join(',')
}

/**
 * 把五段式快照展开成一段自然语言，并补上当前时刻。
 * DeepSeek 兼容层认 `latest_reminder` 角色，第三方端点不认，只能用普通文本交代；
 * 快照里没有时分，所以时刻在每次请求时现取。
 */
export const describeLatestReminder = (reminder: string, now = new Date()): string => {
  const [date, weekday, location, client, language] = reminder.split(',')
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const offsetMinutes = -now.getTimezoneOffset()
  const offset = `UTC${offsetMinutes >= 0 ? '+' : '-'}${Math.floor(Math.abs(offsetMinutes) / 60)}`
  return [
    date && weekday ? `今天是 ${date} ${weekday}。` : '',
    `当前时刻：${time}（时区 ${zone}，${offset}）。`,
    location ? `用户所在地区：${location}。` : '',
    client ? `客户端：${client}。` : '',
    language ? `请使用${language}回答。` : '',
    '用户询问日期或时间时，直接依据以上信息回答，不要联网检索。',
  ]
    .filter(Boolean)
    .join('')
}
