/**
 * 画布编辑器 ——「从模板插入」（原型 CanvasView insertCanvasTemplate）。
 *
 * <p>把模板快照（GET /api/v1/canvas/templates/{id}）当作一份剪贴板粘进当前画布：
 * - 已有内容时整块放到现有节点下方（maxY + 120，左缘对齐现有节点）；空画布放到给定的落点；
 * - 模板里没有模块底板时补一块「模块 · 标题」底板把它框起来（只作视觉框，不是成组）；
 * - 节点 / 连线 id 由 store.pasteClipboard 重新生成并重映射连线两端，节点和连线插入后都能继续改；
 * - 只带结构：模型 / 工具节点的成品与运行态在这里再剥一遍（服务端已剥，防旧数据），参考素材节点（inputOnly）保留。
 *
 * <p>buildTemplateClipboard 是纯函数（不读写 store 状态，只借用快照迁移函数），便于单独验证。
 */
import type { ICanvasClipboard } from './clipboard.ts'
import { migrateEdges, migrateNodes } from './useCanvasEditor.ts'
import type { CanvasEditorNode } from './types.ts'

/** 插入块与现有内容的竖向间距（原型 maxY + 120） */
export const TEMPLATE_INSERT_GAP = 120

/** 运行态字段：所有节点都去掉 */
const RUNTIME_KEYS = [
  'status',
  'progress',
  'runId',
  'requestId',
  'errorMessage',
  'errorCode',
  'retryable',
  'requestedCount',
  'selectedCandidate',
  'hiddenCandidates',
] as const
/** 成品字段：模型 / 工具节点去掉（参考素材节点 inputOnly 除外） */
const RESULT_KEYS = ['candidates', 'image', 'video', 'assetId', 'mediaId', 'resultText', 'resultImage'] as const

/** 节点高度兜底（原型同口径：读不到运行时尺寸时按类型估） */
function heightOf(node: CanvasEditorNode): number {
  const dims = (node as unknown as { dimensions?: { height?: number } }).dimensions
  if (dims?.height) return dims.height
  if (node.data.height) return node.data.height
  return node.type === 'text' ? 240 : node.type === 'image' ? 320 : 380
}
function widthOf(node: CanvasEditorNode): number {
  const dims = (node as unknown as { dimensions?: { width?: number } }).dimensions
  return dims?.width ?? node.data.width ?? 280
}

function stripToStructure(node: CanvasEditorNode): CanvasEditorNode {
  const data = { ...node.data } as Record<string, unknown>
  for (const k of RUNTIME_KEYS) delete data[k]
  if ((node.type === 'model' || node.type === 'tool') && !data.inputOnly) {
    for (const k of RESULT_KEYS) delete data[k]
  }
  return { ...node, data: data as unknown as CanvasEditorNode['data'] }
}

/**
 * 模板快照 → 已摆好位置的剪贴板（id 仍是模板里的，交给 store.pasteClipboard(clip, 0) 换新 id）。
 *
 * @param snapshot 模板快照 {nodes, edges}
 * @param existing 当前画布的节点
 * @param title    模板标题（补底板时用）
 * @param emptyAt  空画布时模板左上角落点（一般取视口里的一个画布坐标）
 * @returns 没有任何可用节点时返回 null
 */
export function buildTemplateClipboard(
  snapshot: { nodes?: unknown; edges?: unknown } | null | undefined,
  existing: CanvasEditorNode[],
  title: string,
  emptyAt: { x: number; y: number } = { x: 140, y: 140 },
): ICanvasClipboard | null {
  const nodes = migrateNodes(snapshot?.nodes).map(stripToStructure)
  if (!nodes.length) return null
  const edges = migrateEdges(snapshot?.edges, new Set(nodes.map((n) => n.id)))

  // 模板没带模块底板：补一块框住全部节点（底板 = 视觉框，不带 isGroup）
  if (!nodes.some((n) => n.type === 'module')) {
    const pad = 40
    const minX = Math.min(...nodes.map((n) => n.position.x)) - pad
    const minY = Math.min(...nodes.map((n) => n.position.y)) - pad - 24
    const maxX = Math.max(...nodes.map((n) => n.position.x + widthOf(n))) + pad
    const maxY = Math.max(...nodes.map((n) => n.position.y + heightOf(n))) + pad
    nodes.unshift({
      id: '__template_plate__',
      type: 'module',
      position: { x: Math.round(minX), y: Math.round(minY) },
      data: {
        title: `模块 · ${title || '模板'}`,
        subtitle: '模板模块',
        kind: 'module',
        width: Math.round(maxX - minX),
        height: Math.round(maxY - minY),
      },
      zIndex: -1,
    })
  }

  // 落点：已有内容 → 现有节点（不含底板）下方、左缘对齐；空画布 → emptyAt
  const tplMinX = Math.min(...nodes.map((n) => n.position.x))
  const tplMinY = Math.min(...nodes.map((n) => n.position.y))
  const others = existing.filter((n) => n.type !== 'module')
  const base = others.length
    ? {
        x: Math.min(...others.map((n) => n.position.x)),
        y: Math.max(...others.map((n) => n.position.y + heightOf(n))) + TEMPLATE_INSERT_GAP,
      }
    : emptyAt
  const dx = Math.round(base.x - tplMinX)
  const dy = Math.round(base.y - tplMinY)
  for (const n of nodes) n.position = { x: n.position.x + dx, y: n.position.y + dy }
  return { nodes, edges }
}
