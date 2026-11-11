/**
 * 「外观」判定表的唯一实现：存档（未清洗的 JSON）+ 系统是否深色 + 此刻分钟数 → light | dark。
 *
 * <p>两处共用，规则只写这一份：
 * - src/utils/themePrefs.ts 运行时判定（跟随系统 / 按时间到点切换）；
 * - index.html 首帧内联脚本：vite.config.ts 的 `xq-theme-boot` 插件把本函数的源码（`decideTheme.toString()`）
 *   原样嵌进 HTML，JS 模块加载前就写好 data-theme，深色用户打开不会先白一下。
 *
 * <p>⚠️ 因为源码会被整段搬进 HTML，函数体必须<b>自包含</b>：不能引用本文件外（含本文件其他顶层）的任何变量 / 函数，
 * 也不要写需要运行时 helper 的语法。只依赖参数与内置对象。
 *
 * <p>按时间：起止相同 = 全天浅色；白天跨午夜也支持（如 20:00 起浅色、06:00 起深色）。非法时间回退 07:00 / 19:00。
 */
export function decideTheme(raw: unknown, systemDark: boolean, nowMinutes: number): 'light' | 'dark' {
  const p = (raw && typeof raw === 'object' ? raw : {}) as { mode?: unknown; dayStart?: unknown; nightStart?: unknown }
  if (p.mode === 'dark') return 'dark'
  if (p.mode === 'system') return systemDark ? 'dark' : 'light'
  if (p.mode !== 'schedule') return 'light'
  const min = (s: unknown, d: number) => {
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(typeof s === 'string' ? s : '')
    return m ? Number(m[1]) * 60 + Number(m[2]) : d
  }
  const day = min(p.dayStart, 420)
  const night = min(p.nightStart, 1140)
  const light =
    day === night || (day < night ? nowMinutes >= day && nowMinutes < night : nowMinutes >= day || nowMinutes < night)
  return light ? 'light' : 'dark'
}

export const THEME_PREFS_KEY_PREFIX = 'xq-theme-prefs:'
/** 本机最近一次设置（身份未知时用） */
export const THEME_DEVICE_KEY = 'xq-theme-device'

/**
 * 首帧内联脚本（vite.config.ts 注入 index.html）。读存档的口径与 themePrefs.ts 的 readStored 一致：
 * 有账号 id（`fusion_identity`）读该账号的存档，没有读本机最近一次（`xq-theme-device`）；读不了保持浅色。
 */
export function themeBootScript(): string {
  return `;(function () {
  try {
    var ls = localStorage
    var id = ls.getItem('fusion_identity')
    var raw = id ? ls.getItem(${JSON.stringify(THEME_PREFS_KEY_PREFIX)} + id) : ls.getItem(${JSON.stringify(THEME_DEVICE_KEY)})
    var dark = typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    var n = new Date()
    var decide = ${decideTheme.toString()}
    document.documentElement.setAttribute('data-theme', decide(raw ? JSON.parse(raw) : null, dark, n.getHours() * 60 + n.getMinutes()))
  } catch (e) {
    /* 隐私模式读不了 localStorage：保持浅色 */
  }
})()`
}
