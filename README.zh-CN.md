# 言伴（Yanban）

[English](README.md) | 简体中文

一个基于 DeepSeek 官方 API 的移动端聊天应用。Web 层用 React + rspack，移动端由 Capacitor 包一层 Android WebView，不依赖自建后端：浏览器或 App 直接连接所配置的接口服务。

对话模型可以在「DeepSeek 官方」与「任意 Anthropic 兼容端点」之间切换；语音、文件解析、联网检索等能力始终走 DeepSeek 官方接口。

## 功能

- 多会话管理：自动标题、重命名、删除，提问可编辑、回答可重新生成，并在分支之间切换。
- 流式输出、深度思考、停止生成与续写。
- 智能搜索与链接阅读：检索由 DeepSeek Search / Fetch 接口完成，结果随本轮提问注入并附来源。
- 附件：图片直传模型，PDF / Word / PowerPoint 经 DeepSeek OCR 转文本；纯文本与代码文件本地读取。
- 语音输入与朗读（ASR / TTS）。
- Markdown、代码高亮、KaTeX 公式、Mermaid 图表。
- 简体中文与英文，浅色与深色主题，移动端布局，历史记录导入导出。

## 快速开始

需要 Node.js 22.12+ 与 pnpm。

```sh
pnpm install
pnpm dev        # http://localhost:8090
pnpm type       # 类型检查
pnpm lint       # 规范检查
pnpm build      # 产出 dist/
```

## 配置对话模型

对话模型的路由在构建期写死，见 `provider.config.ts`：

```ts
export const CHAT_PROVIDER = {
  kind: 'anthropic-compatible', // 或 'deepseek'
  baseUrl: 'https://api-inference.modelscope.cn', // 不含 /v1/messages
  model: 'deepseek-ai/DeepSeek-V4.1-Flash-1017',
  contextWindow: 1048576,
  maxTokens: 393216,
  systemPrompt: '',
}
```

- `kind: 'deepseek'`：对话走 DeepSeek 官方兼容层，设置页只需要一个 DeepSeek API Key。
- `kind: 'anthropic-compatible'`：对话走第三方端点，设置页会出现两个输入框（第三方对话 Key 与 DeepSeek 官方 Key）。

API Key 由用户在设置页填写，保存在浏览器 localStorage，不写进代码仓库。

> 第三方端点若不支持跨域携带鉴权头，浏览器的预检会拦截请求。App 内已改为原生流式请求（`StreamHttpPlugin`）绕过该限制；网页端直连则需要自行准备代理。

## 构建 Android 安装包

```sh
pnpm build
npx cap sync android
cd android && ./gradlew assembleRelease
```

产物位于 `android/app/build/outputs/apk/release/`。

签名信息从用户目录读取，不进入仓库：`~/.android/yanban-release/signing.properties`（`storeFile`、`storePassword`、`keyAlias`、`keyPassword`）。缺少该文件时构建仍可进行，但产物未签名。

## 数据与隐私

- API Key、设置项保存在浏览器 localStorage；对话与附件原件保存在 IndexedDB。
- **不包含任何数据采集、统计或遥测代码**，不会把对话内容发送到本项目以外的服务器。
- 发送消息、上传附件、使用语音时，相关内容会发送到所配置的接口服务，属于功能必需。

## 目录结构

```
src/
  app/          应用外壳、主题与视口
  components/   界面组件（会话、消息、输入、设置、搜索）
  services/
    api/        协议类型、SSE 解析、第三方端点适配
    chat/       会话存储、请求组装、分支与历史
  i18n/         中英文案
android/        Capacitor Android 工程
```

## 许可

MIT，见 [LICENSE](LICENSE)。本项目基于 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 修改，保留原始版权声明。
