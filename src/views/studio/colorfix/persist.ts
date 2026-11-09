/**
 * 商拍工作室校色参数按子任务存取。
 *
 * <p>读取顺序：本会话改过的值（内存）→ 本机还没同步上去的值（localStorage 且 `pendingSync`）→ 任务自带
 * `color_fix_params`（网关 PATCH 保存过的）→ localStorage 里已同步的旧值 → 没有（null）。
 * 内存优先是因为历史列表里的批次快照不会因为 PATCH 而刷新，切走再切回时快照里还是旧值；
 * 待同步的本机值优先于服务端，是因为它比服务端新（上次 PATCH 没发出去 / 失败 / 页面在防抖期内被关），
 * 读到时顺手重发一次 PATCH。
 *
 * <p>保存：停手 500ms 后 PATCH /api/v1/studio/tasks/{task_id}/color-fix（只对成功的任务）；
 * 老网关没这个接口（HTTP 404）时记下来，本会话改存 localStorage `studio-colorfix:<task_id>`。
 * 两种情况都会写 localStorage（`{ params, pendingSync }`）作为本机兜底：写入时 `pendingSync=true`，PATCH 成功后清掉。
 * 页面关闭 / 切走（pagehide）时，防抖里还没发的保存立即用 fetch keepalive 发出去。
 */
import { ref } from 'vue'
import { studioSaveTaskColorFix, studioSaveTaskColorFixKeepalive } from '@/api/studio.ts'
import { toApiError } from '@/api/index.ts'
import type { StudioColorFixParams, StudioTask } from '@/api/studioTypes.ts'
import { colorFixEquals, colorFixSanitize, type ColorFixParams } from '@/utils/colorfix.ts'

const LS_PREFIX = 'studio-colorfix:'

/** 网关是否有 PATCH /tasks/{id}/color-fix；探到 404 后本会话不再调 */
export const colorFixPatchSupported = ref(true)

const session = new Map<string, ColorFixParams>()

/** 服务端键名 → 前端键名 */
export function fromWire(p: StudioColorFixParams | null | undefined): ColorFixParams | null {
  if (!p) return null
  return colorFixSanitize({ hue: p.hue, sat: p.saturation, light: p.value, bright: p.brightness, contrast: p.contrast })
}

/** 前端键名 → 服务端键名 */
export function toWire(p: ColorFixParams): StudioColorFixParams {
  return { hue: p.hue, saturation: p.sat, value: p.light, brightness: p.bright, contrast: p.contrast }
}

interface LocalEntry {
  params: ColorFixParams
  /** 还没成功同步到网关 */
  pendingSync: boolean
}

function readLocal(taskId: string): LocalEntry | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + taskId)
    if (!raw) return null
    const v = JSON.parse(raw) as unknown
    if (v && typeof v === 'object' && 'params' in v) {
      const params = colorFixSanitize((v as { params: unknown }).params)
      return params ? { params, pendingSync: !!(v as { pendingSync?: unknown }).pendingSync } : null
    }
    // 老格式：直接是五参数（当时不区分是否已同步，按已同步处理，不覆盖服务端）
    const params = colorFixSanitize(v)
    return params ? { params, pendingSync: false } : null
  } catch {
    return null
  }
}

function writeLocal(taskId: string, entry: LocalEntry) {
  try {
    localStorage.setItem(LS_PREFIX + taskId, JSON.stringify(entry))
  } catch {
    /* 存储满 / 隐私模式：丢的只是还原，不打断主流程 */
  }
}

/** PATCH 成功：本机那份标成已同步（期间又改过的不动） */
function markSynced(taskId: string, p: ColorFixParams) {
  const cur = readLocal(taskId)
  if (cur && cur.pendingSync && colorFixEquals(cur.params, p)) writeLocal(taskId, { params: cur.params, pendingSync: false })
}

/** 这个任务保存过的校色参数；没有返回 null */
export function loadTaskColorFix(task: StudioTask): ColorFixParams | null {
  const mem = session.get(task.task_id)
  if (mem) return mem
  const local = readLocal(task.task_id)
  if (local?.pendingSync) {
    // 本机比服务端新：用本机的，并补发一次
    const server = fromWire(task.color_fix_params)
    if (server && colorFixEquals(server, local.params)) markSynced(task.task_id, local.params)
    else if (task.status === 2) schedule(task.task_id, local.params, 0)
    return local.params
  }
  return fromWire(task.color_fix_params) ?? local?.params ?? null
}

/** 防抖中的保存：任务号 → { 定时器, 参数 } */
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; value: ColorFixParams }>()

async function pushRemote(taskId: string, p: ColorFixParams) {
  if (!colorFixPatchSupported.value) return
  try {
    await studioSaveTaskColorFix(taskId, { params: toWire(p) })
    markSynced(taskId, p)
  } catch (err) {
    const e = toApiError(err)
    if (e?.httpStatus === 404 && e.code === -1) colorFixPatchSupported.value = false
    // 其它失败：localStorage 里仍是 pendingSync，下次读到 / 调参时再发
  }
}

function schedule(taskId: string, value: ColorFixParams, delay: number) {
  const prev = pending.get(taskId)
  if (prev) clearTimeout(prev.timer)
  const timer = setTimeout(() => {
    pending.delete(taskId)
    void pushRemote(taskId, value)
  }, delay)
  pending.set(taskId, { timer, value })
}

/** 记下这个任务的参数（立即进内存与 localStorage，停手 500ms 后同步到网关） */
export function saveTaskColorFix(task: StudioTask, p: ColorFixParams) {
  const id = task.task_id
  const value = { ...p }
  session.set(id, value)
  const syncable = task.status === 2 && colorFixPatchSupported.value
  writeLocal(id, { params: value, pendingSync: syncable })
  if (syncable) schedule(id, value, 500)
}

/** 页面关闭 / 切走：防抖里还没发的保存立即用 keepalive 发出去（发不出去也没关系，本机 pendingSync 下次补发） */
function flushPending() {
  if (!pending.size) return
  const list = [...pending.entries()]
  pending.clear()
  for (const [taskId, { timer, value }] of list) {
    clearTimeout(timer)
    if (!colorFixPatchSupported.value) continue
    studioSaveTaskColorFixKeepalive(taskId, { params: toWire(value) })
      .then(async (resp) => {
        const body = resp.ok ? ((await resp.json().catch(() => null)) as { code?: number } | null) : null
        if (body?.code === 0) markSynced(taskId, value)
      })
      .catch(() => {})
  }
}

if (typeof window !== 'undefined') window.addEventListener('pagehide', flushPending)

// ---------------- 「存为资产」去重：每个任务记住上次存进素材库的那组参数（内存 + localStorage） ----------------

const SAVED_PREFIX = 'studio-colorfix-saved:'
const savedSession = new Map<string, ColorFixParams>()

/** 这个任务上次「存为资产」时的参数；没存过返回 null */
export function lastSavedAssetColorFix(taskId: string): ColorFixParams | null {
  const mem = savedSession.get(taskId)
  if (mem) return mem
  try {
    return colorFixSanitize(localStorage.getItem(SAVED_PREFIX + taskId))
  } catch {
    return null
  }
}

/** 「存为资产」成功后记下这组参数（再点同一版时提示「已存过这一版」） */
export function rememberSavedAssetColorFix(taskId: string, p: ColorFixParams) {
  const value = { ...p }
  savedSession.set(taskId, value)
  try {
    localStorage.setItem(SAVED_PREFIX + taskId, JSON.stringify(value))
  } catch {
    /* 同上：丢的只是去重 */
  }
}
