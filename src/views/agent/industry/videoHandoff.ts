/**
 * 视频模板「做同款」：智能体对话不出视频（没有生视频工具），改去现有「生成视频」页并预填。
 *
 * 用那个页面现成的预填口子：pinia home store 的 global_formData（home=true 时 VideoGenerator 在 setup 读一次 video.*）。
 * 能带的才带，带不了的不填：
 * - 提示词：列表接口摘掉了模板 prompt，只有 payload.description 可用（没有就留空，不拿标题凑）；
 * - 参考图 / 首帧：只带用户已经在输入区放好的图（不拿模板的示例图当用户素材），有图 → 图生视频，没有 → 文生视频；
 * - 比例：模板声明的渠道比例，生成页只支持 9:16 / 16:9，其他不填（用页面默认 9:16）；
 * - 时长 / 分辨率 / 模型：模板没有这些字段，用页面默认，由页面按所选模型校正。
 */
import type { IPlazaTemplate } from '@/api/plaza.ts'
import { useHomeStore } from '@/stores/home'

export const VIDEO_PAGE_HINT = '视频模板在生成视频页完成'

const SUPPORTED_RATIOS = ['9:16', '16:9']

export interface VideoPrefill {
  prompt: string
  ratio?: string
  images: string[]
}

export function videoPrefillOf(t: IPlazaTemplate, images: string[] = []): VideoPrefill {
  const d = t.payload?.description
  const prompt = typeof d === 'string' ? d.trim() : ''
  const ratio = t.targetChannels?.map((c) => c.ratio).find((r) => SUPPORTED_RATIOS.includes(r))
  return { prompt, ...(ratio ? { ratio } : {}), images }
}

/**
 * 写入预填（home=true 即「有一次预填待取」）。生成视频页在 setup 读完后自己把 home 清掉（读一次即清），
 * 所以分包加载慢也不会丢，之后再进生成页也不会被旧预填覆盖。
 */
export function stashVideoPrefill(p: VideoPrefill) {
  const f = useHomeStore().global_formData
  f.video = {
    entryCode: p.images.length ? 'imageToVideo' : 'textToVideo',
    modelCode: 'xiaoqi-video-1.0-lite',
    prompt: p.prompt,
    ratio: p.ratio ?? '9:16',
    resolution: '720p',
    duration: 4,
    images: p.images.map((url) => ({ url })),
    video: [],
  }
  f.home = true
}
