# Yanban (言伴)

English | [简体中文](README.zh-CN.md)

A mobile chat app built on the DeepSeek API. The web layer is React + rspack; Capacitor wraps it in an Android WebView. There is no application backend: the browser or the app talks to the configured API service directly.

The chat model can run against either the official DeepSeek API or any Anthropic-compatible endpoint. Speech, document parsing and web search always use the official DeepSeek APIs.

## Features

- Multiple conversations with automatic titles, rename and delete; edit a prompt, regenerate a reply, and switch between branches.
- Streaming replies, deep thinking, stop and continue.
- Smart search and link reading: retrieval happens through the DeepSeek Search / Fetch APIs, and the results are attached to the current turn with sources.
- Attachments: images go straight to the model; PDF, Word and PowerPoint are converted to text by DeepSeek OCR; plain-text and code files are read locally.
- Voice input and read-aloud (ASR / TTS).
- Markdown, syntax highlighting, KaTeX math and Mermaid diagrams.
- Simplified Chinese and English, light and dark themes, mobile layouts, history import and export.

## Getting started

Requires Node.js 22.12+ and pnpm.

```sh
pnpm install
pnpm dev        # http://localhost:8090
pnpm type       # type check
pnpm lint       # lint
pnpm build      # emit dist/
```

## Choosing the chat model

The route is fixed at build time in `provider.config.ts`:

```ts
export const CHAT_PROVIDER = {
  kind: 'anthropic-compatible', // or 'deepseek'
  baseUrl: 'https://api-inference.modelscope.cn', // without /v1/messages
  model: 'deepseek-ai/DeepSeek-V4.1-Flash-1017',
  contextWindow: 1048576,
  maxTokens: 393216,
  systemPrompt: '',
}
```

- `kind: 'deepseek'`: chat goes through the DeepSeek compatibility layer; Settings shows a single DeepSeek API key field.
- `kind: 'anthropic-compatible'`: chat goes to the third-party endpoint; Settings then shows two fields, one for the chat provider key and one for the DeepSeek key.

API keys are entered in Settings and kept in browser localStorage; none are committed to this repository.

> If a third-party endpoint does not allow its auth headers in cross-origin requests, the browser preflight rejects the call. On Android the app issues the request natively (`StreamHttpPlugin`) to sidestep that; a plain web deployment needs its own proxy.

## Building the Android APK

```sh
pnpm build
npx cap sync android
cd android && ./gradlew assembleRelease
```

The APK lands in `android/app/build/outputs/apk/release/`.

Signing material is read from outside the repository: `~/.android/yanban-release/signing.properties` (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`). Without it the build still succeeds, but the APK is unsigned.

## Data and privacy

- API key and settings live in browser localStorage; conversations and original attachments live in IndexedDB.
- **No analytics, telemetry or data-collection code is included**, and conversation content is never sent anywhere except the configured API service.
- Sending a message, uploading an attachment or using speech necessarily sends that content to the configured API service.

## Layout

```
src/
  app/          shell, theme, viewport
  components/   UI (sessions, messages, composer, settings, search)
  services/
    api/        protocol types, SSE parsing, third-party endpoint adapter
    chat/       session storage, request assembly, branches and history
  i18n/         Chinese and English strings
android/        Capacitor Android project
```

## License

MIT, see [LICENSE](LICENSE). This project is derived from [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo); the original copyright notice is retained.
