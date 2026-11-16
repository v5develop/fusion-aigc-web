/**
 * 同一浏览器多个标签页之间的消息总线 + 主标签页选举（任务实时推送只让一个标签页持连接）。
 *
 * <p>总线：优先 BroadcastChannel；不支持时退回 localStorage 的 storage 事件（写入即删除，只为触发事件）。
 * 两者都只送达<b>其它</b>标签页，本页自己的投递由调用方直接做。
 *
 * <p>选举：localStorage 里一份租约 {tab, exp, hiddenSince}，主标签页每 2s 续约（6s 过期）。
 * 抢占分两步——先写、150ms 后回读确认，同时写入的两个标签页只有最后写入的那个能确认成功。
 * 主标签页在后台超过 {@link HANDOVER_MS} 时，可见的标签页可以接手（连接跟着用户眼前的那一页走）。
 * localStorage 不可用（隐私模式 / 被禁用）时改用 Web Locks 选举（同一浏览器只有一个标签页持锁）；
 * 两者都没有时才每个标签页各自连接——这会占满后端每用户的连接上限（429），所以尽量不走到这一步。
 */

const CHANNEL = 'xq-task-watcher'
const BUS_KEY = 'xq_task_bus'
const LEASE_KEY = 'xq_task_leader'
const LOCK_NAME = 'xq-task-leader'
const LEASE_MS = 6000
const TICK_MS = 2000
const CONFIRM_MS = 150
/** 主标签页转入后台多久后，允许可见的标签页接手 */
export const HANDOVER_MS = 60_000

export interface Bus<M> {
  post(msg: M): void
  close(): void
}

export function createBus<M>(onMsg: (msg: M) => void): Bus<M> {
  let bc: BroadcastChannel | null = null
  try {
    if (typeof BroadcastChannel !== 'undefined') bc = new BroadcastChannel(CHANNEL)
  } catch {
    bc = null
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key !== BUS_KEY || !e.newValue) return
    try {
      onMsg((JSON.parse(e.newValue) as { m: M }).m)
    } catch {
      // 坏数据忽略
    }
  }
  if (bc) bc.onmessage = (e: MessageEvent) => onMsg(e.data as M)
  else window.addEventListener('storage', onStorage)
  return {
    post(msg: M) {
      if (bc) {
        try {
          bc.postMessage(msg)
        } catch {
          // 已关闭 / 不可克隆：丢弃
        }
        return
      }
      try {
        localStorage.setItem(BUS_KEY, JSON.stringify({ m: msg, n: Math.random() }))
        localStorage.removeItem(BUS_KEY)
      } catch {
        // 存储不可用：单标签页模式下本来也没有别人要收
      }
    },
    close() {
      bc?.close()
      bc = null
      window.removeEventListener('storage', onStorage)
    },
  }
}

interface Lease {
  tab: string
  exp: number
  /** 主标签页转入后台的时刻；前台为 0 */
  hiddenSince: number
}

/** undefined = 存储不可用；null = 没有租约 */
function readLease(): Lease | null | undefined {
  try {
    const raw = localStorage.getItem(LEASE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Lease
    return v && typeof v.tab === 'string' ? v : null
  } catch {
    return undefined
  }
}

function writeLease(lease: Lease): boolean {
  try {
    localStorage.setItem(LEASE_KEY, JSON.stringify(lease))
    return true
  } catch {
    return false
  }
}

export const newTabId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export interface ElectorOptions {
  tab: string
  /** 能否参与竞选（未登录时不抢） */
  canClaim(): boolean
  /** 本页转入后台的时刻（前台为 0） */
  hiddenSince(): number
  onChange(leader: boolean): void
  /** 每次心跳都回调（调用方借此检查登出 / 换号） */
  onTick?(): void
}

export class LeaderElector {
  leader = false
  private timer: ReturnType<typeof setInterval> | null = null
  /** Web Locks 兜底：持锁期间为主；releaseLock 解锁 */
  private lockRelease: (() => void) | null = null
  private lockPending = false
  private confirmTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly opts: ElectorOptions) {}

  start() {
    if (this.timer) return
    this.tick()
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.confirmTimer) clearTimeout(this.confirmTimer)
    this.confirmTimer = null
    this.resign()
    this.releaseLock()
  }

  /** 主动让位（关闭标签页 / 登出）：删掉自己的租约，别的标签页下一跳（或收到 resign 消息时）立即接手 */
  resign() {
    const lease = readLease()
    if (lease && lease.tab === this.opts.tab) {
      try {
        localStorage.removeItem(LEASE_KEY)
      } catch {
        // ignore
      }
    }
    this.set(false)
  }

  /** 立即重新评估（收到别的标签页让位时调用） */
  tick() {
    this.opts.onTick?.()
    const now = Date.now()
    const lease = readLease()
    if (lease === undefined) {
      // 存储不可用：Web Locks 选出一个主标签页；没有 Web Locks 才各自为政
      this.tryWebLock(this.opts.canClaim())
      return
    }
    if (!this.opts.canClaim()) {
      if (lease && lease.tab === this.opts.tab) this.resign()
      else this.set(false)
      return
    }
    const mine = !!lease && lease.tab === this.opts.tab
    if (mine) {
      writeLease({ tab: this.opts.tab, exp: now + LEASE_MS, hiddenSince: this.opts.hiddenSince() })
      this.set(true)
      return
    }
    const expired = !lease || lease.exp < now
    const staleHidden =
      !!lease && lease.hiddenSince > 0 && now - lease.hiddenSince > HANDOVER_MS && this.opts.hiddenSince() === 0
    if (!expired && !staleHidden) {
      this.set(false)
      return
    }
    if (this.confirmTimer) return
    writeLease({ tab: this.opts.tab, exp: now + LEASE_MS, hiddenSince: this.opts.hiddenSince() })
    // 回读确认：同时抢的标签页里只有最后写入者会看到自己
    this.confirmTimer = setTimeout(
      () => {
        this.confirmTimer = null
        const back = readLease()
        this.set(back === undefined ? true : !!back && back.tab === this.opts.tab)
      },
      CONFIRM_MS + Math.floor(Math.random() * 100),
    )
  }

  /** 不靠存储的选举：ifAvailable 抢锁，抢到就一直持有（直到让位 / 停止 / 页面关闭自动释放） */
  private tryWebLock(want: boolean) {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    if (!locks) {
      this.set(want)
      return
    }
    if (!want) {
      this.releaseLock()
      this.set(false)
      return
    }
    if (this.leader || this.lockPending) return
    this.lockPending = true
    locks
      .request(LOCK_NAME, { ifAvailable: true }, (lock) => {
        this.lockPending = false
        if (!lock) {
          this.set(false)
          return undefined
        }
        return new Promise<void>((resolve) => {
          this.lockRelease = resolve
          this.set(true)
        })
      })
      .catch(() => {
        this.lockPending = false
        this.set(false)
      })
  }

  private releaseLock() {
    const release = this.lockRelease
    this.lockRelease = null
    release?.()
  }

  private set(leader: boolean) {
    if (this.leader === leader) return
    this.leader = leader
    if (!leader) this.releaseLock()
    this.opts.onChange(leader)
  }
}
