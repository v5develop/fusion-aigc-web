/**
 * 局部调色的本机持久化：
 * <ul>
 *   <li>选区设置（方式 / 目标 / 反选 / 柔化）：localStorage `colorfix-region:<key>`，几十字节；</li>
 *   <li>手动涂抹的蒙版：IndexedDB `fusion-colorfix` / `masks`（Blob），按 `<key>::<原图地址>` 存——
 *       同一条记录的多张候选各有各的涂抹。超过 {@link PAINTED_MASK_MAX_BYTES} 的蒙版只留在内存（本会话有效），
 *       不写库；IndexedDB 不可用（隐私模式 / 被禁）时同样只留内存。总量按最近使用淘汰（≤60MB / 200 条，库与内存各计），
 *       被替换 / 淘汰的 objectURL 先从烘图缓存摘掉再延迟回收，并通知同屏的 useResultColorFix 重新读。</li>
 * </ul>
 * 读写失败一律静默：丢的只是还原，不打断主流程。
 */
import { forgetColorFixSource } from '@/utils/colorfix.ts'
import { colorFixRegionSanitize, type ColorFixRegion } from './types.ts'

const REGION_PREFIX = 'colorfix-region:'
/** 涂抹蒙版持久化上限：黑底白笔 PNG 压缩率很高，4096² 一般也就几百 KB，超过 6MB 多半是异常图，不入库 */
export const PAINTED_MASK_MAX_BYTES = 6 * 1024 * 1024

export function loadRegion(key: string): ColorFixRegion | null {
  try {
    const raw = localStorage.getItem(REGION_PREFIX + key)
    return raw ? colorFixRegionSanitize(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function saveRegion(key: string, region: ColorFixRegion) {
  try {
    localStorage.setItem(REGION_PREFIX + key, JSON.stringify(region))
  } catch {
    /* 存储满 / 隐私模式 */
  }
}

// ---------------- 涂抹蒙版：内存（objectURL）+ IndexedDB（Blob） ----------------

const DB_NAME = 'fusion-colorfix'
const STORE = 'masks'
/** 本机蒙版总量上限：超过按最近使用淘汰（IndexedDB 与内存各自计） */
export const MASK_STORE_MAX_BYTES = 60 * 1024 * 1024
export const MASK_STORE_MAX_ENTRIES = 200
/** 涂抹蒙版导出的长边上限（点选蒙版存模型网格 ≤1024，见 PointSelect） */
export const PAINTED_MASK_MAX_SIDE = 2048

/** 库里的一条：新版存 { blob, at }（at = 最近使用时间，淘汰用）；旧版直接存 Blob（at 视为 0，最先淘汰） */
interface MaskRecord {
  blob: Blob
  at: number
}
function recordOf(v: unknown): MaskRecord | null {
  if (v instanceof Blob) return { blob: v, at: 0 }
  const r = v as Partial<MaskRecord> | null | undefined
  return r && r.blob instanceof Blob ? { blob: r.blob, at: typeof r.at === 'number' ? r.at : 0 } : null
}

/** 本会话的蒙版：作用域键 → objectURL + 大小（Map 按使用先后排，LRU） */
const memory = new Map<string, { url: string; size: number }>()

/**
 * 被替换 / 淘汰的 objectURL：先从烘图缓存里摘掉（不再有人按它取图），延迟一会儿再 revoke——
 * 正在跑的那一轮烘图可能刚拿到这个地址。
 */
const REVOKE_DELAY_MS = 30_000
function retire(url: string | undefined) {
  if (!url || !url.startsWith('blob:')) return
  forgetColorFixSource(url)
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}

function memSet(scope: string, url: string, size: number) {
  const old = memory.get(scope)
  memory.delete(scope)
  memory.set(scope, { url, size })
  if (old && old.url !== url) retire(old.url)
  let total = 0
  for (const v of memory.values()) total += v.size
  while (memory.size > 1 && (memory.size > MASK_STORE_MAX_ENTRIES || total > MASK_STORE_MAX_BYTES)) {
    const [oldest, v] = memory.entries().next().value as [string, { url: string; size: number }]
    if (oldest === scope) break
    memory.delete(oldest)
    total -= v.size
    retire(v.url)
    notify(oldest)
  }
}

function memDelete(scope: string) {
  const old = memory.get(scope)
  memory.delete(scope)
  if (old) retire(old.url)
}

// 蒙版变了（替换 / 删除 / 被淘汰）：通知同屏别的 useResultColorFix 重新读，免得它们拿着已回收的地址
type MaskListener = (scope: string) => void
const listeners = new Set<MaskListener>()
export function onPaintedMaskChange(fn: MaskListener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function notify(scope: string) {
  for (const fn of listeners) {
    try {
      fn(scope)
    } catch {
      /* 监听方自己的问题，不影响存储 */
    }
  }
}

let dbTask: Promise<IDBDatabase | null> | null = null
function openDb(): Promise<IDBDatabase | null> {
  if (dbTask) return dbTask
  dbTask = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbTask
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const req = run(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/** 库里总量超上限：按最近使用（at）从旧到新删，直到回到上限以内；keep = 刚写入的那条不删 */
async function evictDb(keep: string) {
  const db = await openDb()
  if (!db) return
  const rows: { scope: string; size: number; at: number }[] = []
  await new Promise<void>((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) return resolve()
        const r = recordOf(cursor.value)
        rows.push({ scope: String(cursor.key), size: r?.blob.size ?? 0, at: r?.at ?? 0 })
        cursor.continue()
      }
      req.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
  let total = rows.reduce((n, r) => n + r.size, 0)
  let count = rows.length
  if (total <= MASK_STORE_MAX_BYTES && count <= MASK_STORE_MAX_ENTRIES) return
  rows.sort((a, b) => a.at - b.at)
  for (const r of rows) {
    if (total <= MASK_STORE_MAX_BYTES && count <= MASK_STORE_MAX_ENTRIES) break
    if (r.scope === keep) continue
    await tx('readwrite', (st) => st.delete(r.scope))
    total -= r.size
    count -= 1
  }
}

/** 读涂抹蒙版：内存优先，其次 IndexedDB；没有返回 '' */
export async function loadPaintedMask(scope: string): Promise<string> {
  const mem = memory.get(scope)
  if (mem) {
    memory.delete(scope)
    memory.set(scope, mem)
    return mem.url
  }
  const record = recordOf(await tx<unknown>('readonly', (s) => s.get(scope)))
  if (!record) return ''
  // 刷新最近使用时间（淘汰按它排）；失败无所谓
  void tx('readwrite', (s) => s.put({ blob: record.blob, at: Date.now() } satisfies MaskRecord, scope))
  const raced = memory.get(scope)
  if (raced) return raced.url
  const url = URL.createObjectURL(record.blob)
  memSet(scope, url, record.blob.size)
  return url
}

/** 存涂抹蒙版；返回 objectURL 与是否已落库（false = 只在内存：太大 / 库不可用） */
export async function savePaintedMask(scope: string, blob: Blob): Promise<{ url: string; persisted: boolean }> {
  const url = URL.createObjectURL(blob)
  memSet(scope, url, blob.size)
  notify(scope)
  if (blob.size > PAINTED_MASK_MAX_BYTES) {
    await tx('readwrite', (s) => s.delete(scope))
    return { url, persisted: false }
  }
  const ok = await tx('readwrite', (s) => s.put({ blob, at: Date.now() } satisfies MaskRecord, scope))
  if (ok !== null) void evictDb(scope)
  return { url, persisted: ok !== null }
}

export async function deletePaintedMask(scope: string) {
  memDelete(scope)
  await tx('readwrite', (s) => s.delete(scope))
  notify(scope)
}

/** 把蒙版 PNG 缩到长边 ≤ maxSide（本来就小、或浏览器不支持时原样返回） */
export async function capMaskBlob(blob: Blob, maxSide = PAINTED_MASK_MAX_SIDE): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') return blob
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(blob)
    const scale = maxSide / Math.max(bitmap.width, bitmap.height)
    if (scale >= 1) return blob
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(bitmap.width * scale))
    c.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = c.getContext('2d')
    if (!ctx) return blob
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, c.width, c.height)
    const out = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/png'))
    c.width = c.height = 0
    return out ?? blob
  } catch {
    return blob
  } finally {
    bitmap?.close()
  }
}

export function deleteRegion(key: string) {
  try {
    localStorage.removeItem(REGION_PREFIX + key)
  } catch {
    /* 隐私模式 */
  }
}

/** 删掉某个结果键下所有原图的涂抹蒙版（作用域 `<key>::<原图>`，内存 + IndexedDB） */
export async function deletePaintedMasksOf(key: string) {
  if (!key) return
  const prefix = `${key}::`
  for (const scope of [...memory.keys()]) {
    if (!scope.startsWith(prefix)) continue
    memDelete(scope)
    notify(scope)
  }
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const store = db.transaction(STORE, 'readwrite').objectStore(STORE)
      const req = store.openCursor(IDBKeyRange.bound(prefix, `${prefix}￿`))
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) return resolve()
        cursor.delete()
        cursor.continue()
      }
      req.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}
