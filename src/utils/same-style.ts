import type { ISameStyleRawRequest } from '@/api/types'

/**
 * entryCode → 承载它的创作页。<b>做同款跳转以这张表为准。</b>
 *
 * <p>后端也会按 (entryCode, platform) 下发一个 route，但那是运营在后台手填的，
 * 填错、漏配、把 APP 的 scheme 配到 PC 行上都发生过，而它错了的表现是用户点进去
 * 跳到一个空白页或跳不动——出了问题也怪不到运营头上，前端得自己站得住。
 *
 * <p>这张表能作为权威，是因为回显代码就写在这两个页面里：<code>useSameStyleRecipe</code>
 * 挂在 /image/generate 和 /video/generate 上，各自的 entryCodeOps 白名单也只认自己那几个码。
 * route 指到别的地方，回显必然出不来——这不是「可能不一致」，是确定错。
 *
 * <p>本期只有这四个通用创作码。电商那 15 个入口的提交体是另一套协议（素材键是
 * imageUrls/videoUrl、参数袋结构也不同），填不进这两页的表单，要按入口逐个建模。
 * 将来要扩，路径对照见 docs/container-entry-links.md 的附录表。
 */
export const ENTRY_ROUTE: Record<string, string> = {
  textToImage: '/image/generate',
  imageToImage: '/image/generate',
  textToVideo: '/video/generate',
  imageToVideo: '/video/generate',
}

/** 本期只支持统一提交入口。模板/电商/本地生活的配方形状不同，回显进来必然错 */
export const SAME_STYLE_SUBMIT_PATH = '/api/v1/creation/submit'

/** 该作品能不能做同款：后端说支持，且它的创作场景本期覆盖得到 */
export function canMakeSameStyle(item: { sameStyle?: boolean; entryCode?: string | null }): boolean {
  if (!item.sameStyle) return false
  // entryCode 缺失（运营手灌、没关联来源任务）时先放行，由目标页拉到配方后校验并提示
  if (!item.entryCode) return true
  return !!ENTRY_ROUTE[item.entryCode]
}

/**
 * 后端下发的 targetRoute 能不能用。三道闸，任一不过就当它没给。
 *
 * @param isKnownPath 交给调用方用 router.resolve 判「这条路径本站真的注册过」
 */
function usableRemoteRoute(raw: string | null | undefined, isKnownPath: (path: string) => boolean): string {
  const route = typeof raw === 'string' ? raw.trim() : ''
  if (!route) return ''
  // 带协议的一律不认：PC 是 web，出现 app:// 说明这行是配给 APP 端的，
  // 交给 window.location 只会跳到一个打不开的地址；https:// 则是站外，更不能带着登录态过去
  if (/^[a-z][a-z0-9+.-]*:/i.test(route)) return ''
  if (!route.startsWith('/')) return ''
  return isKnownPath(route.split('?')[0]!) ? route : ''
}

/**
 * 做同款该跳哪里。<b>本地表优先，后端 targetRoute 只在本地表认不出该场景时兜底。</b>
 *
 * <p>两边都有且指向同一个页面时用后端那条——它可能带了额外 query（如具体子标签）。
 * 指向不同页面则以本地为准并打一条 warn：那是后台配置漂了，静默纠正会让它一直漂下去。
 *
 * <p>入参的 route 与 /public/same-style 的 submit.route 同构，两边共用这一套解析。
 *
 * @returns 目标路径（可能带 query），没有可跳的地方时返回空串
 */
export function createRouteOf(
  item: { entryCode?: string | null; route?: { targetRoute?: string | null } | null },
  isKnownPath: (path: string) => boolean,
): string {
  const local = item.entryCode ? ENTRY_ROUTE[item.entryCode] : ''
  const remote = usableRemoteRoute(item.route?.targetRoute, isKnownPath)

  if (!local) return remote
  if (!remote) return `${local}?entryCode=${encodeURIComponent(item.entryCode!)}`

  if (remote.split('?')[0] !== local) {
    console.warn(
      `[sameStyle] 后端下发的 targetRoute 与本地表不一致，按本地表跳：` +
        `entryCode=${item.entryCode}，targetRoute=${item.route?.targetRoute}，本地=${local}`,
    )
    return `${local}?entryCode=${encodeURIComponent(item.entryCode!)}`
  }
  return remote
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
