/**
 * AI 帮写（Java creaft v1 兼容面 /api/v1/ai/prompt-write*）。
 *
 * <p>字段以契约 contracts/user-api-compat-v1/manifest.json 为准，出网为 camelCase
 * （Java CreaftV1AiController.PromptWriteRequest）：bizType 必填；content ≤3000；
 * imageUrls / videoUrls（≤1）；duration ≥1；language 默认「中文」。
 *
 * <p>bizType 只认后端登记的四种（CompatPromptWriteService.BIZ_TYPES），其余一律「未知的帮写业务」：
 * - user-skill：纯文本，**仅支持流式**（同步口直接拒绝「该业务仅支持流式返回」），图片可选；
 * - video-product-talk / brand-feature-tags：result 是 JSON 对象，参考图必填（1–9 张）；
 * - image-prompt（本端新增，creaft v1 没有）：把想法写成一段中文生图提示词（≤800 字，不含比例/尺寸），
 *   纯文本、走同步口，参考图可选（0–9 张）。
 *
 * <p>额度：每个 bizType 每人每天免费 3 次，超出后每次扣 1 点（不是拒绝）。
 */
import { authorizedFetch, get, post } from './index.ts'

export type PromptWriteBizType = 'video-product-talk' | 'user-skill' | 'brand-feature-tags' | 'image-prompt'

/** 只能走流式接口的业务（v1 streamable=True） */
export const PROMPT_WRITE_STREAM_ONLY: readonly PromptWriteBizType[] = ['user-skill']

export type PromptWriteLanguage =
  | '英语'
  | '中文'
  | '日语'
  | '俄语'
  | '意大利语'
  | '法语'
  | '西班牙语'
  | '德语'
  | '韩语'
  | '泰语'
  | '葡萄牙语'
  | '马来语'
  | '荷兰语'
  | '波兰语'
  | '瑞典语'
  | '土耳其语'

export interface PromptWriteRequest {
  bizType: PromptWriteBizType
  content?: string
  imageUrls?: string[]
  videoUrls?: string[]
  duration?: number
  language?: PromptWriteLanguage
}

/** 同步响应：result 按 responseType 解读（text = 字符串，json = 对象） */
export interface PromptWriteResult {
  result: unknown
  responseType: 'text' | 'json'
}

export interface PromptWriteQuota {
  remaining: number
}

/** 同步生成要等模型（单次上限 60 秒，口播三路并行再加余量），放宽超时 */
const WRITE_TIMEOUT = 120000

/** 后端 ERROR 帧与流被截断时的统一原文（CreaftV1PromptWriteStreamCodec.GENERATION_FAILED） */
export const PROMPT_WRITE_FAILED = '提示词生成失败'

export function promptWrite(data: PromptWriteRequest) {
  return post<PromptWriteResult>('/api/v1/ai/prompt-write', data, undefined, WRITE_TIMEOUT)
}

/** 当前用户在该 bizType 下今日剩余免费次数（各 bizType 独立计） */
export function promptWriteQuota(bizType: PromptWriteBizType) {
  return get<PromptWriteQuota>('/api/v1/ai/prompt-write/quota', { bizType })
}

export interface PromptWriteStreamHandlers {
  /** 正文分片（PROCESSING 帧的 content） */
  onChunk: (text: string) => void
  /** 收到 END 帧：内容完整 */
  onEnd: () => void
  /** ERROR 帧（message 为可直接展示的原因）、HTTP 失败或流在 END 前断开 */
  onError: (message: string) => void
}

/**
 * 流式帮写。帧：START → 逐条 PROCESSING（data {content, reasoningContent, timestamp}）→ END；
 * 失败以一帧 ERROR（data {content}）收尾、不再发 END；期间每 5 秒 HEARTBEAT。HTTP 恒 200。
 * 以 END / ERROR 判结束——连接关闭本身不代表完成，未见 END 即按失败处理，不把半段当结果。
 *
 * @returns 中断函数（中断后不再回调）
 */
export function promptWriteStream(data: PromptWriteRequest, handlers: PromptWriteStreamHandlers): () => void {
  const controller = new AbortController()
  let settled = false
  const settle = (fn: () => void) => {
    if (settled || controller.signal.aborted) return
    settled = true
    fn()
  }

  const handleFrame = (event: string, raw: string) => {
    if (event === 'HEARTBEAT' || event === 'START') return
    let payload: { content?: unknown } | null = null
    try {
      payload = raw ? JSON.parse(raw) : null
    } catch {
      payload = null
    }
    const content = typeof payload?.content === 'string' ? payload.content : ''
    if (event === 'PROCESSING') {
      if (content && !settled && !controller.signal.aborted) handlers.onChunk(content)
    } else if (event === 'END') {
      settle(handlers.onEnd)
    } else if (event === 'ERROR') {
      settle(() => handlers.onError(content || PROMPT_WRITE_FAILED))
    }
  }

  ;(async () => {
    try {
      const resp = await authorizedFetch('/api/v1/ai/prompt-write/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(data),
        signal: controller.signal,
      })
      if (!resp.ok || !resp.body) throw new Error(`prompt-write stream failed: ${resp.status}`)

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let event = 'message'
      let dataLines: string[] = []
      const flush = () => {
        if (dataLines.length) handleFrame(event, dataLines.join('\n'))
        event = 'message'
        dataLines = []
      }
      const handleLine = (line: string) => {
        if (!line) return flush()
        if (line.startsWith(':')) return
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
      }

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        buffer = buffer.replace(/\r\n?/g, '\n')
        let sep: number
        while ((sep = buffer.indexOf('\n')) !== -1) {
          handleLine(buffer.slice(0, sep))
          buffer = buffer.slice(sep + 1)
        }
      }
      buffer += decoder.decode()
      for (const line of buffer.replace(/\r\n?/g, '\n').split('\n')) handleLine(line)
      flush()
      // 连接关了却没见 END / ERROR：被截断，不能当完整结果
      settle(() => handlers.onError(PROMPT_WRITE_FAILED))
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return
      settle(() => handlers.onError(PROMPT_WRITE_FAILED))
    }
  })()

  return () => controller.abort()
}
