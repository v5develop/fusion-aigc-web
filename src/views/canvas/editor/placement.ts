/**
 * 画布编辑器 —— 节点落点（纯函数，不依赖 Vue / store，便于单独验证）。
 *
 * <p>规则：新建节点默认不与任何已有节点重叠，节点之间至少留 NODE_GAP（画布坐标）。
 * 节点矩形 = position + 尺寸，尺寸优先取 Vue Flow 实测的 dimensions，读不到按 data.width / height，
 * 再不行按类型默认尺寸估计。分组底板（module）是几何分组，不算障碍。
 *
 * <p>搜索策略（确定性，迭代次数有上限，找不到时落到所有节点的下方）：
 * <ul>
 *   <li>down-first：从期望点起沿纵向往下找（跳过挡路节点的下沿 + GAP），一列放不下（超过 columnSpan）换右边一列；
 *       用于「下游结果在来源节点右侧一列排开」；</li>
 *   <li>right-first：从期望点起沿横向往右找（跳过挡路节点的右沿 + GAP），一行放不下换下一行；用于粘贴 / 批量拖入；</li>
 *   <li>spiral：以期望点为中心按 GAP 步长一圈圈往外找，取最近的空位；用于用户指定落点（双击 / 拖放 / 端口「+」）。</li>
 * </ul>
 */
import type { CanvasEditorNode } from './types'

/** 节点之间的统一间距（画布坐标） */
export const NODE_GAP = 40

export interface IRect {
  x: number
  y: number
  w: number
  h: number
}

export type PlacementFlow = 'down-first' | 'right-first' | 'spiral'

export interface IPlacementOptions {
  gap?: number
  flow?: PlacementFlow
  /** 横向搜索方向：1 往右（默认），-1 往左（在目标左侧放输入节点时用） */
  hDir?: 1 | -1
  /** down-first 单列最多往下找多远（画布坐标），超出换下一列 */
  columnSpan?: number
  /** right-first 单行最多往右找多远，超出换下一行 */
  rowSpan?: number
  /** 搜索圈数 / 列数 / 行数上限 */
  maxRings?: number
}

const MAX_JUMPS = 400
const DEFAULT_COLUMN_SPAN = 1500
const DEFAULT_ROW_SPAN = 2400
const DEFAULT_MAX_RINGS = 24

/** 各类型节点在没有实测尺寸时的估计尺寸（与节点组件里 width 的默认值一致，高度取常见渲染高度） */
export function defaultSizeOf(node: Pick<CanvasEditorNode, 'type' | 'data'>): { w: number; h: number } {
  const data = node.data
  const tool = (data as { tool?: string }).tool
  let w = 280
  let h = 260
  switch (node.type) {
    case 'text':
      w = 320
      h = 220
      break
    case 'image':
      w = 240
      h = 260
      break
    case 'video':
      w = 338
      h = 380
      break
    case 'model':
      w = data.kind === 'video' ? 338 : 318
      h = data.kind === 'video' ? 480 : 440
      break
    case 'tool':
      w = tool === 'tryon' ? 380 : 340
      h = tool === 'tryon' ? 460 : 320
      break
    case 'module':
      w = 760
      h = 420
      break
    default:
      break
  }
  return { w: data.width ?? w, h: data.height ?? h }
}

type Measurable = Pick<CanvasEditorNode, 'type' | 'data'> & { dimensions?: { width?: number; height?: number } }

/** 实测尺寸（Vue Flow 运行时挂在 node.dimensions 上），没有或为 0 返回 null */
export function measuredSizeOf(node: object): { w: number; h: number } | null {
  const dims = (node as Measurable).dimensions
  if (dims?.width && dims?.height && dims.width > 0 && dims.height > 0) return { w: dims.width, h: dims.height }
  return null
}

/** 节点尺寸：实测优先，其次 data / 类型默认 */
export function sizeOfNode(node: CanvasEditorNode): { w: number; h: number } {
  return measuredSizeOf(node) ?? defaultSizeOf(node)
}

export function rectOfNode(node: CanvasEditorNode): IRect {
  const size = sizeOfNode(node)
  return { x: node.position.x, y: node.position.y, w: size.w, h: size.h }
}

/** 障碍物：除分组底板外的所有节点 */
export function obstacleRects(nodes: CanvasEditorNode[], excludeIds?: Set<string>): IRect[] {
  return nodes.filter((n) => n.type !== 'module' && !excludeIds?.has(n.id)).map(rectOfNode)
}

/** 两矩形（把 b 向四周外扩 gap 之后）是否相交；恰好相距 gap 不算相交 */
export function intersects(a: IRect, b: IRect, gap = NODE_GAP): boolean {
  return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y
}

function shifted(r: IRect, dx: number, dy: number): IRect {
  return { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }
}

/** 一组矩形平移 (dx, dy) 后，返回第一个撞上的 [成员, 障碍]，没有撞返回 null */
function firstConflict(block: IRect[], dx: number, dy: number, others: IRect[], gap: number): [IRect, IRect] | null {
  for (const member of block) {
    const moved = shifted(member, dx, dy)
    for (const other of others) if (intersects(moved, other, gap)) return [member, other]
  }
  return null
}

export function boundsOf(rects: IRect[]): IRect {
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))
  const right = Math.max(...rects.map((r) => r.x + r.w))
  const bottom = Math.max(...rects.map((r) => r.y + r.h))
  return { x, y, w: right - x, h: bottom - y }
}

function fallbackBelow(block: IRect[], desired: { dx: number; dy: number }, others: IRect[], gap: number) {
  if (!others.length) return desired
  const bottom = Math.max(...others.map((r) => r.y + r.h))
  const top = Math.min(...block.map((r) => r.y))
  return { dx: desired.dx, dy: Math.round(bottom + gap - top) }
}

/**
 * 一组节点（保持相对布局）整体平移：从期望位移 desired 起找第一个与 others 都不重叠（间距 ≥ gap）的位移。
 * block 为空或 others 为空时原样返回 desired。
 */
export function findFreeBlockShift(
  block: IRect[],
  desired: { dx: number; dy: number },
  others: IRect[],
  opts: IPlacementOptions = {},
): { dx: number; dy: number } {
  const gap = opts.gap ?? NODE_GAP
  const flow = opts.flow ?? 'spiral'
  const hDir = opts.hDir ?? 1
  if (!block.length || !others.length) return desired
  if (!firstConflict(block, desired.dx, desired.dy, others, gap)) return desired
  const bounds = boundsOf(block)
  const maxRings = opts.maxRings ?? DEFAULT_MAX_RINGS

  if (flow === 'down-first') {
    const span = opts.columnSpan ?? DEFAULT_COLUMN_SPAN
    for (let col = 0; col < maxRings; col += 1) {
      const dx = desired.dx + hDir * col * (bounds.w + gap)
      let dy = desired.dy
      for (let jump = 0; jump < MAX_JUMPS && dy - desired.dy <= span; jump += 1) {
        const hit = firstConflict(block, dx, dy, others, gap)
        if (!hit) return { dx: Math.round(dx), dy: Math.round(dy) }
        const [member, other] = hit
        const next = other.y + other.h + gap - member.y
        dy = next > dy ? next : dy + 1
      }
    }
    return fallbackBelow(block, desired, others, gap)
  }

  if (flow === 'right-first') {
    const span = opts.rowSpan ?? DEFAULT_ROW_SPAN
    for (let row = 0; row < maxRings; row += 1) {
      const dy = desired.dy + row * (bounds.h + gap)
      let dx = desired.dx
      for (let jump = 0; jump < MAX_JUMPS && Math.abs(dx - desired.dx) <= span; jump += 1) {
        const hit = firstConflict(block, dx, dy, others, gap)
        if (!hit) return { dx: Math.round(dx), dy: Math.round(dy) }
        const [member, other] = hit
        const next =
          hDir === 1 ? other.x + other.w + gap - member.x : other.x - gap - (member.x + member.w)
        dx = hDir === 1 ? (next > dx ? next : dx + 1) : next < dx ? next : dx - 1
      }
    }
    return fallbackBelow(block, desired, others, gap)
  }

  // spiral：GAP 步长的方形圈，圈内按距离再按 (y, x) 排序，取最近的空位
  const step = gap
  for (let ring = 1; ring <= maxRings * 2; ring += 1) {
    const cells: Array<{ dx: number; dy: number; d: number }> = []
    for (let i = -ring; i <= ring; i += 1) {
      for (let j = -ring; j <= ring; j += 1) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue
        cells.push({ dx: desired.dx + i * step, dy: desired.dy + j * step, d: i * i + j * j })
      }
    }
    cells.sort((a, b) => a.d - b.d || a.dy - b.dy || a.dx - b.dx)
    for (const cell of cells) {
      if (!firstConflict(block, cell.dx, cell.dy, others, gap)) return { dx: Math.round(cell.dx), dy: Math.round(cell.dy) }
    }
  }
  return fallbackBelow(block, desired, others, gap)
}

/** 单个节点落点：返回左上角坐标（取整） */
export function findFreeSpot(
  preferred: { x: number; y: number },
  size: { w: number; h: number },
  others: IRect[],
  opts: IPlacementOptions = {},
): { x: number; y: number } {
  const px = Math.round(preferred.x)
  const py = Math.round(preferred.y)
  const rect: IRect = { x: 0, y: 0, w: size.w, h: size.h }
  const shift = findFreeBlockShift([rect], { dx: px, dy: py }, others, opts)
  return { x: Math.round(shift.dx), y: Math.round(shift.dy) }
}

/** 来源节点右侧的期望落点（下游结果 / 工具节点用，配合 flow: 'down-first'） */
export function rightOf(node: CanvasEditorNode, gap = NODE_GAP): { x: number; y: number } {
  const { w } = sizeOfNode(node)
  return { x: Math.round(node.position.x + w + gap), y: Math.round(node.position.y) }
}

/** 目标节点左侧的期望落点（输入节点用，配合 hDir: -1） */
export function leftOf(node: CanvasEditorNode, width: number, gap = NODE_GAP): { x: number; y: number } {
  return { x: Math.round(node.position.x - width - gap), y: Math.round(node.position.y) }
}

/**
 * 自动增高后的复核：节点用估计尺寸落点，实测尺寸出来后若与其他节点（间距 < gap）重叠，
 * 返回新的落点；不重叠返回 null（不用动）。只动这一个节点，不推开别人。
 */
export function resettleSpot(
  current: { x: number; y: number },
  measured: { w: number; h: number },
  others: IRect[],
  opts: IPlacementOptions = {},
): { x: number; y: number } | null {
  const gap = opts.gap ?? NODE_GAP
  const rect: IRect = { x: current.x, y: current.y, w: measured.w, h: measured.h }
  if (!others.some((o) => intersects(rect, o, gap))) return null
  const spot = findFreeSpot(current, measured, others, { flow: 'down-first', ...opts, gap })
  return spot.x === current.x && spot.y === current.y ? null : spot
}
