import type { ISameStyleRawRequest } from '@/api/types'

/**
 * 做同款支持的创作场景 → 承载它的页面路径。
 *
 * <p>本期只做四个通用创作码。电商那 15 个入口的提交体是另一套协议（素材键是
 * imageUrls/videoUrl、参数袋结构也不同），填不进 /picture、/video 的表单，
 * 要按入口逐个建模，属于独立一期。
 *
 * <p>刻意不读后端下发的 {@code submit.route.targetRoute}：后台那张创作入口路由表
 * 上线时是空的，targetRoute 恒为 null；而本期入口就四个，路由前端自己最清楚。
 */
export const SAME_STYLE_ENTRY_ROUTE: Record<string, '/picture' | '/video'> = {
  textToImage: '/picture',
  imageToImage: '/picture',
  textToVideo: '/video',
  imageToVideo: '/video',
}

/** 本期只支持统一提交入口。模板/电商/本地生活的配方形状不同，回显进来必然错 */
export const SAME_STYLE_SUBMIT_PATH = '/api/v1/creation/submit'

/** 该作品能不能做同款：后端说支持，且它的创作场景本期覆盖得到 */
export function canMakeSameStyle(item: { sameStyle?: boolean; entryCode?: string }): boolean {
  if (!item.sameStyle) return false
  // 后端补 entryCode 之前先放行，由目标页拉到配方后校验并提示；补上后这里自动收敛
  if (!item.entryCode) return true
  return !!SAME_STYLE_ENTRY_ROUTE[item.entryCode]
}

/**
 * 从原始提交体里取提示词。
 * <p>普通请求在 params.prompt，模板历史请求在 inputs.prompt，最后才取顶层 prompt。
 */
export function promptOf(request?: ISameStyleRawRequest): string {
  if (!request) return ''
  const v = request.params?.prompt ?? request.inputs?.prompt ?? request.prompt
  return typeof v === 'string' ? v : ''
}

/** 取原作输入图。submit.request 里的素材已被后端清空，只有 original.request 有 */
export function originalImagesOf(request?: ISameStyleRawRequest): string[] {
  const raw = request?.images ?? request?.imageUrls
  if (!Array.isArray(raw)) return []
  return raw.filter((u): u is string => typeof u === 'string' && !!u)
}
