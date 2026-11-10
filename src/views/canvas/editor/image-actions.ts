/**
 * 画布图片动作（识别 / 图片编辑 / 多视图 / 图层）的共享状态与工具函数。
 *
 * <p>接口见 api/agent.ts「画布动作」一节（契约 contracts/user-api-compat-v1/manifest.json agent/canvas/*）：
 * 识别同步不计费；编辑 / 多视图 / 图层异步计费，返回 taskId(s)。编辑与多视图按通用任务读模型
 * GET /api/v1/tasks/{taskUid} 轮询（status + result.url）；图层走专用读接口 pollCanvasImageLayer。
 *
 * <p>产物写回：每张结果新建一个「结果图」图片节点（kind=result，只有 image-in 一个输入口），
 * 从取图的来源节点连过去。服务端只剥离 model / tool 节点的成品字段，image 节点的 image 会随快照保存。
 */
import { reactive, ref } from 'vue'
import { get, toApiError } from '@/api/index.ts'
import { canvasIdentify, type CanvasPoint, type ICanvasIdentifyReq } from '@/api/agent.ts'
import { useCanvasEditor } from './useCanvasEditor.ts'
import type { CanvasEditorNode, CanvasNodeData } from './types.ts'

export type ImageActionKind = 'identify' | 'edit' | 'multiview' | 'layer'

export const IMAGE_ACTIONS: { kind: ImageActionKind; label: string; icon: string }[] = [
  { kind: 'identify', label: '识别', icon: 'search' },
  { kind: 'edit', label: '图片编辑', icon: 'brush' },
  { kind: 'multiview', label: '多视图', icon: 'copy' },
  { kind: 'layer', label: '图层', icon: 'layers' },
]

export const actionLabel = (kind: ImageActionKind) => IMAGE_ACTIONS.find((item) => item.kind === kind)?.label ?? ''

// ---------------- 面板开关（模块级单例：节点菜单打开，编辑器根组件渲染） ----------------

export const activeImageAction = ref<{ kind: ImageActionKind; nodeId: string } | null>(null)

export function openImageAction(nodeId: string, kind: ImageActionKind): void {
  activeImageAction.value = { kind, nodeId }
}

export function closeImageAction(): void {
  activeImageAction.value = null
}

// ---------------- 取图：节点自身的图 + 直接上游的图 ----------------

export interface IImageSource {
  /** 列表键（节点 + 地址） */
  key: string
  /** 图片所在节点：结果节点从它连出 */
  nodeId: string
  url: string
  label: string
  /** 来源节点的输出口 id（与节点组件 source Handle 一致） */
  sourceHandle: string
  /** true = 取自直接上游 */
  upstream: boolean
}

function nodeImages(node: CanvasEditorNode): { url: string; handle: string }[] {
  const data = node.data
  if (node.type === 'image') return data.image ? [{ url: data.image, handle: 'image' }] : []
  if (node.type === 'model') {
    if (data.kind !== 'model' || data.inputOnly) return []
    const list = data.candidates?.length ? data.candidates : data.image ? [data.image] : []
    return list.filter(Boolean).map((url) => ({ url, handle: 'image-out' }))
  }
  if (node.type === 'tool') {
    if (data.tool === 'i2p') return []
    const list = data.candidates?.length ? data.candidates : [data.resultImage ?? data.image ?? '']
    return list.filter(Boolean).map((url) => ({ url, handle: 'image-out' }))
  }
  return []
}

export function collectImageSources(nodeId: string): IImageSource[] {
  const store = useCanvasEditor()
  const node = store.findNode(nodeId)
  if (!node) return []
  const out: IImageSource[] = []
  const seen = new Set<string>()
  const push = (owner: CanvasEditorNode, upstream: boolean) => {
    const images = nodeImages(owner)
    images.forEach((image, index) => {
      if (seen.has(image.url)) return
      seen.add(image.url)
      const title = owner.data.title || '图片'
      const suffix = images.length > 1 ? ` · 第 ${index + 1} 张` : ''
      out.push({
        key: `${owner.id}:${image.url}`,
        nodeId: owner.id,
        url: image.url,
        label: upstream ? `上游 ${title}${suffix}` : `${title}${suffix}`,
        sourceHandle: image.handle,
        upstream,
      })
    })
  }
  push(node, false)
  for (const edge of store.edges.value) {
    if (edge.target !== nodeId) continue
    const upstream = store.findNode(edge.source)
    if (upstream) push(upstream, true)
  }
  return out
}

/** 识别接口只收 jpg / jpeg / png / webp（按地址路径后缀判，与服务端同口径） */
export function identifiableUrl(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0] ?? ''
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 && ['jpg', 'jpeg', 'png', 'webp'].includes(name.slice(dot + 1).toLowerCase())
}

// ---------------- 结果写回 ----------------

/**
 * 每张结果新建一个结果图节点，排在来源节点右侧一列，并从来源节点连到它的 image-in 口。
 * 新建会改选中节点，结束后还原原选中，避免控制台跳到新节点上盖住面板。
 */
export function addResultNodes(
  source: IImageSource,
  urls: string[],
  origin: NonNullable<CanvasNodeData['actionOrigin']>,
  title: string,
): string[] {
  const store = useCanvasEditor()
  const owner = store.findNode(source.nodeId)
  if (!owner || !urls.length) return []
  const previous = store.selectedNodeId.value
  const existing = store.edges.value.filter(
    (edge) => edge.source === owner.id && store.findNode(edge.target)?.data.actionOrigin,
  ).length
  const baseX = owner.position.x + (owner.data.width ?? 280) + 80
  const created: string[] = []
  urls.forEach((url, index) => {
    const slot = existing + index
    const node = store.addNode('image', undefined, {
      x: baseX + Math.floor(slot / 4) * 280,
      y: owner.position.y + (slot % 4) * 260,
    })
    if (!node) return
    store.updateNodeData(node.id, {
      kind: 'result',
      image: url,
      title: urls.length > 1 ? `${title} ${index + 1}` : title,
      actionOrigin: origin,
    })
    store.connect({ source: owner.id, target: node.id, sourceHandle: source.sourceHandle, targetHandle: 'image-in' })
    created.push(node.id)
  })
  store.selectNode(previous)
  return created
}

// ---------------- 区域（识别结果，编辑面板复用） ----------------

/** 0–1 比例坐标 */
export type RatioPoint = [number, number]

export interface IActionRegion {
  key: string
  /** 区域所在图片 */
  url: string
  shape: 'point' | 'box'
  /** 点选 1 个点；框选为左上、右下 2 个点 */
  points: RatioPoint[]
  status: 'pending' | 'done' | 'error'
  /** 识别返回的 region_ 前缀 id */
  id?: string
  label: string
  description: string
  error?: string
}

const regionStore = reactive<Record<string, IActionRegion[]>>({})
let regionSeq = 0

const NO_REGIONS: IActionRegion[] = []

/** 只读取用（computed / 模板里调用，不在读取时写入响应式表） */
export function regionsOf(url: string): IActionRegion[] {
  return regionStore[url] ?? NO_REGIONS
}

function ensureRegions(url: string): IActionRegion[] {
  if (!regionStore[url]) regionStore[url] = []
  return regionStore[url]
}

export function removeRegion(url: string, key: string): void {
  const list = ensureRegions(url)
  const index = list.findIndex((item) => item.key === key)
  if (index >= 0) list.splice(index, 1)
}

const ratio = (value: number) => Math.min(1, Math.max(0, value)).toFixed(4)
const toPoint = (point: RatioPoint): CanvasPoint => [ratio(point[0]), ratio(point[1])]

/** 识别请求：点选传 point；框选传 points（两点 = 矩形框） */
function identifyRequest(region: IActionRegion): ICanvasIdentifyReq {
  const [first, second] = region.points
  if (region.shape === 'box' && first && second) {
    return { imageUrl: region.url, points: [toPoint(first), toPoint(second)] }
  }
  return { imageUrl: region.url, point: toPoint(first ?? [0.5, 0.5]) }
}

/** 编辑区域的 bbox：点选 1 个点，框选 4 个角点（服务端只收 1 或 4 个点） */
export function regionBbox(region: IActionRegion): CanvasPoint[] {
  const [first, second] = region.points
  if (region.shape === 'box' && first && second) {
    return [toPoint(first), toPoint([second[0], first[1]]), toPoint(second), toPoint([first[0], second[1]])]
  }
  return [toPoint(first ?? [0.5, 0.5])]
}

/** 区域外接框（点选按点周围 ±10% 取），用于缩略图裁切 */
export function regionRect(region: IActionRegion): { x: number; y: number; w: number; h: number } {
  const [first, second] = region.points
  if (region.shape === 'box' && first && second) {
    return {
      x: first[0],
      y: first[1],
      w: Math.max(0.01, second[0] - first[0]),
      h: Math.max(0.01, second[1] - first[1]),
    }
  }
  const [px, py] = first ?? [0.5, 0.5]
  const x = Math.min(0.8, Math.max(0, px - 0.1))
  const y = Math.min(0.8, Math.max(0, py - 0.1))
  return { x, y, w: 0.2, h: 0.2 }
}

/** 新建区域并立即识别 */
export function addRegion(url: string, shape: 'point' | 'box', points: RatioPoint[]): IActionRegion {
  regionSeq += 1
  const list = ensureRegions(url)
  list.push({ key: `r${Date.now()}_${regionSeq}`, url, shape, points, status: 'pending', label: '', description: '' })
  const region = list[list.length - 1] as IActionRegion
  void identifyRegion(region)
  return region
}

export async function identifyRegion(region: IActionRegion): Promise<void> {
  region.status = 'pending'
  region.error = undefined
  try {
    const res = await canvasIdentify(identifyRequest(region))
    if (!res.data?.id) throw new Error('没有识别出主体，换个位置再试')
    region.id = res.data.id
    region.label = res.data.label ?? ''
    region.description = res.data.description ?? ''
    region.status = 'done'
  } catch (err) {
    region.status = 'error'
    region.error = describeError(err, '识别失败，请重试').message
  }
}

// ---------------- 错误与幂等 ----------------

export const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError'

/**
 * 失败归类：unknown = 请求可能已被受理（断网 / 超时 / 5xx），重试必须沿用同一个幂等键，否则会重复扣点。
 */
export function describeError(err: unknown, fallback: string): { message: string; unknown: boolean } {
  if (isAbort(err)) return { message: '已停止等待', unknown: false }
  const api = toApiError(err)
  if (api) {
    if (api.isNetwork) return { message: '网络异常，提交结果未知。重试会沿用这次提交，不会重复扣点', unknown: true }
    if (api.httpStatus === 402 || api.code === 402 || api.reason === 'INSUFFICIENT_POINTS') {
      return { message: '点数不足，请充值后再试', unknown: false }
    }
    if (api.httpStatus && api.httpStatus >= 500) {
      return { message: '服务暂时不可用，请稍后重试', unknown: true }
    }
    return { message: api.message || fallback, unknown: false }
  }
  return { message: err instanceof Error && err.message ? err.message : fallback, unknown: false }
}

/** 查询进度的接口连续失败：任务本身可能还在跑，重试应接着查而不是重新提交 */
export const POLL_BROKEN = '查询进度失败，任务可能还在进行，可以继续查询'

// ---------------- 通用任务轮询（编辑 / 多视图） ----------------

/** /api/v1/tasks/{taskUid} 读模型里用到的字段 */
export interface ICompatTaskView {
  taskUid: string
  status: string
  result?: { url?: string | null } | null
  errorCode?: string | null
  errorMessage?: string | null
}

const TASK_FAILED = new Set(['FAILED', 'TIMEOUT', 'CANCELLED'])

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

/**
 * 轮询一个任务直到成功（有 result.url）或失败。只读接口：连续失败 maxErrors 次才抛出；
 * 超过 timeoutMs 抛「等待超时」（任务仍在后台进行）。
 */
export async function pollCompatTask(
  taskUid: string,
  opts: { signal: AbortSignal; intervalMs?: number; maxErrors?: number; timeoutMs?: number },
): Promise<ICompatTaskView> {
  const interval = opts.intervalMs ?? 3000
  const maxErrors = opts.maxErrors ?? 3
  const deadline = Date.now() + (opts.timeoutMs ?? 15 * 60 * 1000)
  let errors = 0
  for (;;) {
    if (opts.signal.aborted) throw new DOMException('aborted', 'AbortError')
    try {
      const res = await get<ICompatTaskView>(`/api/v1/tasks/${encodeURIComponent(taskUid)}`)
      errors = 0
      const view = res.data
      if (view?.status === 'SUCCEED') {
        if (!view.result?.url) throw new Error('任务完成了，但没有拿到图片')
        return view
      }
      if (view && TASK_FAILED.has(view.status)) {
        throw new Error(view.errorMessage || (view.status === 'TIMEOUT' ? '生成超时' : '生成失败'))
      }
    } catch (err) {
      if (!toApiError(err)) throw err
      if (++errors >= maxErrors) throw err
    }
    if (Date.now() > deadline) throw new Error('等待超时，任务仍在后台进行')
    await abortableSleep(interval, opts.signal)
  }
}

// ---------------- 图层结果解析 ----------------

const IMAGE_KEYS = ['url', 'imageUrl', 'image', 'src', 'layerUrl', 'pngUrl']
const NAME_KEYS = ['name', 'label', 'title', 'type', 'layerName']
const HTTP = /^https?:\/\//i

export interface ILayerItem {
  url: string
  name: string
}

/**
 * 图层正文结构由执行方定义（键名 lowerCamel，素材地址已替换为我方地址）：
 * 深度遍历，凡是带图片地址字段的对象算一层，名字取常见名称键；去重并排除原图。
 */
export function extractLayers(content: unknown, sourceUrl: string): ILayerItem[] {
  const out: ILayerItem[] = []
  const seen = new Set<string>([sourceUrl])
  const visit = (value: unknown, depth: number) => {
    if (depth > 8 || value == null) return
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1))
      return
    }
    if (typeof value !== 'object') return
    const record = value as Record<string, unknown>
    const key = IMAGE_KEYS.find((name) => typeof record[name] === 'string' && HTTP.test(record[name] as string))
    if (key) {
      const url = record[key] as string
      if (!seen.has(url)) {
        seen.add(url)
        const nameKey = NAME_KEYS.find((name) => typeof record[name] === 'string' && record[name])
        out.push({ url, name: nameKey ? String(record[nameKey]) : `图层 ${out.length + 1}` })
      }
    }
    for (const [name, child] of Object.entries(record)) {
      if (name !== key && child && typeof child === 'object') visit(child, depth + 1)
    }
  }
  visit(content, 0)
  return out
}

/** 秒数 → 「1 分 05 秒」 */
export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`
}
