/**
 * 画布编辑器 —— 连线规则与运行时引用构建。
 *
 * <p>规则表见契约第 6 章（以原型 validateConnection 为准，服务端保存 / 执行时再校一遍）；
 * 线色存进连线 data.color（快照私有字段，与原型一致），端口配色沿用同一语义。
 */
import type { CanvasEditorEdge, CanvasEditorNode, CanvasEditorNodeData, CanvasToolKind } from './types'
import { candidateIndexOf } from './types'
import type { ICanvasRunRef } from '@/api/canvas-home.ts'
import { modelLabelOf } from '@/utils/model-label'

export type CanvasInputHandle = 'prompt' | 'image' | 'video' | 'audio' | 'garment' | 'models' | 'image-in'

/** 端口语义规则：接受的来源节点类型 / 容量 / 线色（线色是快照数据，与原型一致） */
export const INPUT_HANDLE_RULES: Record<
  CanvasInputHandle,
  { accepts: CanvasEditorNode['type'][]; color: string; label: string }
> = {
  prompt: { accepts: ['text', 'tool'], color: '#22c55e', label: '提示词' },
  image: { accepts: ['image', 'model', 'video', 'tool'], color: '#38bdf8', label: '参考图' },
  video: { accepts: ['model'], color: '#f97373', label: '参考视频' },
  audio: { accepts: [], color: '#a78bfa', label: '音频' },
  garment: { accepts: ['image', 'model', 'video', 'tool'], color: '#875f9a', label: '服装' },
  models: { accepts: ['image', 'model', 'video', 'tool'], color: '#2f80ed', label: '模特' },
  'image-in': { accepts: ['image', 'model', 'video', 'tool'], color: '#38bdf8', label: '图片' },
}

/** 视频首尾帧等别名归并：image1/image2/first/last 单独保留口名（提交时按原口名） */
export function normalizeHandle(handle?: string | null): CanvasInputHandle | null {
  if (handle && handle in INPUT_HANDLE_RULES) return handle as CanvasInputHandle
  if (handle === 'first' || handle === 'image1' || handle === 'image2' || handle === 'last') return 'image'
  return null
}

/**
 * 同口内参考的排序键（run 请求 references[].index 与控制台「图N」共用，保证两边编号一致）：
 * 首帧（image1）、尾帧（image2）固定排在最前、各占一个序号，普通参考按连线 data.order 接在后面。
 * 首尾帧不参与拖拽排序，它们自己的 order 值不再影响普通参考的编号，拖拽后「图N」连续且稳定。
 */
export function compareRefOrder(
  a: { handle?: string | null; order?: number },
  b: { handle?: string | null; order?: number },
): number {
  const rank = (handle?: string | null) => (handle === 'image1' ? 0 : handle === 'image2' ? 1 : 2)
  return rank(a.handle) - rank(b.handle) || (a.order ?? 0) - (b.order ?? 0)
}

export function edgeColorForHandle(handle?: string | null): string {
  const normalized = normalizeHandle(handle)
  if (!normalized) return INPUT_HANDLE_RULES.image.color
  if (handle === 'image1' || handle === 'image2') return INPUT_HANDLE_RULES.image.color
  return INPUT_HANDLE_RULES[normalized].color
}

function reaches(edges: CanvasEditorEdge[], from: string, target: string): boolean {
  const stack = [from]
  const seen = new Set<string>()
  while (stack.length) {
    const id = stack.pop() ?? ''
    if (id === target) return true
    if (seen.has(id)) continue
    seen.add(id)
    for (const edge of edges) if (edge.source === id) stack.push(edge.target)
  }
  return false
}

export interface ICanvasConnection {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

/** 参考图容量：模型节点按 maxImageRefs（catalog 口径），其余口 1（模特口 9） */
function imageLimitFor(target: CanvasEditorNode): number {
  const data = target.data
  if (data.kind === 'model' || data.kind === 'video') return data.maxImageRefs ?? 5
  return 1
}

/**
 * 连线校验（契约 6.1）。targetHandle 为空的拖到节点主体时由调用方先解析出口名再进来。
 * @param pool 参与容量统计的既有连线（提示词口「新线替换旧线」，调用方先剔除旧 prompt 线）
 */
export function validateConnection(
  nodes: CanvasEditorNode[],
  pool: CanvasEditorEdge[],
  connection: ICanvasConnection,
): { ok: boolean; reason?: string; color: string; targetHandle?: string } {
  const rawTargetHandle = connection.targetHandle ?? ''
  const targetHandle = normalizeHandle(rawTargetHandle)
  const source = nodes.find((n) => n.id === connection.source)
  const target = nodes.find((n) => n.id === connection.target)
  const color = edgeColorForHandle(rawTargetHandle)
  if (!source || !target) return { ok: false, reason: '节点不存在', color }
  if (source.id === target.id) return { ok: false, reason: '不能连到自己', color }
  if (source.type === 'module' || target.type === 'module') return { ok: false, reason: '分组框不参与连线', color }
  if (target.type === 'text') return { ok: false, reason: '文字节点没有输入口', color }
  if (target.data.kind === 'video-input') return { ok: false, reason: '视频素材节点没有输入口', color }
  if (target.data.kind === 'input') return { ok: false, reason: '图片素材节点没有输入口', color }
  const sourceTool = source.data.kind === 'tool' ? source.data : null
  // prompt 口允许 tool 且 tool=i2p（反推文本），其余工具只有 image 口
  if (targetHandle === 'prompt' && sourceTool && sourceTool.tool !== 'i2p') {
    return { ok: false, reason: '提示词口只收文字节点或反推结果', color }
  }
  if (!targetHandle) return { ok: false, reason: '请连到有编号的输入端口', color }
  const rule = INPUT_HANDLE_RULES[targetHandle]
  if (target.type === 'image' && target.data.kind === 'result') {
    if (rawTargetHandle !== 'image-in') return { ok: false, reason: '结果图片只有一个输入口', color }
  } else if (!rule.accepts.includes(source.type)) {
    const reason =
      targetHandle === 'prompt'
        ? '提示词端口只收文字节点'
        : targetHandle === 'video'
          ? '参考视频端口只收视频模型的输出'
          : targetHandle === 'audio'
            ? '音频参考暂未接入'
            : '参考图端口只收图片或模型输出'
    return { ok: false, reason, color }
  }
  // 试穿口只属于试穿工具；试穿工具不收普通 image 口（契约 6.1）
  const targetIsTryon = target.type === 'tool' && target.data.tool === 'tryon'
  if ((targetHandle === 'garment' || targetHandle === 'models') && !targetIsTryon) {
    return { ok: false, reason: '服装 / 模特口只属于模特试穿工具', color }
  }
  if (targetIsTryon && targetHandle !== 'garment' && targetHandle !== 'models') {
    return { ok: false, reason: '模特试穿只有服装、模特两个输入口', color }
  }
  if (targetHandle === 'video' && !(source.type === 'model' && source.data.kind === 'video')) {
    return { ok: false, reason: '参考视频端口只收视频模型的输出', color }
  }
  const isVideoFramePort =
    target.type === 'model' &&
    target.data.kind === 'video' &&
    (rawTargetHandle === 'image1' || rawTargetHandle === 'image2')
  // 参考视频口上限 1（契约 6.1 / validate.go portLimit），不按参考图上限算
  const limit = isVideoFramePort || targetHandle === 'video' ? 1 : targetHandle === 'models' ? 9 : imageLimitFor(target)
  const used = pool.filter((edge) => {
    if (edge.target !== target.id) return false
    if (isVideoFramePort || (target.type === 'image' && target.data.kind === 'result')) {
      return (edge.targetHandle ?? '') === rawTargetHandle
    }
    return normalizeHandle(edge.targetHandle) === targetHandle
  }).length
  if (isVideoFramePort && used < limit) {
    // 首 / 次图口同时占 image 的名额
    const total = pool.filter(
      (edge) => edge.target === target.id && normalizeHandle(edge.targetHandle) === 'image',
    ).length
    const cap = imageLimitFor(target)
    if (total >= cap) return { ok: false, reason: `${rule.label}最多接 ${cap} 条`, color }
  }
  if (used >= limit) {
    const label = isVideoFramePort
      ? rawTargetHandle === 'image1'
        ? '首帧'
        : '尾帧'
      : targetHandle === 'models'
        ? '模特'
        : rule.label
    return { ok: false, reason: `${label}最多接 ${limit} 条`, color }
  }
  if (reaches(pool, target.id, source.id)) {
    return { ok: false, reason: '会形成环，已阻止', color }
  }
  return { ok: true, color, targetHandle: rawTargetHandle || targetHandle }
}

/** 同一对 (source, sourceHandle, target, targetHandle) 不重复 */
export function isDuplicateEdge(edges: CanvasEditorEdge[], conn: ICanvasConnection): boolean {
  return edges.some(
    (edge) =>
      edge.source === conn.source &&
      edge.target === conn.target &&
      (edge.sourceHandle ?? '') === (conn.sourceHandle ?? '') &&
      (edge.targetHandle ?? '') === (conn.targetHandle ?? ''),
  )
}

// ---------------- 运行时引用构建（契约 3.1 references[]） ----------------

interface IRawRef extends ICanvasRunRef {
  order: number
}

/** 来源节点喂给引用的文本 / 图片 / 视频 / 资产 id（i2p 工具的产出是文本，其余取成品图） */
function sourceMediaOf(
  node: CanvasEditorNode,
  candidateIndex: number,
): { text?: string; image?: string; video?: string; assetId?: string; mediaId?: string } {
  const data = node.data
  if (data.kind === 'text') return { text: data.text }
  if (data.kind === 'video-input') return { video: data.video, assetId: data.assetId, mediaId: data.mediaId }
  if (data.kind === 'tool') {
    return {
      text: data.tool === 'i2p' ? data.resultText : undefined,
      image: candidateIndex >= 0 ? data.candidates?.[candidateIndex] : (data.resultImage ?? data.image),
      assetId: data.assetId,
    }
  }
  if (data.kind === 'input' || data.kind === 'result') {
    return { image: data.image, assetId: data.assetId, mediaId: data.mediaId }
  }
  if (data.kind === 'module') return {}
  // 模型节点：候选单独连线带对应候选，否则取当前选中（默认第一张）
  const candidates = data.candidates ?? []
  return {
    image: candidateIndex >= 0 ? candidates[candidateIndex] : (candidates[data.selectedCandidate ?? 0] ?? data.image),
    video: data.video,
    assetId: data.assetId,
    mediaId: data.mediaId,
  }
}

/**
 * 工具节点的输入图（连到 image 口的上游成品；没连线时用 data.sourceNodeId 指定的上游）。
 * 与 buildReferences 同口径：候选单独连线取对应候选。节点上的裁剪框选 / 预览用。
 */
export function toolSourceImage(nodes: CanvasEditorNode[], edges: CanvasEditorEdge[], toolId: string): string {
  const tool = nodes.find((node) => node.id === toolId)
  if (!tool || tool.data.kind !== 'tool') return ''
  const edge = edges.find((item) => item.target === toolId && (item.targetHandle ?? 'image') === 'image')
  const sourceId = edge?.source ?? tool.data.sourceNodeId ?? ''
  const source = sourceId ? nodes.find((node) => node.id === sourceId) : undefined
  if (!source || source.type === 'module') return ''
  return sourceMediaOf(source, edge ? candidateIndexOf(edge.sourceHandle) : -1).image ?? ''
}

/** 把引用对象去掉内部排序字段，按口语义补 1..n 序号 */
function emitRef(ref: IRawRef, index?: number): ICanvasRunRef {
  const out: ICanvasRunRef = {
    handle: ref.handle,
    nodeId: ref.nodeId,
    text: ref.text,
    image: ref.image,
    video: ref.video,
    assetId: ref.assetId,
    mediaId: ref.mediaId,
    sourceHandle: ref.sourceHandle,
    candidateIndex: ref.candidateIndex,
  }
  if (index !== undefined) out.index = index
  return out
}

/**
 * 把目标节点的入边折叠成 run 请求的 references[]：
 * 按 handle 分组（prompt → image → video → audio → 其它），组内按连线 data.order 排序后编 1..n；
 * 图片候选单独连线带 candidate_index（0 起）。
 */
export function buildReferences(
  nodes: CanvasEditorNode[],
  edges: CanvasEditorEdge[],
  targetId: string,
): ICanvasRunRef[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const raw: IRawRef[] = []
  for (const edge of edges) {
    if (edge.target !== targetId) continue
    const source = nodeById.get(edge.source)
    const handle = edge.targetHandle ?? ''
    if (!source || source.type === 'module') continue
    const candidateIndex = candidateIndexOf(edge.sourceHandle)
    const media = sourceMediaOf(source, candidateIndex)
    raw.push({
      handle,
      nodeId: source.id,
      text: media.text,
      image: media.image,
      video: media.video,
      assetId: media.assetId,
      mediaId: media.mediaId,
      sourceHandle: edge.sourceHandle ?? undefined,
      candidateIndex: candidateIndex >= 0 ? candidateIndex : undefined,
      order: edge.data?.order ?? 0,
    })
  }
  // 工具节点没连线时可用 data.sourceNodeId 指定上游图（契约 3.2）
  const target = nodeById.get(targetId)
  if (target && target.data.kind === 'tool' && !raw.some((ref) => ref.handle === 'image') && target.data.sourceNodeId) {
    const upstream = nodeById.get(target.data.sourceNodeId)
    const media = upstream ? sourceMediaOf(upstream, -1) : undefined
    if (upstream && media?.image) {
      raw.push({ handle: 'image', nodeId: upstream.id, image: media.image, assetId: media.assetId, order: 0 })
    }
  }
  const groups: Record<string, IRawRef[]> = {}
  for (const ref of raw) {
    const key = normalizeHandle(ref.handle) ?? ref.handle
    ;(groups[key] ??= []).push(ref)
  }
  const out: ICanvasRunRef[] = []
  let imageSeq = 0
  let videoSeq = 0
  let audioSeq = 0
  const orderedKeys = ['prompt', 'image', 'video', 'audio', 'garment', 'models', 'image-in']
  for (const key of orderedKeys) {
    const group = groups[key]
    if (!group) continue
    delete groups[key]
    group.sort(compareRefOrder)
    for (const ref of group) {
      if (key === 'prompt' || key === 'garment' || key === 'image-in') {
        out.push(emitRef(ref, 1))
      } else if (key === 'image' || key === 'models') {
        imageSeq += 1
        out.push(emitRef(ref, imageSeq))
      } else if (key === 'video') {
        videoSeq += 1
        out.push(emitRef(ref, videoSeq))
      } else if (key === 'audio') {
        audioSeq += 1
        out.push(emitRef(ref, audioSeq))
      } else {
        out.push(emitRef(ref))
      }
    }
  }
  // 兜底：未知口名也带上，避免静默丢输入
  for (const group of Object.values(groups)) {
    for (const ref of group) out.push(emitRef(ref))
  }
  return out
}

// ---------------- 节点工厂 ----------------

let seq = 0

export function nextNodeId(prefix: string): string {
  seq += 1
  return `${prefix}_${Date.now()}_${seq}`
}

export function nextEdgeId(): string {
  seq += 1
  return `e_${Date.now()}_${seq}`
}

/** 同类输入节点的默认标题自动编号（文字 1 / 图片 2 …） */
export function renumberDefaultTitles(nodes: CanvasEditorNode[]): void {
  const counters = new Map<string, number>()
  for (const node of nodes) {
    const base =
      node.type === 'text'
        ? '文字'
        : node.type === 'image'
          ? '图片'
          : node.type === 'video'
            ? '视频'
            : node.type === 'model'
              ? node.data.kind === 'video'
                ? '视频生成'
                : '图片生成'
              : ''
    if (!base) continue
    const title = (node.data.title ?? '').trim()
    const numbered = title.startsWith(`${base} `) && /^\d+$/.test(title.slice(base.length + 1))
    if (title !== base && !numbered) continue
    const next = (counters.get(base) ?? 0) + 1
    counters.set(base, next)
    const value = `${base} ${next}`
    if (node.data.title !== value) node.data.title = value
  }
}

export function spawnPosition(nodes: CanvasEditorNode[]): { x: number; y: number } {
  const n = nodes.length
  return { x: 140 + (n % 4) * 300, y: 140 + Math.floor(n / 4) * 320 }
}

export function makeTextNode(position?: { x: number; y: number }): CanvasEditorNode {
  return {
    id: nextNodeId('t'),
    type: 'text',
    position: position ?? { x: 160, y: 140 },
    data: { title: '文字', subtitle: '文字', kind: 'text', text: '', mentions: [] },
  }
}

export function makeImageNode(position?: { x: number; y: number }): CanvasEditorNode {
  return {
    id: nextNodeId('n'),
    type: 'image',
    position: position ?? { x: 140, y: 160 },
    data: { title: '图片', subtitle: '图片', kind: 'input', image: '' },
  }
}

/** 成组生成的分组底板（旧数据没有 isGroup 标记，按「分组」副标题认） */
export function isGroupPlate(node: CanvasEditorNode | undefined): boolean {
  return !!node && node.type === 'module' && (node.data.isGroup === true || node.data.subtitle === '分组')
}

/** 分组底板（2026-11-06 二轮「成组」）：虚线板，成员按几何包含算，拖板带成员走 */
export function makeModuleNode(
  position: { x: number; y: number },
  size: { width: number; height: number },
  title = '分组',
): CanvasEditorNode {
  return {
    id: nextNodeId('mod'),
    type: 'module',
    position,
    data: { title, subtitle: '分组', kind: 'module', isGroup: true, width: size.width, height: size.height },
    zIndex: -1,
  }
}

export function makeVideoNode(position?: { x: number; y: number }): CanvasEditorNode {
  return {
    id: nextNodeId('v'),
    type: 'video',
    position: position ?? { x: 140, y: 160 },
    data: { title: '视频', subtitle: '视频', kind: 'video-input', video: '' },
  }
}

const TOOL_LABELS: Record<CanvasToolKind, string> = {
  crop: '图片裁剪',
  upscale: '高清放大',
  outpaint: '扩图',
  i2p: '反推提示词',
  mask: '局部重绘',
  tryon: '模特试穿',
}

export function toolLabel(tool?: string): string {
  const key = (tool ?? '') as CanvasToolKind
  return TOOL_LABELS[key] ?? '工具'
}

export function makeToolNode(tool: CanvasToolKind, position?: { x: number; y: number }): CanvasEditorNode {
  return {
    id: nextNodeId('tool'),
    type: 'tool',
    position: position ?? { x: 360, y: 200 },
    data: {
      title: TOOL_LABELS[tool] ?? '工具',
      subtitle: '工具',
      kind: 'tool',
      tool,
      sourceNodeId: '',
      status: 'idle',
      ...(tool === 'crop' ? { crop: { shape: 'rect' as const, x: 0.1, y: 0.1, w: 0.6, h: 0.6 } } : {}),
      ...(tool === 'upscale' ? { scale: 2 } : {}),
      ...(tool === 'i2p' ? { language: 'zh' } : {}),
      ...(tool === 'outpaint' ? { ratio: '16:9' } : {}),
    },
  }
}

/** 模型生成节点默认参数；模型 / 能力由调用方按 catalog 回填 */
export function makeModelNode(kind: 'image' | 'video', position?: { x: number; y: number }): CanvasEditorNode {
  return {
    id: nextNodeId('m'),
    type: 'model',
    position: position ?? { x: 520, y: 180 },
    data: {
      title: kind === 'video' ? '视频生成' : '图片生成',
      subtitle: kind === 'video' ? '视频' : '图片',
      kind: kind === 'video' ? 'video' : 'model',
      model: '',
      modelId: '',
      maxImageRefs: kind === 'video' ? 3 : 5,
      capabilities: kind === 'video' ? { duration: true, sound: true } : { count: true },
      ratio: kind === 'video' ? '16:9' : '1:1',
      size: kind === 'video' ? '720p' : '1K',
      quality: 'medium',
      duration: kind === 'video' ? '4s' : undefined,
      sound: kind === 'video' ? true : undefined,
      count: 1,
      cfg: 0.95,
      prompt: '',
      status: 'idle',
    },
  }
}

/** 按 catalog 回填模型节点的模型参数（新建节点与面板换模型共用） */
export function applyModelToNode(
  data: CanvasEditorNodeData,
  model: {
    model: string
    modelId: string
    badge?: string
    maxImageRefs: number
    ratios: string[]
    sizes: string[]
    durations?: string[]
    countMax: number
    capabilities: { quality: boolean; count: boolean; duration: boolean; sound: boolean }
  },
  isVideo: boolean,
): void {
  if (data.kind !== 'model' && data.kind !== 'video') return
  data.model = model.model
  data.modelId = model.modelId
  data.badge = model.badge || undefined
  data.maxImageRefs = model.maxImageRefs
  data.capabilities = { ...model.capabilities }
  if (!model.ratios.includes(data.ratio ?? '')) data.ratio = model.ratios[0] ?? '1:1'
  if (!model.sizes.includes(data.size ?? '')) data.size = model.sizes[0] ?? (isVideo ? '720p' : '1K')
  if (isVideo && model.durations?.length && !model.durations.includes(data.duration ?? '')) {
    data.duration = model.durations[0] ?? '4s'
  }
  if (data.kind === 'video') {
    data.sound = model.capabilities.sound ? (data.sound ?? true) : undefined
  }
  if (!model.capabilities.count) data.count = 1
  data.subtitle = `${modelLabelOf(model.model)} · ${isVideo ? (data.duration ?? '4s') : (data.size ?? '1K')}`
}
