import { useTranslate } from '../../i18n/index.js'
import { setErrorReporting, useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import styles from './Settings.module.css'

/**
 * 首次使用的错误报告询问：用户没有选择过（errorReporting === null）时显示，
 * 关闭弹窗等同于暂不开启，之后可在设置里改。
 */
export const ErrorReportPrompt = () => {
  const t = useTranslate()
  const decided = useSettings((state) => state.errorReporting) !== null
  return decided ? null : (
    <Modal
      title={t('errorReportPromptTitle')}
      className={styles.errorReportPrompt}
      // 点遮罩、Esc 都按「暂不开启」处理
      onClose={() => setErrorReporting(false)}
      footer={
        <>
          <Button variant="outlined" size="m" onClick={() => setErrorReporting(false)}>
            {t('errorReportPromptDisable')}
          </Button>
          <Button size="m" autoFocus onClick={() => setErrorReporting(true)}>
            {t('errorReportPromptEnable')}
          </Button>
        </>
      }
    >
      <div className={styles.errorReportPromptText}>{t('errorReportPromptBody')}</div>
    </Modal>
  )
}
