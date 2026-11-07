import { useRoute, useRouter } from 'vue-router'

/**
 * 取容器深链带来的创作场景（entryCode），并把页内切换同步回地址栏。
 *
 * <p>只有<b>一页承载多个 entryCode</b> 的页面才需要这个参数：生图 2 个、生视频 4 个。
 * 电商那 14 个功能一页一功能，路由本身已经唯一，链接不带、页面也不认这个参数。
 *
 * <p>白名单校验不能省：query 是宿主容器给的外部输入，脏值会原样流进询价与提交，
 * 报出来是「无法匹配计费档位」——比直接回退到默认场景难排查得多。
 *
 * <p>不复用 router 里的 {@code getUrlQuery}：那个函数存在的理由是要在路由守卫里、
 * router 解析完成之前取 unionToken；页面 setup 没这个约束，route.query 已经是
 * 按 hash 模式解析好的结果，再手搓一遍 URLSearchParams 就成了第二份解析逻辑。
 *
 * @param options 本页合法的场景列表（各页的 entryCodeOps），充当白名单
 */
export function useEntryCodeFromQuery(options: readonly { value: string }[]) {
  const route = useRoute()
  const router = useRouter()

  // 只在 setup 读这一次并定格成常量：下面的 syncToUrl 会改写 query，
  // 若跟着 route 响应式走就成了「URL 改表单、表单又改 URL」的回环
  const raw = route.query.entryCode
  // 同名参数重复出现时 vue-router 给的是数组，取第一个
  const value = Array.isArray(raw) ? raw[0] : raw
  const entryCode = options.some((o) => o.value === value) ? (value as string) : null

  /**
   * 页内切换场景后把地址栏对齐，刷新／容器重载才能落回同一个场景。
   *
   * <p>用 replace 不用 push：切下拉不是一次页面跳转，进历史栈会让返回键
   * 在下拉选项之间一格格倒退，容器侧的返回逻辑会很怪。
   *
   * <p>对 /image/generate、/video/generate 安全：非电商页 keep-alive 的 cacheKey 恒为 undefined，
   * 同一条 record 只变 query 走的是 patch 而非 remount，表单与历史列表都不会丢。
   */
  const syncToUrl = (next: string) => {
    if (route.query.entryCode === next) return
    void router.replace({ path: route.path, query: { ...route.query, entryCode: next } })
  }

  return { entryCode, syncToUrl }
}
