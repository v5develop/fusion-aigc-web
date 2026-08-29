/**
 * 宿主应用桥接（`window.ThirdServiceBridge`）的类型声明。
 *
 * <p>桥只在<b>桌面端宿主</b>内存在（站点以 WebContentsView 嵌入运行），浏览器直开、移动端宿主里
 * 整个对象都是 undefined，故所有成员都是可选的——调用点一律走可选链，不做「有桥就一定有某方法」的假设：
 * 旧版桌面端只有 refreshUnionToken，新方法是后加的。
 *
 * <p>这里给 Window 加的是<b>可选</b>成员，不影响 router / api 里既有的 `(window as any).ThirdServiceBridge` 写法。
 */

/**
 * 设备侧提示载荷。
 *
 * <p>背景：站点发起的生成可能被派回<b>本机豆包</b>执行，失败原因（掉登录/额度用完/繁忙）只有桌面端知道，
 * 走服务端往返只能拿到 401/5xx。桌面端把失败翻成用户友好文案后经桥直推，站点负责展示。
 */
interface DeviceNotice {
  /** 提示来源，当前恒 'doubao'。未来会扩展，未知 source 也照常展示 message */
  source: 'doubao' | (string & {})
  /**
   * 分类，仅用于决定展示样式（颜色/停留时长），<b>不参与文案拼接</b>。
   * 词表会增长，未知 kind 按普通提示兜底展示
   */
  kind: 'need-login' | 'quota-exhausted' | 'busy' | 'timeout' | 'failed' | (string & {})
  /** 用户友好文案，直接展示——已是完整句子，不要改写或拼接错误码 */
  message: string
  /** 产生时刻（epoch ms） */
  ts: number
}

interface ThirdServiceBridge {
  /** 向宿主索取当前有效的 unionToken。同步/异步实现都可能，调用方需 Promise.resolve 包裹 */
  refreshUnionToken?: () => string | Promise<string>
  /**
   * 订阅设备侧提示。返回退订函数——但<b>返回值可能是 undefined</b>（宿主实现差异），退订前判空。
   * 移动端宿主与旧版桌面端没有此方法。
   */
  onDeviceNotice?: (cb: (notice: DeviceNotice) => void) => (() => void) | void
  /**
   * 请求宿主唤起豆包重新登录：还原并聚焦主应用窗口、打开豆包登录弹窗（短信验证码流程在桌面端完成）。
   * 无参无返回，重复调用无害（弹窗幂等）。
   */
  requestDoubaoRelogin?: () => void
}

interface Window {
  ThirdServiceBridge?: ThirdServiceBridge
  /** 仅 dev 构建存在：本地不起桌面端也能模拟一条设备侧提示，见 DeviceNoticeHost */
  __emitDeviceNotice?: (notice: DeviceNotice) => void
}
