import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupTheme } from './app/theme.js'
import { ensureKatex } from './services/markdown/katex.js'
import { installErrorReporting } from './services/errorReport.js'
import './app/theme.css'
import './app/global.css'

ensureKatex()
setupTheme()
installErrorReporting()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
