declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css' {}

/** 公开 API 的地址，见 rspack.config.ts 的 createConfig */
declare const __API_ORIGIN__: string

/** 对话模型路由，见 provider.config.ts 与 rspack.config.ts */
declare const __CHAT_PROVIDER__: {
  kind: 'deepseek' | 'anthropic-compatible'
  baseUrl: string
  model: string
  contextWindow: number
  maxTokens: number
  systemPrompt: string
}

/** Prism 语言包通过副作用注册到全局 Prism */
declare module 'prismjs/components/*' {}

/** KaTeX 化学公式扩展通过副作用注册到 KaTeX */
declare module 'katex/contrib/mhchem' {}
