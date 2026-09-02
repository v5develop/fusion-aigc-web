/**
 * 订阅套餐 / 加量包购买页的跳转出口。
 *
 * <p>全站跳充值页只走这一个函数：站点自己没有充值页（路由表里没有），
 * 目前是外链到联盟主站的 `/pricing`。以后若改成宿主桥打开、或站内自建订阅页，
 * 只改这里，调用点不用动。
 */

/** 充值页地址，按 mode 取 .env.test / .env.production；未配置时为空串 */
const billingUrl = import.meta.env.VITE_BILLING_URL

/**
 * 是否配了充值页地址。
 *
 * <p>没配就别渲染跳转按钮——点了跳 `about:blank` 比没有按钮更糟。
 */
export function hasBillingPage(): boolean {
  return !!billingUrl
}

/**
 * 打开订阅套餐 / 加量包购买页。
 *
 * <p>订阅与加量包是同一个 `/pricing` 页承载的，这里<b>不拼任何 query</b>：
 * 页面未必认识前端自造的 `?tab=` 之类参数，拼了只会变成一个被忽略的噪音参数。
 */
export function openBillingPage(): void {
  if (!billingUrl) {
    console.warn('[billing] 未配置 VITE_BILLING_URL，跳转已跳过')
    return
  }

  // 刻意不传 'noopener' 特性串：带上它时 window.open 按规范<b>恒返回 null</b>，
  // 就没法拿返回值区分「开成功了」和「被拦了」。改为开完手动断开 opener，
  // 反向 tabnabbing 一样防住，且 null 只剩「真被拦了」一种含义
  const opened = window.open(billingUrl, '_blank')
  if (opened) {
    opened.opener = null
    return
  }

  // 桌面端宿主以 WebContentsView 内嵌运行，Electron 侧若把 setWindowOpenHandler
  // 设成 deny，window.open 会静默失败（用户点了没反应）。退化成当前页跳转：
  // 会把用户带离创作页，但总好过点了毫无反应
  console.warn('[billing] window.open 被拦截，退化为当前页跳转')
  window.location.href = billingUrl
}
