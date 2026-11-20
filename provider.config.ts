/**
 * 对话模型的路由配置：构建期写死，不进设置界面。
 * `kind` 改回 'deepseek' 即恢复完全走官方 API 的原始行为。
 */
export type ChatProviderKind = 'deepseek' | 'anthropic-compatible'

export type ChatProviderConfig = {
  kind: ChatProviderKind
  /** 第三方 Anthropic 兼容端点，不含 /v1/messages；kind 为 deepseek 时忽略 */
  baseUrl: string
  /** 第三方模型名；kind 为 deepseek 时忽略 */
  model: string
  /** 上下文窗口，占位值取 deepseek-flash 的 1M */
  contextWindow: number
  /** 单次请求输出上限，占位值取 deepseek-flash 的 384K */
  maxTokens: number
  /** 覆盖内置系统提示词，留空则使用默认 */
  systemPrompt: string
}

export const CHAT_PROVIDER: ChatProviderConfig = {
  kind: 'anthropic-compatible',
  // 填好以下两项后，将 kind 改为 'anthropic-compatible' 并重新构建。
  baseUrl: 'https://api-inference.modelscope.cn',
  model: 'deepseek-ai/DeepSeek-V4.1-Flash-1017',
  contextWindow: 1048576,
  maxTokens: 393216,
  systemPrompt: '',
}
