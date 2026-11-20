import { useTranslate } from '../../i18n/index.js'
import { setErrorReporting, useSettings } from '../../services/settings.js'
import { Select } from '../base/Select.js'
import styles from './Settings.module.css'

/** 错误报告开关：开启后应用异常时上报错误信息，随时可关 */
export const ErrorReportSetting = () => {
  const t = useTranslate()
  const enabled = useSettings((state) => state.errorReporting) === true
  return (
    <div className={`${styles.cell} ${styles.row}`}>
      <div className={styles.text}>
        <div className={styles.label}>{t('settingsErrorReport')}</div>
        <div className={styles.description}>{t('settingsErrorReportDescription')}</div>
      </div>
      <Select
        ariaLabel={t('settingsErrorReport')}
        value={enabled ? 'on' : 'off'}
        options={[
          { value: 'on', label: t('settingsSwitchOn') },
          { value: 'off', label: t('settingsSwitchOff') },
        ]}
        onChange={(value) => setErrorReporting(value === 'on')}
      />
    </div>
  )
}
