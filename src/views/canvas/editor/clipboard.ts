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
export function viewportKeepingCenter(viewport: IViewport, width: number, height: number, zoom: number): IViewport {
  const current = viewport.zoom || 1
  const cx = (width / 2 - viewport.x) / current
  const cy = (height / 2 - viewport.y) / current
  return { x: width / 2 - cx * zoom, y: height / 2 - cy * zoom, zoom }
}
