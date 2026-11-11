/**
 * 像素层数据的本机存储（2026-11-11，「向下合并」的产物，见 layers.ts 像素层）。
 *
 * <p>和涂抹蒙版（mask-store.ts）同生命周期——随「移除校色」清掉、撤销回来还在、没有持久化键时只放内存——但单独成库
 * （IndexedDB `fusion-colorfix-pixels`）：一张 4K 的像素层 PNG 动辄十几 MB，不能和 6MB / 60MB 上限的蒙版混着按最近使用淘汰，
 * 否则合并一次就会把别的蒙版挤掉，反过来蒙版多了又会把像素层挤掉（像素层是内容本身，丢了就是丢图）。
 *
 * <ul>
 *   <li>PNG Blob，按作用域（layers.ts pixelScope）存，不可变——合并出新数据永远用新 pid，所以不需要「替换通知」；</li>
 *   <li>库内总量 ≤ {@link PIXEL_STORE_MAX_BYTES} / {@link PIXEL_STORE_MAX_ENTRIES} 条，超了按写入时间从旧到新淘汰，
 *       被「钉住」的不淘汰（{@link setPixelPins}：当前图层与撤销 / 重做历史里引用的像素层，由 useResultColorFix 维护）；</li>
 *   <li>写库遇到配额不足先淘汰没钉住的再试一次，仍不够返回 `quota`（合并被拒，提示图片太大）；IndexedDB 不可用 / 没有持久化键时
 *       只留内存（`persisted: false`，刷新后丢），内存里这类「易失」数据总量 ≤ {@link PIXEL_VOLATILE_MAX_BYTES}，超了同样拒绝；</li>
 *   <li>内存里只留 objectURL（供渲染按地址加载）；已落库且没钉住的按最近使用淘汰，要用时再从库里读回。</li>
 * </ul>
 * 读写失败一律静默（返回空 / 错误码）：丢的只是还原，不打断主流程。
 */
import { forgetColorFixSource } from '@/utils/colorfix.ts'

const DB_NAME = 'fusion-colorfix-pixels'
const STORE = 'pixels'

/** 单块上限：压缩后超过它多半是异常大图，不合并 */
export const PIXEL_BLOB_MAX_BYTES = 128 * 1024 * 1024
/** 库内总量上限（浏览器配额一般远大于它；超了淘汰没钉住的旧数据） */
export const PIXEL_STORE_MAX_BYTES = 480 * 1024 * 1024
export const PIXEL_STORE_MAX_ENTRIES = 40
/** 只在内存里的（库不可用 / 没有持久化键）总量上限 */
export const PIXEL_VOLATILE_MAX_BYTES = 384 * 1024 * 1024
/** 内存里 objectURL 对应的 Blob 总量上限（已落库且没钉住的超了就放掉，用时再读） */
const MEMORY_MAX_BYTES = 256 * 1024 * 1024
const REVOKE_DELAY_MS = 30_000

interface PixelRecord {
  blob: Blob
  at: number
}
function recordOf(v: unknown): PixelRecord | null {
  const r = v as Partial<PixelRecord> | null | undefined
  return r && r.blob instanceof Blob ? { blob: r.blob, at: typeof r.at === 'number' ? r.at : 0 } : null
}

interface Entry {
  url: string
  size: number
  /** 已写进 IndexedDB（false = 只在内存，不能放掉） */
  persisted: boolean
}
/** 作用域 → 内存里的 objectURL（Map 按使用先后排，LRU） */
const memory = new Map<string, Entry>()

/** 钉住的作用域：owner → 它引用的作用域（owner 一般是一个 useResultColorFix 实例） */
const pins = new Map<string, Set<string>>()
export function setPixelPins(owner: string, scopes: Iterable<string>) {
  pins.set(owner, new Set(scopes))
}
export function clearPixelPins(owner: string) {
  pins.delete(owner)
}
function pinned(scope: string): boolean {
  for (const set of pins.values()) if (set.has(scope)) return true
  return false
}

function retire(url: string) {
  forgetColorFixSource(url)
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}

function volatileBytes(): number {
  let n = 0
  for (const e of memory.values()) if (!e.persisted) n += e.size
  return n
}

function memSet(scope: string, entry: Entry) {
  const old = memory.get(scope)
  memory.delete(scope)
  memory.set(scope, entry)
  if (old && old.url !== entry.url) retire(old.url)
  let total = 0
  for (const e of memory.values()) total += e.size
  for (const [k, e] of [...memory.entries()]) {
    if (total <= MEMORY_MAX_BYTES) break
    if (k === scope || !e.persisted || pinned(k)) continue
    memory.delete(k)
    total -= e.size
    retire(e.url)
  }
}

function memDelete(scope: string) {
  const old = memory.get(scope)
  memory.delete(scope)
  if (old) retire(old.url)
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

async function dbGet(scope: string): Promise<PixelRecord | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(scope)
      req.onsuccess = () => resolve(recordOf(req.result))
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function dbDelete(scope: string): Promise<void> {
  const db = await openDb()
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(scope)
      tx.oncomplete = tx.onerror = tx.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}

type PutResult = 'ok' | 'quota' | 'unavailable'
async function dbPut(scope: string, blob: Blob): Promise<PutResult> {
  const db = await openDb()
  if (!db) return 'unavailable'
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ blob, at: Date.now() } satisfies PixelRecord, scope)
      tx.oncomplete = () => resolve('ok')
      const fail = () => resolve(tx.error?.name === 'QuotaExceededError' ? 'quota' : 'unavailable')
      tx.onerror = fail
      tx.onabort = fail
    } catch (err) {
      resolve((err as { name?: string })?.name === 'QuotaExceededError' ? 'quota' : 'unavailable')
    }
  })
}

/** 库里总量超上限（或 need > 0：要再腾出这么多字节）：按写入时间从旧到新淘汰没钉住的，keep = 刚写入的不删 */
async function evictDb(keep: string, need = 0) {
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
  let total = rows.reduce((n, r) => n + r.size, 0) + need
  let count = rows.length
  rows.sort((a, b) => a.at - b.at)
  for (const r of rows) {
    if (total <= PIXEL_STORE_MAX_BYTES && count <= PIXEL_STORE_MAX_ENTRIES) break
    if (r.scope === keep || pinned(r.scope)) continue
    await dbDelete(r.scope)
    memDelete(r.scope)
    total -= r.size
    count -= 1
  }
}

export type PixelSaveResult =
  | { ok: true; url: string; persisted: boolean }
  /** too-large：单块超上限；quota：存不下（浏览器配额 / 易失内存已满） */
  | { ok: false; error: 'too-large' | 'quota' }

/**
 * 存一块像素层数据。memoryOnly = 没有持久化键，只放内存。
 * 返回 objectURL 与是否已落库；存不下返回错误码（调用方拒绝这次合并并提示）。
 */
export async function savePixel(scope: string, blob: Blob, opts: { memoryOnly?: boolean } = {}): Promise<PixelSaveResult> {
  if (blob.size > PIXEL_BLOB_MAX_BYTES) return { ok: false, error: 'too-large' }
  let persisted = false
  if (!opts.memoryOnly) {
    let r = await dbPut(scope, blob)
    if (r === 'quota') {
      await evictDb(scope, blob.size)
      r = await dbPut(scope, blob)
    }
    if (r === 'quota') return { ok: false, error: 'quota' }
    persisted = r === 'ok'
    if (persisted) void evictDb(scope)
  }
  if (!persisted && volatileBytes() + blob.size > PIXEL_VOLATILE_MAX_BYTES) return { ok: false, error: 'quota' }
  const url = URL.createObjectURL(blob)
  memSet(scope, { url, size: blob.size, persisted })
  return { ok: true, url, persisted }
}

/** 读像素层：内存优先，其次库；没有返回 ''（被淘汰 / 清了站点数据 / 换了设备） */
export async function loadPixel(scope: string): Promise<string> {
  if (!scope) return ''
  const mem = memory.get(scope)
  if (mem) {
    memory.delete(scope)
    memory.set(scope, mem)
    return mem.url
  }
  const record = await dbGet(scope)
  if (!record) return ''
  const raced = memory.get(scope)
  if (raced) return raced.url
  const url = URL.createObjectURL(record.blob)
  memSet(scope, { url, size: record.blob.size, persisted: true })
  return url
}

/** 删一块（内存 + 库） */
export async function deletePixel(scope: string) {
  if (!scope) return
  memDelete(scope)
  await dbDelete(scope)
}

/** 删某个结果键下所有像素层（作用域 `<key>::px::…`，内存 + 库）；「移除校色」/ 清除用 */
export async function deletePixelsOf(key: string, opts: { memoryOnly?: boolean } = {}) {
  if (!key) return
  const prefix = `${key}::px::`
  for (const scope of [...memory.keys()]) if (scope.startsWith(prefix)) memDelete(scope)
  if (opts.memoryOnly) return
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
