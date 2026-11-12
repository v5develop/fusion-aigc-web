/**
 * 画布编辑器 —— 剪贴板与视口的纯函数（不依赖 Vue / store，便于单独验证）。
 *
 * <p>剪贴板存的是复制 / 剪切那一刻的深拷贝（节点 + 两端都在集合内的连线），
 * 粘贴时换新 id、整体偏移，连线两端按新 id 重映射——剪切后原节点已删，也照样能粘贴。
 */
import type { CanvasEditorEdge, CanvasEditorNode } from './types'

export interface ICanvasClipboard {
  nodes: CanvasEditorNode[]
  edges: CanvasEditorEdge[]
}

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 按剪贴板生成一组新节点 / 新连线：节点换新 id 并偏移 offset；只保留两端都在剪贴板里的连线，端点重映射。
 * 不修改入参（同一份剪贴板可以反复粘贴）。
 */
export function remapClipboard(
  clip: ICanvasClipboard,
  offset: number,
  makeNodeId: (node: CanvasEditorNode) => string,
  makeEdgeId: () => string,
): ICanvasClipboard {
  const idMap = new Map<string, string>()
  const nodes = clip.nodes.map((node) => {
    const copy = deepCopy(node)
    const id = makeNodeId(node)
    idMap.set(node.id, id)
    return { ...copy, id, position: { x: node.position.x + offset, y: node.position.y + offset } }
  })
  const edges: CanvasEditorEdge[] = []
  for (const edge of clip.edges) {
    const source = idMap.get(edge.source)
    const target = idMap.get(edge.target)
    if (!source || !target) continue
    edges.push({ ...deepCopy(edge), id: makeEdgeId(), source, target })
  }
  return { nodes, edges }
}

export interface IViewport {
  x: number
  y: number
  zoom: number
}

/**
 * 换缩放档但保持舞台中心对着同一个画布点（缩放读数点回 100% 用）。
 * 屏幕坐标 = 画布坐标 × zoom + 平移：中心画布点 c = (w/2 − x) / zoom，新平移 = w/2 − c × newZoom。
 */
/** 缩放按钮步长：固定 10 个百分点 */
export const ZOOM_STEP_PERCENT = 10

/**
 * +/- 按钮的下一档缩放：按 10% 网格对齐——当前恰在整 10 档上就 ±10，否则先吸到相邻的整 10 档
 * （87% 点 + → 90%，点 − → 80%），读数始终是整 10，最后夹在 [min, max]。
 */
export function stepZoomLevel(current: number, direction: 1 | -1, min: number, max: number): number {
  const pct = Math.round((current || 1) * 1000) / 10 // 保留 0.1% 精度，消掉浮点噪声
  const onGrid = Math.abs(pct / ZOOM_STEP_PERCENT - Math.round(pct / ZOOM_STEP_PERCENT)) < 1e-6
  const base = onGrid ? Math.round(pct / ZOOM_STEP_PERCENT) : pct / ZOOM_STEP_PERCENT
  const next = (direction > 0 ? (onGrid ? base + 1 : Math.ceil(base)) : onGrid ? base - 1 : Math.floor(base)) * ZOOM_STEP_PERCENT
  return Math.min(max, Math.max(min, next / 100))
}

export function viewportKeepingCenter(viewport: IViewport, width: number, height: number, zoom: number): IViewport {
  const current = viewport.zoom || 1
  const cx = (width / 2 - viewport.x) / current
  const cy = (height / 2 - viewport.y) / current
  return { x: width / 2 - cx * zoom, y: height / 2 - cy * zoom, zoom }
}
