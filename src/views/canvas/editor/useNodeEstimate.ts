/**
 * 生成卡预计点数（原 NodeParamsPanel 的防抖估价搬到这里，卡片底栏与其它入口共用一份）。
 *
 * <p>图片模型：模型 / 尺寸 / 张数 / 画质 / 参考图数 / 提示词长度变化后防抖 400ms 请求 Go POST /canvas/estimate（与冻结同一公式）；
 * 失败退回目录静态价表并标「约」。视频仍用静态表。
 *
 * <p>防请求风暴：结果按请求体签名做模块级缓存（同参数的多张卡只发一次、5 分钟内不重发），
 * 同签名在途请求复用同一个 Promise，全局并发上限 2；参数没变不重发，参数变了旧结果直接丢弃（按签名比对）。
 */
import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { canvasEstimate, type ICanvasEstimateReq, type ICanvasEstimateResp } from '@/api/canvas-home.ts'
import { normalizeHandle } from './graph.ts'
import { rememberSettleMode, useCanvasEditor } from './useCanvasEditor.ts'
import type { CanvasNodeData } from './types.ts'

const CACHE_TTL = 5 * 60_000
const MAX_CONCURRENT = 2
const DEBOUNCE_MS = 400

/** 签名 → 结果（null = 不可用 / 失败） */
const cache = new Map<string, { at: number; value: ICanvasEstimateResp | null }>()
const inflight = new Map<string, Promise<ICanvasEstimateResp | null>>()
let running = 0
const waiting: (() => void)[] = []

function acquire(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running++
    return Promise.resolve()
  }
  return new Promise((resolve) => waiting.push(() => (running++, resolve())))
}
function release() {
  running--
  waiting.shift()?.()
}

function requestEstimate(sig: string, req: ICanvasEstimateReq): Promise<ICanvasEstimateResp | null> {
  const hit = cache.get(sig)
  if (hit && Date.now() - hit.at < CACHE_TTL) return Promise.resolve(hit.value)
  const pending = inflight.get(sig)
  if (pending) return pending
  const task = (async () => {
    await acquire()
    try {
      const res = await canvasEstimate(req)
      const data = res.data
      const value = data?.available && Number(data.points) > 0 ? data : null
      if (value) rememberSettleMode(req.model_id ?? req.model ?? '', value.settle_mode)
      cache.set(sig, { at: Date.now(), value })
      return value
    } catch {
      // 失败不缓存，下次参数变化再试
      return null
    } finally {
      release()
      inflight.delete(sig)
    }
  })()
  inflight.set(sig, task)
  return task
}

/** 底栏展示口径 */
export type NodeEstimateKind = 'actual' | 'fixed' | 'static' | 'none'

export interface INodeEstimate {
  kind: NodeEstimateKind
  /** 点数（none 时为 0） */
  points: number
}

export function isActualCost(mode?: string): boolean {
  return (mode ?? '').toLowerCase() === 'actual_cost'
}

export function useNodeEstimate(nodeId: Ref<string> | (() => string), data: () => CanvasNodeData) {
  const store = useCanvasEditor()
  const idOf = typeof nodeId === 'function' ? nodeId : () => nodeId.value

  const isVideo = computed(() => data().kind === 'video')
  const currentModel = computed(() => {
    const catalog = store.catalog.value
    const list = isVideo.value ? catalog?.video_models : catalog?.imageModels
    const d = data()
    return list?.find((item) => item.modelId === d.modelId) ?? list?.find((item) => item.model === d.model)
  })

  /** 静态价表：单价 × 张数（视频单价已按所选时长，1 条） */
  const staticPoints = computed(() => {
    const d = data()
    const hit = currentModel.value?.prices?.find(
      (price) =>
        (d.size ? price.size === d.size : true) && (isVideo.value && d.duration ? price.duration === d.duration : true),
    )
    if (!hit) return null
    // 旧快照的数量可能超过当前模型上限：只在估算时夹紧，不改写快照
    const countCap = Math.max(1, currentModel.value?.countMax ?? 4)
    const count = isVideo.value ? 1 : Math.min(countCap, Math.max(1, Math.round(Number(d.count) || 1)))
    return hit.points * count
  })

  /** 提示词长度：优先取连到 prompt 口的上游文本，其次节点自己的提示词 */
  function promptLength(): number {
    const id = idOf()
    const edge = store.edges.value.find((item) => item.target === id && normalizeHandle(item.targetHandle) === 'prompt')
    const upstream = edge ? (store.findNode(edge.source)?.data as { text?: string } | undefined) : undefined
    return [...(upstream?.text ?? data().prompt ?? '')].length
  }

  const estimateReq = computed<ICanvasEstimateReq | null>(() => {
    const d = data()
    const model = currentModel.value
    if (d.inputOnly || isVideo.value || !model) return null
    const id = idOf()
    const countCap = Math.max(1, model.countMax ?? 4)
    return {
      model_id: model.modelId || undefined,
      model: model.model || undefined,
      size: d.size || undefined,
      count: Math.min(countCap, Math.max(1, Math.round(Number(d.count) || 1))),
      // 模型没有画质能力时不传，避免估价按一个无效画质算
      quality: model.capabilities.quality ? d.quality || undefined : undefined,
      ref_images: store.edges.value.filter(
        (edge) =>
          edge.target === id &&
          normalizeHandle(edge.targetHandle) !== 'prompt' &&
          normalizeHandle(edge.targetHandle) !== 'video',
      ).length,
      prompt_chars: promptLength(),
    }
  })

  const remote = ref<ICanvasEstimateResp | null>(null)
  /** 当前签名的请求还没回来（且没有可用的旧结果）：底栏显示占位 */
  const loading = ref(false)
  let currentSig = ''
  let timer: ReturnType<typeof setTimeout> | undefined

  function apply(sig: string, value: ICanvasEstimateResp | null) {
    if (sig !== currentSig) return
    remote.value = value
    loading.value = false
  }

  watch(
    estimateReq,
    (req) => {
      clearTimeout(timer)
      if (!req) {
        currentSig = ''
        remote.value = null
        loading.value = false
        return
      }
      const sig = JSON.stringify(req)
      if (sig === currentSig) return
      currentSig = sig
      const hit = cache.get(sig)
      if (hit && Date.now() - hit.at < CACHE_TTL) {
        apply(sig, hit.value)
        return
      }
      // 首次没有结果时才显示占位；已有旧结果就保留旧值直到新值回来，底栏不闪
      if (!remote.value) loading.value = true
      timer = setTimeout(() => void requestEstimate(sig, req).then((value) => apply(sig, value)), DEBOUNCE_MS)
    },
    { immediate: true },
  )
  onBeforeUnmount(() => clearTimeout(timer))

  const estimate = computed<INodeEstimate>(() => {
    const value = remote.value
    if (value) return { kind: isActualCost(value.settle_mode) ? 'actual' : 'fixed', points: Number(value.points) }
    if (staticPoints.value !== null) return { kind: 'static', points: staticPoints.value }
    return { kind: 'none', points: 0 }
  })

  return { estimate, loading, currentModel }
}
