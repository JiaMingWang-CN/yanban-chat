import type { CapacitorConfig } from '@capacitor/cli'

/** 移动端壳配置：webDir 指向 rspack 构建产物，原生工程只包一层 WebView */
const config: CapacitorConfig = {
  appId: 'com.deepseek.chatdemo',
  appName: '言伴',
  webDir: 'dist',
  plugins: {
    // WebView 140+ 需要 viewport-fit=cover 才会铺满全屏；首帧按 cover 计算，避免启动时白边跳动
    SystemBars: {
      initialViewportFitValueHint: 'cover',
    },
  },
}

export default config
