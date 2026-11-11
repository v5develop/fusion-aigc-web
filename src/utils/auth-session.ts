import { clearProvisional, rebindProvisional, tokenFingerprint } from '@/utils/provisional-prefs.ts'

/**
 * 账号会话的单一真相：token 落盘、账号指纹、账号级缓存清理。
 *
 * <p>本模块<b>不发任何请求</b>，只做 localStorage 读写与 JWT 解码 —— 所以
 * `src/api/index.ts` 与 `src/router/index.ts` 都能依赖它而不构成循环。
 *
 * <p>存在的理由是「宿主换账号」这个场景：宿主 App 退出登录再换一个账号进来时，
 * 本地那份还没过期的 fusion token 属于<b>上一个账号</b>。光把 token 换新还不够，
 * 电商标签、会话 id 这些账号级缓存也得跟着换人一起丢掉，否则新账号会看到旧账号的
 * 标签条，还会拿旧账号的 sessionId 去轮询。
 */

/**
 * 设备级 key：换账号也要留着。
 *
 * <p>`union_deviceId` 标识的是这台机器/这个浏览器，不是某个人——清掉它等于每次换号
 * 都变成一台新设备，联盟侧的设备上报会被污染。
 */
const DEVICE_SCOPED_KEYS = new Set(['union_deviceId', 'xq-theme-device'])

/**
 * 按账号分开存的 key 前缀：key 里已带账号指纹，换号不会串，清掉反而让 A→B→A 丢掉 A 的设置。
 * 目前是「字体显示」与「外观」偏好（src/utils/textPrefs.ts 的 TEXT_PREFS_KEY_PREFIX、
 * src/utils/themePrefs.ts 的 THEME_PREFS_KEY_PREFIX，这里写字面量避免依赖）。
 */
const ACCOUNT_KEYED_PREFIXES = ['xq-text-prefs:', 'xq-theme-prefs:']

/**
 * 当前账号的身份：后端用户 id（登录响应的 `userId`、`/auth/user-info` 的 `id`）。
 *
 * <p>后端发的 accessToken 是不透明的 UUID，不是 JWT，从 token 里解不出任何身份——早先按 JWT 解码的
 * 指纹因此恒为空，换号检测、按账号存的「字体显示」偏好与「最近」资产全部静默失效。现在身份只认后端给的 id，
 * 在登录（{@link adoptSession}）与拉用户信息（{@link rememberAccount}）时记下。
 *
 * <p>登出<b>不清</b>它：下次登录拿新 id 跟它一比，同人就留、换人才清缓存（见 resetAccountScope）。
 * key 名沿用旧的 `fusion_identity`：旧代码从没成功写过它，沿用不会读到错的值，也省一次迁移。
 */
const IDENTITY_KEY = 'fusion_identity'

/** 换人时要留下的凭证：{@link rememberAccount} 是在 token 已经落盘之后才发现换了人，清缓存时不能把它们一起清掉 */
const CREDENTIAL_KEYS = ['fusion_accessToken', 'fusion_refreshToken', 'union_token', 'union_refreshToken']

/** 容器内登出重载的节流时间戳（sessionStorage），换人时一并清掉，让新会话拿到干净的节流窗口 */
const LOGOUT_RELOAD_KEY = 'fusion_logout_reload_at'

/**
 * token 落盘的唯一入口。
 *
 * <p>改造前 router 守卫、登录页、拦截器三处各写各的 setItem，
 * 「写 token 时顺带记指纹」这种要求就得改三处、迟早漏一处。
 */
export function saveTokens(data: { accessToken: string; refreshToken: string }) {
  const fpBefore = tokenFingerprint()
  localStorage.setItem('fusion_accessToken', data.accessToken)
  localStorage.setItem('fusion_refreshToken', data.refreshToken)
  // 续期（fusion refresh / 联盟换票）换了 token：身份未知期间改的临时偏好跟着改挂新指纹。
  // 同步完成、中间无 await，期间的偏好写入不会落在旧指纹上；换人的路径已先清掉临时偏好，这里无物可挪
  rebindProvisional(fpBefore)
}

/**
 * base64url 解码为 UTF-8 字符串。
 *
 * <p>`atob` 吐出来的是 latin1「字节串」，直接当字符串用会把中文昵称之类的多字节
 * claim 解成乱码；这里逐字节还原后交给 TextDecoder 按 UTF-8 解。
 */
function decodeBase64Url(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  // base64 长度必须是 4 的倍数，JWT 分段是去掉 '=' 填充的，这里补回来
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * 从 fusion accessToken（JWT）里解出账号唯一标识，作为「这份 token 属于谁」的指纹。
 *
 * <p><b>只是兜底</b>：后端眼下发的是不透明 UUID token，这里恒返回 null；账号身份以
 * {@link currentAccountId}（后端用户 id）为准。保留它是为了以后 token 改成 JWT 时自动可用。
 *
 * <p>claim 名后端未做书面约定，故按 `sub → userId → uid → user_id → id` 顺序取第一个
 * 非空值并 `String()` 归一（后端可能给 number）。加一个 claim 名的代价是这里补一项，
 * 比让指纹静默失效好。
 *
 * <p>任何异常（不是 JWT、段数不对、payload 不是 JSON、没有可用 claim）都返回 null，
 * 调用方据此走「只切 token 不清缓存」的保守分支 —— <b>宁可漏清，不可误清</b>：
 * 漏清最坏是新账号多看见一个旧标签，误清是把用户还在跑的会话直接抹掉。
 */
export function identityOf(accessToken: string): string | null {
  try {
    const payloadSegment = accessToken.split('.')[1]
    if (!payloadSegment) return null
    const payload = JSON.parse(decodeBase64Url(payloadSegment))
    const raw = payload?.sub ?? payload?.userId ?? payload?.uid ?? payload?.user_id ?? payload?.id
    if (raw == null || raw === '') return null
    return String(raw)
  } catch {
    return null
  }
}

/** 后端 id（number / string）归一成非空字符串；空、0 以外的非法值返回 null */
function normalizeAccountId(raw: unknown): string | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : null
  if (typeof raw === 'string') {
    const v = raw.trim()
    return v ? v : null
  }
  return null
}

function readStoredId(): string {
  try {
    return localStorage.getItem(IDENTITY_KEY) || ''
  } catch {
    return ''
  }
}

const accountListeners = new Set<() => void>()

/** 订阅「本页内当前账号 id 变了」（登录、首次拿到用户信息）。别的标签页改的走 storage 事件，不经过这里 */
export function onAccountChange(fn: () => void): () => void {
  accountListeners.add(fn)
  return () => accountListeners.delete(fn)
}

function writeStoredId(next: string | null) {
  const prev = readStoredId()
  try {
    if (next) localStorage.setItem(IDENTITY_KEY, next)
    else localStorage.removeItem(IDENTITY_KEY)
  } catch {
    return
  }
  if ((next || '') !== prev) accountListeners.forEach((fn) => fn())
}

/**
 * 当前账号的稳定标识（同步、只读 localStorage），按账号分开存的本机数据都用它做 key。
 * 取不到（从没登录过 / 老会话还没拉到用户信息）时返回空串，调用方据此不读不写账号级数据。
 *
 * <p>记下的 id 优先；没有时才试一下 JWT 解码（{@link identityOf}，兼容以后改发 JWT 的情况，眼下恒为空）。
 */
export function currentAccountId(): string {
  const stored = readStoredId()
  if (stored) return stored
  try {
    const token = localStorage.getItem('fusion_accessToken')
    return (token && identityOf(token)) || ''
  } catch {
    return ''
  }
}

/**
 * 登录成功后接管这份 token：落盘、记指纹、换人时清掉旧账号的本地缓存。
 * 返回<b>是否发生了换人</b>（调用方一般只用来打日志）。
 *
 * <p>把整套时序封在一个函数里而不是拆成几个导出，是因为顺序有坑且不显眼：
 * {@link resetAccountScope} 走的是白名单保留，会把指纹和 token 一起清掉——
 * 「先记指纹、再清缓存」会把刚记的指纹抹了，「先写 token、再清缓存」会把刚写的 token 抹了。
 * 正确顺序只有一种：<b>先算出是否换人 → 清缓存 → 写 token → 重写指纹</b>。
 *
 * <p>指纹 = 登录响应里的后端 `userId`（取不到才试 JWT 解码）。
 * 解不出指纹时只落 token、不清缓存，并 warn：token 照常切换（主流程不受影响），
 * 只是失去「换人检测」这层能力。warn 是为了让 claim 名变更能被发现，
 * 而不是变成一个永远静默降级的功能。
 */
export function adoptSession(data: { accessToken: string; refreshToken: string; userId?: unknown }): boolean {
  const next = normalizeAccountId(data.userId) ?? identityOf(data.accessToken)
  if (!next) {
    console.warn('[auth] 登录响应里没有 userId，本次跳过换号检测（不清缓存），等用户信息接口补记账号')
  }

  const prev = readStoredId()
  // prev 为空 = 本机第一次登录（或身份功能刚修好），没有「上一个账号」可言，不算换人
  const switched = !!next && !!prev && next !== prev

  if (switched) resetAccountScope()
  saveTokens(data)
  // 取不到新身份时<b>移除</b>旧 id 而不是留着：token 已经换了，留着旧 id 等于把上一个人的
  // 字体偏好、「最近」资产套到一个不知道是谁的账号上；用户信息接口回来后会补记
  writeStoredId(next)

  return switched
}

/**
 * 拉到用户信息（`/auth/user-info`）后记下账号 id。返回<b>是否发现换了人</b>。
 *
 * <p>两个用处：
 * 1. 老会话迁移：身份修好之前登录的人本机没有 id，应用启动拉用户信息时补上，不必重新登录；
 * 2. 兜底换人检测：本机记的 id 和 token 实际所属账号对不上（理论上只有并发竞态会走到），
 *    清掉账号级缓存。此时 token 已经是新账号的、要留着，所以先存凭证、清缓存、再写回。
 *    返回 true 时调用方应整页重载：内存里的 store 还是旧账号的（同 login 页的处理）。
 *
 * <p>调用方须保证这份用户信息是用<b>当前</b> token 拉的（请求期间 token 变过就别调），
 * 否则一个迟到的旧账号响应会被当成「换了人」。
 */
export function rememberAccount(rawId: unknown): boolean {
  const next = normalizeAccountId(rawId)
  if (!next) return false
  const prev = readStoredId()
  if (prev === next) return false
  const switched = !!prev
  if (switched) {
    const kept = CREDENTIAL_KEYS.map((k) => [k, localStorage.getItem(k)] as const)
    resetAccountScope()
    for (const [k, v] of kept) if (v != null) localStorage.setItem(k, v)
    console.info('[auth] 用户信息显示账号已变化，已清空上一个账号的本地缓存')
  }
  writeStoredId(next)
  // 只有新 id 真的落了盘才报「换了人」：写失败（配额 / 存储被禁）时调用方一重载，下次还是对不上，会无限重载
  return switched && readStoredId() === next
}

/*
 * 别的标签页换了账号（fusion_identity 从一个已知 id 变成另一个已知 id）：本页内存里的 store、轮询、
 * 编辑中的状态全是上一个账号的，而 token 是共享的、已经是新账号的——继续跑就是拿新账号的 token
 * 展示 / 回写旧账号的数据（如电商标签 store 的 deep watch 会把旧标签写回新账号的存储）。整页重载重建。
 * storage 事件不在写入方触发；重载后本页只读不写 id，不会在标签页之间来回弹。
 * 空 ↔ 有值（老会话补记、登录响应缺 userId）不算换人，不重载。
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === IDENTITY_KEY && e.oldValue && e.newValue && e.oldValue !== e.newValue) {
      window.location.reload()
    }
  })
}

/**
 * 清掉全部账号级本地缓存，只保留 {@link DEVICE_SCOPED_KEYS}。
 *
 * <p>刻意不导出：清缓存只有「指纹比对判定换了人」这一个合法触发条件。
 * 早先 logoutToLogin 也调过它，结果是同一个人令牌过期重登也会丢掉电商标签——
 * 登出不等于换人，那个决策不该散在调用方手里。
 *
 * <p>刻意用<b>白名单保留</b>而不是逐个 removeItem 的黑名单：两种做法的失败代价不对称。
 * 黑名单漏登记一个 key 就是串账号的数据事故（新账号看到旧账号的内容），
 * 而白名单多清一个最多是缓存重建——标签条回到只剩首页、提示语多弹一次。
 * 黑名单还要求以后每个加缓存的人都记得回来登记，这种约定守不住。
 */
function resetAccountScope() {
  clearProvisional() // 身份未知期间的临时偏好绑旧 token，换人即作废（也通知偏好模块丢内存里的待落盘标记）
  for (const key of Object.keys(localStorage)) {
    if (DEVICE_SCOPED_KEYS.has(key)) continue
    if (ACCOUNT_KEYED_PREFIXES.some((p) => key.startsWith(p))) continue
    localStorage.removeItem(key)
  }
  sessionStorage.removeItem(LOGOUT_RELOAD_KEY)
}

/* ---------------- 「本次页面加载已用宿主当前身份核验过」标记 ---------------- */

/**
 * 纯内存、页面级：本次加载是否成功用<b>宿主此刻给的</b> unionToken 换过一次 fusion token。
 *
 * <p>它回答的是「本地这份 token 确定属于宿主当前账号吗」。冷启动那一枪成功就为 true；
 * 桥超时且 URL 也没有 token 时为 false —— 那时本地 token 仍可能属于上一个账号。
 *
 * <p>用途见 `src/api/index.ts` 的 doRefresh：未核验时必须优先问联盟侧，
 * 否则 fusion refresh 会拿<b>旧账号的</b> refreshToken 把旧账号一路续下去，新账号永远进不来。
 */
let accountVerified = false

export function markAccountVerified() {
  accountVerified = true
}

export function isAccountVerified() {
  return accountVerified
}
