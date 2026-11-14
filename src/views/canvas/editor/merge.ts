/**
 * 画布三方合并（纯函数，无 Vue / 浏览器依赖；`node scripts/canvas-merge.check.ts` 可直接跑自检）。
 *
 * <p>base = 本地编辑起点那个 revision 的快照，ours = 本地当前内容，theirs = 服务端最新快照（画布助手 / 其他窗口改过）。
 * 按节点 id、连线 id 逐字段合并：
 * - 节点字段 = type / position / draggable / selectable / zIndex + data 第一层每个键（`data.prompt`、`data.title` …）；
 *   连线字段 = source / target / sourceHandle / targetHandle / data。
 * - 一方没改（与 base 相同）取另一方；双方改成同一个值不算冲突；双方改成不同值 = 冲突。
 * - 删除 vs 修改 = 冲突（一方删了节点 / 连线，另一方改过它的任一字段）；双方都删 = 删除。
 * - 运行态键（status / progress / candidates …，由 isRuntimeKey 判定）不参与冲突：节点在 theirs 里就取 theirs（服务端回填的才是真值）。
 * - 冲突默认「保留我的」；choices[conflict.key] = 'theirs' 改取对方。
 * 合并后丢掉端点已不存在的连线与完全重复的连线（同源同口同目标同口）。
 * 单槽输入口（见 singleSlotOf）合并后若出现多条入线：保留我的那条，对方带来的那条记为 `edge:<对方连线id>:@slot` 冲突
 * （默认不接入对方的；选「对方」= 对方的留下、我在这个口的线移除），由冲突弹窗让用户选。
 */
import type { CanvasEditorEdge, CanvasEditorNode } from './types.ts'

export type MergeSide = 'ours' | 'theirs'

export interface IMergeDoc {
  title: string
  nodes: CanvasEditorNode[]
  edges: CanvasEditorEdge[]
}

export type MergeConflictKind =
  /** 双方把同一字段改成了不同的值 */
  | 'modify'
  /** 我删了，对方改了 */
  | 'delete-ours'
  /** 对方删了，我改了 */
  | 'delete-theirs'
  /** 合并后单槽输入口（提示词 / 首帧 / 尾帧 …）出现多条入线：我的那条与对方新接的那条抢同一个口 */
  | 'slot-full'

export interface IMergeConflict {
  /** 选择表的键：`node:<id>:<field>` / `node:<id>:@exist` / `edge:<id>:<field>` / `edge:<id>:@exist` / `title` */
  key: string
  scope: 'node' | 'edge' | 'title'
  /** 节点 / 连线 id；标题为空串 */
  id: string
  /** 字段名（`position`、`data.prompt` …）；删除冲突为 `@exist` */
  field: string
  kind: MergeConflictKind
  /** 我的值；删除为 undefined */
  ours: unknown
  /** 对方的值；删除为 undefined */
  theirs: unknown
}

export interface IMergeResult {
  doc: IMergeDoc
  /** 尚未解决（未在 choices 里）的冲突；已按默认「保留我的」写进 doc */
  conflicts: IMergeConflict[]
  /** 本次合并里取了对方内容的节点（对方新增 / 改动被采纳）：用于高亮 */
  theirsNodeIds: string[]
  /** 自动采纳对方改动的字段数（不含冲突里选了对方的） */
  autoApplied: number
  /** 合并后因端点不存在 / 重复 / 单槽口被占而丢弃的连线 */
  droppedEdgeIds: string[]
}

export interface IMergeOptions {
  /** 冲突的选择：key → ours / theirs；缺省 = ours */
  choices?: Record<string, MergeSide>
  /** data 里的运行态键（不参与冲突，theirs 优先） */
  isRuntimeKey?: (node: CanvasEditorNode, key: string) => boolean
}

// ---------------- 工具 ----------------

/** 稳定序列化：对象键排序后比较，避免键序不同误判为改动 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return '\u0000undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item ?? null)).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
    .filter((key) => obj[key] !== undefined)
    .sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`).join(',')}}`
}

function same(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
}

type FieldMap = Map<string, unknown>

const NODE_TOP_FIELDS = ['type', 'position', 'draggable', 'selectable', 'zIndex'] as const
const EDGE_FIELDS = ['source', 'target', 'sourceHandle', 'targetHandle', 'data'] as const

function nodeFields(node: CanvasEditorNode | undefined, runtime: (key: string) => boolean): FieldMap {
  const out: FieldMap = new Map()
  if (!node) return out
  const top = node as unknown as Record<string, unknown>
  for (const key of NODE_TOP_FIELDS) {
    const value = key === 'position' ? { x: node.position?.x ?? 0, y: node.position?.y ?? 0 } : top[key]
    if (value !== undefined && value !== null) out.set(key, value)
  }
  const data = (node.data ?? {}) as unknown as Record<string, unknown>
  for (const key of Object.keys(data)) {
    if (runtime(key) || data[key] === undefined) continue
    out.set(`data.${key}`, data[key])
  }
  return out
}

function edgeFields(edge: CanvasEditorEdge | undefined): FieldMap {
  const out: FieldMap = new Map()
  if (!edge) return out
  const raw = edge as unknown as Record<string, unknown>
  for (const key of EDGE_FIELDS) {
    const value = raw[key]
    if (value !== undefined && value !== null && value !== '') out.set(key, value)
  }
  return out
}

function fieldsEqual(a: FieldMap, b: FieldMap): boolean {
  if (a.size !== b.size) return false
  for (const [key, value] of a) {
    if (!b.has(key) || !same(value, b.get(key))) return false
  }
  return true
}

interface IFieldMergeOut {
  fields: FieldMap
  conflicts: IMergeConflict[]
  /** 取了 theirs（且与 ours 不同）的字段数 */
  tookTheirs: number
}

/** 逐字段三方合并：返回合并后的字段表与冲突（冲突按 choices / 默认 ours 落值） */
function mergeFields(
  scope: 'node' | 'edge',
  id: string,
  base: FieldMap,
  ours: FieldMap,
  theirs: FieldMap,
  choices: Record<string, MergeSide>,
): IFieldMergeOut {
  const keys = new Set<string>([...base.keys(), ...ours.keys(), ...theirs.keys()])
  const fields: FieldMap = new Map()
  const conflicts: IMergeConflict[] = []
  let tookTheirs = 0
  for (const key of keys) {
    const b = base.get(key)
    const o = ours.get(key)
    const t = theirs.get(key)
    let value: unknown
    if (same(o, t)) value = o
    else if (same(o, b)) {
      value = t
      tookTheirs += 1
    } else if (same(t, b)) value = o
    else {
      const conflictKey = `${scope}:${id}:${key}`
      const choice = choices[conflictKey]
      if (!choice) conflicts.push({ key: conflictKey, scope, id, field: key, kind: 'modify', ours: o, theirs: t })
      value = choice === 'theirs' ? t : o
    }
    if (value !== undefined) fields.set(key, clone(value))
  }
  return { fields, conflicts, tookTheirs }
}

function buildNode(
  id: string,
  fields: FieldMap,
  runtimeFrom: CanvasEditorNode | undefined,
  runtime: (key: string) => boolean,
): CanvasEditorNode {
  const data: Record<string, unknown> = {}
  for (const [key, value] of fields) {
    if (key.startsWith('data.')) data[key.slice(5)] = value
  }
  // 运行态：取来源节点（theirs 优先）的值原样带上
  const sourceData = (runtimeFrom?.data ?? {}) as unknown as Record<string, unknown>
  for (const key of Object.keys(sourceData)) {
    if (runtime(key) && sourceData[key] !== undefined) data[key] = clone(sourceData[key])
  }
  const position = (fields.get('position') as { x: number; y: number } | undefined) ?? { x: 0, y: 0 }
  const node: Record<string, unknown> = {
    id,
    type: fields.get('type') ?? runtimeFrom?.type ?? 'text',
    position: { x: Number(position.x) || 0, y: Number(position.y) || 0 },
    data,
  }
  for (const key of ['draggable', 'selectable', 'zIndex'] as const) {
    if (fields.has(key)) node[key] = fields.get(key)
  }
  return node as unknown as CanvasEditorNode
}

/**
 * 单槽输入口：同一节点的这个口最多接 1 条线，返回口的标识；多容量口（参考图、模特口）/ 无输入口返回 null。
 * 与 graph.ts validateConnection 的容量口径一致（那边依赖 @/ 别名与 Vue，这里是 node 可直接跑的纯函数副本）：
 * 提示词口、参考视频口、服装口、结果图的 image-in 口、视频模型的首帧 image1 / 尾帧 image2，
 * 以及非模型 / 视频节点（工具、素材）的 image 口（容量 1）。
 */
export function singleSlotOf(target: CanvasEditorNode | undefined, handle?: string | null): string | null {
  if (!target || target.type === 'module' || target.type === 'text') return null
  const h = handle ?? ''
  if (h === 'prompt' || h === 'video' || h === 'garment' || h === 'image-in' || h === 'image1' || h === 'image2') return h
  if (h === 'image') {
    const kind = (target.data as unknown as { kind?: string } | undefined)?.kind
    return kind === 'model' || kind === 'video' ? null : 'image'
  }
  return null
}

function nodeLabelOf(node: CanvasEditorNode | undefined, id: string): string {
  const title = node?.data?.title
  return typeof title === 'string' && title ? title : id
}

function buildEdge(id: string, fields: FieldMap): CanvasEditorEdge {
  const edge: Record<string, unknown> = { id, type: 'canvas-bezier' }
  for (const key of EDGE_FIELDS) {
    if (fields.has(key)) edge[key] = fields.get(key)
  }
  return edge as unknown as CanvasEditorEdge
}

// ---------------- 主函数 ----------------

/**
 * 三方合并。base 缺失时传 null：退化为「双方不同即冲突、单方存在即保留」。
 */
export function mergeCanvas(
  base: IMergeDoc | null,
  ours: IMergeDoc,
  theirs: IMergeDoc,
  options: IMergeOptions = {},
): IMergeResult {
  const choices = options.choices ?? {}
  const isRuntime = options.isRuntimeKey ?? (() => false)
  const conflicts: IMergeConflict[] = []
  const theirsNodeIds = new Set<string>()
  let autoApplied = 0

  // ---- 标题 ----
  let title = ours.title
  {
    const b = base?.title
    if (same(ours.title, theirs.title) || same(theirs.title, b)) title = ours.title
    else if (same(ours.title, b)) {
      title = theirs.title
      autoApplied += 1
    } else {
      const choice = choices.title
      if (!choice)
        conflicts.push({
          key: 'title',
          scope: 'title',
          id: '',
          field: 'title',
          kind: 'modify',
          ours: ours.title,
          theirs: theirs.title,
        })
      title = choice === 'theirs' ? theirs.title : ours.title
    }
  }

  // ---- 节点 ----
  const baseNodes = new Map((base?.nodes ?? []).map((node) => [node.id, node]))
  const ourNodes = new Map(ours.nodes.map((node) => [node.id, node]))
  const theirNodes = new Map(theirs.nodes.map((node) => [node.id, node]))
  const merged = new Map<string, CanvasEditorNode>()

  const runtimeOf = (node: CanvasEditorNode | undefined) => (key: string) => !!node && isRuntime(node, key)

  const orderIds = [
    ...ours.nodes.map((node) => node.id),
    ...theirs.nodes.map((node) => node.id).filter((id) => !ourNodes.has(id)),
  ]
  for (const id of orderIds) {
    const b = baseNodes.get(id)
    const o = ourNodes.get(id)
    const t = theirNodes.get(id)
    // 运行态判定按节点本身（模型 / 工具节点的 image 是成品），任一侧存在即可判定
    const probe = t ?? o ?? b
    const runtime = runtimeOf(probe)
    const bf = nodeFields(b, runtime)
    const of = nodeFields(o, runtime)
    const tf = nodeFields(t, runtime)
    if (o && t) {
      const out = mergeFields('node', id, b ? bf : new Map(), of, tf, choices)
      conflicts.push(...out.conflicts)
      autoApplied += out.tookTheirs
      if (out.tookTheirs > 0) theirsNodeIds.add(id)
      if (Object.keys(choices).some((key) => key.startsWith(`node:${id}:`) && choices[key] === 'theirs')) {
        theirsNodeIds.add(id)
      }
      merged.set(id, buildNode(id, out.fields, t, runtime))
      continue
    }
    if (o && !t) {
      if (!b) {
        merged.set(id, buildNode(id, of, o, runtime)) // 我新增
        continue
      }
      // 对方删了
      if (fieldsEqual(of, bf)) continue // 我没改：跟着删
      const key = `node:${id}:@exist`
      const choice = choices[key]
      if (!choice)
        conflicts.push({
          key,
          scope: 'node',
          id,
          field: '@exist',
          kind: 'delete-theirs',
          ours: clone(o),
          theirs: undefined,
        })
      if (choice !== 'theirs') merged.set(id, buildNode(id, of, o, runtime))
      continue
    }
    if (!o && t) {
      if (!b) {
        merged.set(id, buildNode(id, tf, t, runtime)) // 对方新增
        theirsNodeIds.add(id)
        autoApplied += 1
        continue
      }
      // 我删了
      if (fieldsEqual(tf, bf)) continue // 对方没改：保持删除
      const key = `node:${id}:@exist`
      const choice = choices[key]
      if (!choice)
        conflicts.push({
          key,
          scope: 'node',
          id,
          field: '@exist',
          kind: 'delete-ours',
          ours: undefined,
          theirs: clone(t),
        })
      if (choice === 'theirs') {
        merged.set(id, buildNode(id, tf, t, runtime))
        theirsNodeIds.add(id)
      }
    }
  }
  // base 里有、双方都删了：什么也不做

  // ---- 连线 ----
  const baseEdges = new Map((base?.edges ?? []).map((edge) => [edge.id, edge]))
  const ourEdges = new Map(ours.edges.map((edge) => [edge.id, edge]))
  const theirEdges = new Map(theirs.edges.map((edge) => [edge.id, edge]))
  const mergedEdges: CanvasEditorEdge[] = []
  const edgeOrder = [
    ...ours.edges.map((edge) => edge.id),
    ...theirs.edges.map((edge) => edge.id).filter((id) => !ourEdges.has(id)),
  ]
  for (const id of edgeOrder) {
    const b = baseEdges.get(id)
    const o = ourEdges.get(id)
    const t = theirEdges.get(id)
    const bf = edgeFields(b)
    const of = edgeFields(o)
    const tf = edgeFields(t)
    if (o && t) {
      const out = mergeFields('edge', id, b ? bf : new Map(), of, tf, choices)
      conflicts.push(...out.conflicts)
      autoApplied += out.tookTheirs
      mergedEdges.push(buildEdge(id, out.fields))
      continue
    }
    if (o && !t) {
      if (!b) {
        mergedEdges.push(buildEdge(id, of))
        continue
      }
      if (fieldsEqual(of, bf)) continue
      const key = `edge:${id}:@exist`
      const choice = choices[key]
      if (!choice)
        conflicts.push({
          key,
          scope: 'edge',
          id,
          field: '@exist',
          kind: 'delete-theirs',
          ours: clone(o),
          theirs: undefined,
        })
      if (choice !== 'theirs') mergedEdges.push(buildEdge(id, of))
      continue
    }
    if (!o && t) {
      if (!b) {
        mergedEdges.push(buildEdge(id, tf))
        autoApplied += 1
        continue
      }
      if (fieldsEqual(tf, bf)) continue
      const key = `edge:${id}:@exist`
      const choice = choices[key]
      if (!choice)
        conflicts.push({
          key,
          scope: 'edge',
          id,
          field: '@exist',
          kind: 'delete-ours',
          ours: undefined,
          theirs: clone(t),
        })
      if (choice === 'theirs') mergedEdges.push(buildEdge(id, tf))
    }
  }

  // ---- 收尾：端点不存在 / 重复的连线丢掉；端点已被丢的连线上的冲突也一并撤回 ----
  const droppedEdgeIds: string[] = []
  const seen = new Set<string>()
  const finalEdges = mergedEdges.filter((edge) => {
    if (!merged.has(edge.source) || !merged.has(edge.target)) {
      droppedEdgeIds.push(edge.id)
      return false
    }
    const sig = `${edge.source}|${edge.sourceHandle ?? ''}|${edge.target}|${edge.targetHandle ?? ''}`
    if (seen.has(sig)) {
      droppedEdgeIds.push(edge.id)
      return false
    }
    seen.add(sig)
    return true
  })

  // ---- 单槽口检查：合并后某个单槽口多于 1 条入线 → 保留我的，对方带来的那条作为冲突交给用户 ----
  const slotConflicts: IMergeConflict[] = []
  const slotGroups = new Map<string, { mine: CanvasEditorEdge[]; theirs: CanvasEditorEdge[] }>()
  for (const edge of finalEdges) {
    const slot = singleSlotOf(merged.get(edge.target), edge.targetHandle)
    if (!slot) continue
    const key = `${edge.target}|${slot}`
    const group = slotGroups.get(key) ?? { mine: [], theirs: [] }
    const mine = ourEdges.get(edge.id)
    const isMine =
      !!mine &&
      mine.target === edge.target &&
      singleSlotOf(merged.get(mine.target), mine.targetHandle) === slot
    ;(isMine ? group.mine : group.theirs).push(edge)
    slotGroups.set(key, group)
  }
  const slotDropped = new Set<string>()
  for (const group of slotGroups.values()) {
    // 只处理「合并才造成的」超额：我这边至少有一条、对方带来了新的
    if (!group.mine.length || !group.theirs.length) continue
    const kept: CanvasEditorEdge[] = []
    for (const edge of group.theirs) {
      const key = `edge:${edge.id}:@slot`
      const choice = choices[key]
      if (!choice) {
        const sourceOf = (e: CanvasEditorEdge) => `来自「${nodeLabelOf(merged.get(e.source), e.source)}」的连线`
        const targetNode = merged.get(edge.target)
        slotConflicts.push({
          key,
          scope: 'edge',
          id: edge.id,
          field: '@slot',
          kind: 'slot-full',
          ours: `${sourceOf(group.mine[0]!)}（「${nodeLabelOf(targetNode, edge.target)}」的该输入口只能接 1 条）`,
          theirs: sourceOf(edge),
        })
      }
      if (choice === 'theirs') kept.push(edge)
      else slotDropped.add(edge.id)
    }
    if (kept.length) for (const edge of group.mine) slotDropped.add(edge.id)
  }
  if (slotDropped.size) {
    for (const id of slotDropped) droppedEdgeIds.push(id)
    for (let i = finalEdges.length - 1; i >= 0; i -= 1) if (slotDropped.has(finalEdges[i]!.id)) finalEdges.splice(i, 1)
  }
  const droppedSet = new Set(droppedEdgeIds)
  const liveConflicts = conflicts.filter((conflict) => {
    if (conflict.scope !== 'edge') return true
    if (droppedSet.has(conflict.id)) return false
    // 删除冲突里被删一侧的连线，端点若已不在合并结果里，选哪边都留不住：不用问
    const edge = (conflict.ours ?? conflict.theirs) as CanvasEditorEdge | undefined
    if (conflict.field === '@exist' && edge && (!merged.has(edge.source) || !merged.has(edge.target))) return false
    return true
  })

  return {
    doc: { title, nodes: [...merged.values()], edges: finalEdges },
    conflicts: [...liveConflicts, ...slotConflicts],
    theirsNodeIds: [...theirsNodeIds].filter((id) => merged.has(id)),
    autoApplied,
    droppedEdgeIds,
  }
}

// ---------------- 展示辅助（冲突弹窗用；纯函数） ----------------

const FIELD_LABELS: Record<string, string> = {
  title: '画布标题',
  '@exist': '节点',
  type: '节点类型',
  position: '位置',
  draggable: '锁定',
  selectable: '可选中',
  zIndex: '层级',
  source: '连线起点',
  target: '连线终点',
  sourceHandle: '连线起点端口',
  targetHandle: '连线终点端口',
  data: '连线属性',
  '@slot': '该输入口的连线',
  'data.title': '名称',
  'data.subtitle': '副标题',
  'data.text': '文本',
  'data.prompt': '提示词',
  'data.image': '图片',
  'data.video': '视频',
  'data.model': '模型',
  'data.modelId': '模型',
  'data.ratio': '比例',
  'data.size': '分辨率',
  'data.quality': '质量',
  'data.duration': '时长',
  'data.sound': '声音',
  'data.count': '张数',
  'data.width': '宽度',
  'data.height': '高度',
  'data.locked': '锁定',
  'data.tool': '工具',
  'data.crop': '裁剪区域',
  'data.scale': '放大倍数',
  'data.color': '颜色',
}

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? (field.startsWith('data.') ? `参数 ${field.slice(5)}` : field)
}

/** 冲突值的简短展示（弹窗里左右对照） */
export function previewValue(value: unknown, field: string, max = 60): string {
  if (value === undefined) return field === '@exist' ? '已删除' : '（空）'
  if (field === '@exist') return '保留并修改过'
  if (field === '@slot') return typeof value === 'string' ? value : '（连线）'
  if (field === 'position' && value && typeof value === 'object') {
    const pos = value as { x?: number; y?: number }
    return `(${Math.round(pos.x ?? 0)}, ${Math.round(pos.y ?? 0)})`
  }
  if (typeof value === 'boolean') return value ? '是' : '否'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (!text) return '（空）'
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 节点在双方任一侧的名称（弹窗标题用） */
export function nodeTitleIn(id: string, ...docs: (IMergeDoc | null | undefined)[]): string {
  for (const doc of docs) {
    const node = doc?.nodes.find((item) => item.id === id)
    const title = node?.data?.title
    if (typeof title === 'string' && title) return title
  }
  return id
}

/** 两份快照之间变动过的节点 id（新增 / 删除 / 任一非运行态字段不同） */
export function changedNodeIdsBetween(
  before: IMergeDoc | null,
  after: IMergeDoc,
  isRuntimeKey?: (node: CanvasEditorNode, key: string) => boolean,
): string[] {
  const runtime = (node: CanvasEditorNode) => (key: string) => !!isRuntimeKey && isRuntimeKey(node, key)
  const prev = new Map((before?.nodes ?? []).map((node) => [node.id, node]))
  const out: string[] = []
  for (const node of after.nodes) {
    const old = prev.get(node.id)
    if (!old || !fieldsEqual(nodeFields(old, runtime(node)), nodeFields(node, runtime(node)))) out.push(node.id)
  }
  return out
}

// ---------------- 撤销栈随远端变更改基（纯函数） ----------------

/**
 * 远端变更（画布助手 / 其他窗口）落到本地后，把撤销栈里的旧快照改基到新内容上：
 * 远端改动视为「不可撤销的基线」——每个旧快照都叠上 pre → post 之间的远端变化，
 * 撤销只回退本地操作，不会把对方的改动当成「上一步」撤掉，也不用清空整个栈。
 *
 * pre = 远端落地前的本地内容，post = 落地后的内容（合并结果或对方全量），entry = 栈里的某个旧快照。
 * 逐快照做三方合并（base=pre, ours=entry, theirs=post），冲突一律取 theirs：
 * 同一字段本地曾改过、远端也改了 → 远端为准；远端删除的节点 / 连线在旧快照里也一并删除。
 * 标题不进撤销历史，原样沿用 entry 的。
 */
export function rebaseOntoRemote(
  pre: IMergeDoc,
  post: IMergeDoc,
  entry: IMergeDoc,
  isRuntimeKey?: (node: CanvasEditorNode, key: string) => boolean,
): IMergeDoc {
  const options: IMergeOptions = { isRuntimeKey }
  const first = mergeCanvas(pre, entry, post, options)
  let result = first
  if (first.conflicts.length) {
    const choices: Record<string, MergeSide> = {}
    for (const conflict of first.conflicts) choices[conflict.key] = 'theirs'
    result = mergeCanvas(pre, entry, post, { ...options, choices })
  }
  return { title: entry.title, nodes: result.doc.nodes, edges: result.doc.edges }
}
