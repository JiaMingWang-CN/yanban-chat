import { useState } from 'react'
import {
  canInstallInApp,
  checkForUpdate,
  CURRENT_VERSION,
  installUpdate,
  isUnknownSourcesError,
  type UpdateInfo,
} from '../../services/update.js'
import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import styles from './Settings.module.css'

type Phase = 'idle' | 'checking' | 'latest' | 'available' | 'installing'

/** 检查更新：查 GitHub Releases，发现新版本后由原生下载并调起系统安装器。 */
export const UpdateSetting = () => {
  const t = useTranslate()
  const native = canInstallInApp()
  const [phase, setPhase] = useState<Phase>('idle')
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  // 下载百分比；原生拿不到总长度时一直停在 0，界面按不确定态显示文字
  const [percent, setPercent] = useState(0)

  const status = (() => {
    if (!native) {
      return t('settingsUpdateWebOnly')
    }
    switch (phase) {
      case 'checking':
        return t('settingsUpdateChecking')
      case 'latest':
        return t('settingsUpdateLatest')
      case 'available':
        return update ? t('settingsUpdateAvailable', { version: update.version }) : ''
      case 'installing':
        return t('settingsUpdateInstalling')
      default:
        return t('settingsUpdateCurrent', { version: CURRENT_VERSION })
    }
  })()

  const check = async () => {
    setPhase('checking')
    try {
      const info = await checkForUpdate()
      setUpdate(info)
      setPhase(info ? 'available' : 'latest')
    } catch (error) {
      setPhase('idle')
      showToast(t('settingsUpdateFailed', { message: error instanceof Error ? error.message : String(error) }))
    }
  }

  const install = async () => {
    if (!update) {
      return
    }
    setPercent(0)
    setPhase('installing')
    try {
      await installUpdate(update, setPercent)
      // 安装界面已经弹出，回到「更新」态，用户取消安装后可以直接重试
      setPhase('available')
    } catch (error) {
      setPhase('available')
      showToast(
        isUnknownSourcesError(error)
          ? t('settingsUpdateUnknownSources')
          : t('settingsUpdateFailed', {
              message: error instanceof Error ? error.message : String(error),
            })
      )
    }
  }

  const busy = phase === 'checking' || phase === 'installing'

  return (
    <div className={`${styles.cell} ${styles.row}`}>
      <div className={styles.text}>
        <div className={styles.label}>{t('settingsUpdate')}</div>
        <div className={styles.description}>{status}</div>
      </div>
      {phase === 'installing' ? (
        <div
          className={styles.updateProgress}
          role="progressbar"
          aria-label={t('settingsUpdateInstalling')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div className={styles.updateProgressFill} style={{ width: `${percent}%` }} />
          <span className={styles.updateProgressText}>
            {percent > 0 ? `${percent}%` : t('settingsUpdateWorking')}
          </span>
        </div>
      ) : (
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={!native || busy}
          onClick={() => void (phase === 'available' ? install() : check())}
        >
          {phase === 'available'
            ? t('settingsUpdateAction')
            : phase === 'checking'
              ? t('settingsUpdateWorking')
              : t('settingsUpdateCheck')}
        </Button>
      )}
    </div>
  )
}
