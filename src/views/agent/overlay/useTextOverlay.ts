/**
 * 模板文字叠加：出图后对每张成品图调用叠字接口（并发 ≤3、逐张独立），并管理每张图的叠字状态。
 * 叠字失败不影响原图交付；刷新后用 GET 恢复已有结果。
 */
import { reactive, ref } from 'vue'
import {
  OVERLAY_QUERY_MAX,
  overlayCreate,
  overlayList,
  overlayUpdate,
  type IOverlay,
} from './api.ts'
import type { IOverlayCtx, IOverlayField } from './overlayLayout.ts'

/** 「本次给图片加字」开关（默认开）：输入区与出图后共用，模块级单例 */
export const overlayEnabled = ref(true)

export interface IOverlayEntry {
  overlay: IOverlay | null
  /** 进行中的动作：creating 首次叠字 / retrying 重试 / editing 改文字 */
  phase: 'creating' | 'retrying' | 'editing' | null
  /** 用户切到无字版 */
  showOriginal: boolean
  ctx: IOverlayCtx | null
  /** 首次请求本身失败（网络 / 业务错误），没有 overlay 记录 */
  requestFailed: boolean
}

export const OVERLAY_CONCURRENCY = 3

export interface IOverlayApi {
  create: typeof overlayCreate
  update: typeof overlayUpdate
  list: typeof overlayList
}

const defaultApi: IOverlayApi = { create: overlayCreate, update: overlayUpdate, list: overlayList }

export function createTextOverlay(api: IOverlayApi = defaultApi, enabled = overlayEnabled) {
  const entries = reactive<Record<string, IOverlayEntry>>({})
  /** 已发起过恢复查询的原图（避免历史图每次渲染都查） */
  const queried = new Set<string>()

  const entryOf = (src: string): IOverlayEntry | undefined => entries[src]
  const isOk = (e?: IOverlayEntry) => !!e && e.overlay?.status === 'ok' && !!e.overlay.renderedUrl

  /** 当前应展示的版本地址（预览 / 下载 / 存素材都用它） */
  function displayUrl(src: string): string {
    const e = entries[src]
    return e && isOk(e) && !e.showOriginal ? (e.overlay!.renderedUrl as string) : src
  }

  function setOverlay(src: string, ov: IOverlay) {
    const e = entries[src]
    if (!e) return
    e.overlay = ov
    e.requestFailed = false
    e.phase = null
    // 成功后默认切到叠字版
    if (ov.status === 'ok') e.showOriginal = false
  }

  function fresh(ctx: IOverlayCtx | null, phase: IOverlayEntry['phase']): IOverlayEntry {
    return { overlay: null, phase, showOriginal: false, ctx, requestFailed: false }
  }

  async function queryExisting(urls: string[]) {
    const found = new Map<string, IOverlay>()
    for (let i = 0; i < urls.length; i += OVERLAY_QUERY_MAX) {
      try {
        for (const ov of await api.list(urls.slice(i, i + OVERLAY_QUERY_MAX))) found.set(ov.sourceUrl, ov)
      } catch {
        /* 查不到就当没有 */
      }
    }
    return found
  }

  async function createOne(src: string, ctx: IOverlayCtx) {
    try {
      const ov = await api.create(ctx.templateId, src, ctx.values)
      if (ov) setOverlay(src, ov)
      else throw new Error('empty')
    } catch {
      const e = entries[src]
      if (e) {
        e.phase = null
        e.requestFailed = true
      }
    }
  }

  async function pool<T>(list: T[], n: number, fn: (x: T) => Promise<void>) {
    let i = 0
    await Promise.all(
      Array.from({ length: Math.min(n, list.length) }, async () => {
        while (i < list.length) await fn(list[i++] as T)
      }),
    )
  }

  /** 本轮出图后：对还没叠过的图叠字（先查已有，已有的直接用；幂等，可反复调用） */
  async function ensure(ctx: IOverlayCtx | null, urls: string[]) {
    if (!ctx || !enabled.value) return
    const todo = [...new Set(urls)].filter((u) => u && !entries[u])
    if (!todo.length) return
    for (const u of todo) {
      entries[u] = fresh(ctx, 'creating')
      queried.add(u)
    }
    const found = await queryExisting(todo)
    const need: string[] = []
    for (const u of todo) {
      const ov = found.get(u)
      if (ov) setOverlay(u, ov)
      else need.push(u)
    }
    await pool(need, OVERLAY_CONCURRENCY, (u) => createOne(u, ctx))
  }

  /** 刷新 / 历史消息：只恢复已有叠字结果，不新建 */
  async function restore(urls: string[]) {
    const todo = [...new Set(urls)].filter((u) => u && !entries[u] && !queried.has(u))
    if (!todo.length) return
    for (const u of todo) queried.add(u)
    const found = await queryExisting(todo)
    for (const [u, ov] of found) {
      if (entries[u]) continue
      entries[u] = fresh(null, null)
      setOverlay(u, ov)
    }
  }

  /** 重试：有记录走 PUT（按已存文字重做，不重新出图不扣点），没有记录（首次请求就失败）重新 POST */
  async function retry(src: string) {
    const e = entries[src]
    if (!e || e.phase) return
    e.phase = 'retrying'
    try {
      if (e.overlay) {
        const ov = await api.update(e.overlay.id)
        if (ov) setOverlay(src, ov)
        else e.phase = null
      } else if (e.ctx) {
        await createOne(src, e.ctx)
      } else e.phase = null
    } catch {
      e.phase = null
    }
  }

  /** 改文字：成功返回 true；失败返回 false（调用方保持窗口并提示） */
  async function edit(src: string, values: Record<string, string>): Promise<boolean> {
    const e = entries[src]
    if (!e?.overlay || e.phase) return false
    e.phase = 'editing'
    try {
      const ov = await api.update(e.overlay.id, values)
      if (!ov) throw new Error('empty')
      setOverlay(src, ov)
      return true
    } catch {
      e.phase = null
      return false
    }
  }

  function setShowOriginal(src: string, v: boolean) {
    const e = entries[src]
    if (e) e.showOriginal = v
  }

  /** 改文字窗口要列出的位：优先本轮 ctx 的版式位，没有（刷新恢复）退到 overlay.values 的 key */
  function fieldsOf(src: string): IOverlayField[] {
    const e = entries[src]
    if (!e) return []
    if (e.ctx?.fields.length) return e.ctx.fields
    return Object.keys(e.overlay?.values ?? {}).map((key) => ({ key, label: key }))
  }

  return { entries, entryOf, displayUrl, ensure, restore, retry, edit, setShowOriginal, fieldsOf }
}

export type TextOverlay = ReturnType<typeof createTextOverlay>

export function useTextOverlay(): TextOverlay {
  return createTextOverlay()
}
