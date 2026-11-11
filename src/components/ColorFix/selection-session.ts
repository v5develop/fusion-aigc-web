/**
 * 智能选区的「会话」（2026-11-11 继续编辑）：完成选区时把当时的编辑状态（点 / 框 / 形状含模式 / 魔棒 / 笔画 / 扩展收缩平滑）
 * 随蒙版一起存下，下次对同一个图层打开智能选区时原样还原，而不是从一张黑白蒙版重新开始。
 *
 * <p>本文件只有类型、合法化与打包 / 解包（Blob 在 Node 里也有，可单测）；蒙版位图的编解码（PNG）在 PointSelect 里做。
 *
 * <p>打包格式（一个 Blob，便于 mask-store 按大小淘汰）：`XQSEL1\n` + 10 位十进制 JSON 字节长度 + JSON + 依次拼接的位图。
 * JSON 里 parts 记各位图的 [偏移, 长度]（相对位图区起点）。位图：
 * <ul>
 *   <li>sam：点选模型的结果蒙版（模型网格），恢复时不必重新加载模型；</li>
 *   <li>brush：笔画太多时压成的夹取图（R = lo、G = hi，见 selection-ops strokeClampMaps），此时 doc.strokes 为空；</li>
 *   <li>prior：会话开始时垫在最下面的旧选区（「重新选区」在原选区上细化的那张）。</li>
 * </ul>
 * maskSize = 同时存下的蒙版字节数：读的时候与库里的蒙版对不上（别处改过蒙版）就不认这份会话。
 */
import type { PointBox, PointPrompt } from './point-segment.ts'
import type { PenNode, Pt, SelectionShape, ShapeMode } from './selection-geometry.ts'
import { POST_OPS_NONE, type BrushStroke, type SelectionPostOps } from './selection-ops.ts'

/** 魔棒一次：点击处（原图坐标）+ 当时的容差 / 连续 / 模式 */
export interface WandOp {
  id: number
  x: number
  y: number
  tol: number
  contiguous: boolean
  mode: ShapeMode
}

export interface SelectionDoc {
  points: PointPrompt[]
  box: PointBox | null
  shapes: SelectionShape[]
  wands: WandOp[]
  strokes: BrushStroke[]
  post: SelectionPostOps
  /** 垫着已有选区（base-mask / 会话里的 prior）；「清空」后为 false */
  prior: boolean
}

export interface SessionBitmap {
  blob: Blob
  width: number
  height: number
}

export interface SelectionSession {
  v: 1
  /** 会话对应的原图尺寸（换了图 / 尺寸对不上不还原） */
  natural: { w: number; h: number }
  doc: SelectionDoc
  sam?: SessionBitmap
  brush?: SessionBitmap
  prior?: Blob
  maskSize: number
}

const MAGIC = 'XQSEL1\n'
/** 笔画轨迹点总数超过这个就压成夹取图（JSON 里一笔几百点很常见，几万点时 JSON 会到 MB 级） */
export const SESSION_STROKE_POINTS_MAX = 20_000

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const r2 = (v: number) => Math.round(v * 100) / 100

function ptOf(v: unknown): Pt | null {
  const o = v as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return null
  const x = num(o.x, NaN)
  const y = num(o.y, NaN)
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
}

function nodeOf(v: unknown): PenNode | null {
  const p = ptOf(v)
  if (!p) return null
  const o = v as Record<string, unknown>
  const n: PenNode = { x: p.x, y: p.y }
  for (const k of ['hx', 'hy', 'ix', 'iy'] as const) if (typeof o[k] === 'number' && Number.isFinite(o[k])) n[k] = o[k] as number
  return n
}

const MODE = (v: unknown): ShapeMode => (v === 'sub' ? 'sub' : 'add')

/** 任意来源的文档 → 合法文档（丢掉认不出的项）；不是对象返回 null */
export function selectionDocSanitize(raw: unknown): SelectionDoc | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const arr = (v: unknown) => (Array.isArray(v) ? v : [])
  const points = arr(o.points)
    .map((p) => {
      const q = ptOf(p)
      return q ? { x: q.x, y: q.y, label: (p as { label?: unknown }).label === 0 ? 0 : 1 } : null
    })
    .filter((p): p is PointPrompt => !!p)
  const b = o.box as Record<string, unknown> | null
  const box =
    b && typeof b === 'object' && [b.x0, b.y0, b.x1, b.y1].every((v) => typeof v === 'number' && Number.isFinite(v))
      ? { x0: b.x0 as number, y0: b.y0 as number, x1: b.x1 as number, y1: b.y1 as number }
      : null
  let id = 0
  const shapes = arr(o.shapes)
    .map((s): SelectionShape | null => {
      const so = s as Record<string, unknown>
      if (!so || typeof so !== 'object') return null
      const kind = so.kind === 'pen' || so.kind === 'lasso' || so.kind === 'rect' || so.kind === 'ellipse' ? so.kind : null
      const poly = arr(so.poly).map(ptOf).filter((p): p is Pt => !!p)
      if (!kind || poly.length < 3) return null
      const nodes = kind === 'pen' ? arr(so.nodes).map(nodeOf).filter((p): p is PenNode => !!p) : []
      return {
        id: Math.max(1, Math.round(num(so.id, ++id))),
        kind,
        mode: MODE(so.mode),
        poly,
        ...(nodes.length >= 3 ? { nodes } : {}),
      }
    })
    .filter((s): s is SelectionShape => !!s)
  const wands = arr(o.wands)
    .map((w): WandOp | null => {
      const wo = w as Record<string, unknown>
      const p = ptOf(w)
      if (!p) return null
      return {
        id: Math.max(1, Math.round(num(wo.id, ++id))),
        x: p.x,
        y: p.y,
        tol: Math.min(60, Math.max(1, Math.round(num(wo.tol, 16)))),
        contiguous: wo.contiguous !== false,
        mode: MODE(wo.mode),
      }
    })
    .filter((w): w is WandOp => !!w)
  const strokes = arr(o.strokes)
    .map((s): BrushStroke | null => {
      const so = s as Record<string, unknown>
      if (!so || typeof so !== 'object') return null
      const pts = arr(so.pts).map(ptOf).filter((p): p is Pt => !!p)
      if (!pts.length) return null
      return {
        id: Math.max(1, Math.round(num(so.id, ++id))),
        mode: MODE(so.mode),
        radius: Math.max(0.1, num(so.radius, 10)),
        hardness: Math.min(1, Math.max(0, num(so.hardness, 0.7))),
        pts,
      }
    })
    .filter((s): s is BrushStroke => !!s)
  const po = (o.post ?? {}) as Record<string, unknown>
  const post: SelectionPostOps = {
    grow: Math.min(20, Math.max(-20, Math.round(num(po.grow)))),
    smooth: Math.min(10, Math.max(0, Math.round(num(po.smooth)))),
  }
  return {
    points,
    box,
    shapes,
    wands,
    strokes,
    post: post.grow || post.smooth ? post : POST_OPS_NONE,
    prior: o.prior === true,
  }
}

/** 文档里笔画轨迹点总数 */
export function strokePointCount(doc: Pick<SelectionDoc, 'strokes'>): number {
  return doc.strokes.reduce((n, s) => n + s.pts.length, 0)
}

/** 存之前把坐标收到 0.01 像素（JSON 小一半，精度远超网格） */
function compactDoc(doc: SelectionDoc): SelectionDoc {
  const p = (q: Pt) => ({ x: r2(q.x), y: r2(q.y) })
  return {
    ...doc,
    points: doc.points.map((q) => ({ ...p(q), label: q.label })),
    shapes: doc.shapes.map((s) => ({
      ...s,
      poly: s.poly.map(p),
      ...(s.nodes
        ? {
            nodes: s.nodes.map((n) => {
              const out: PenNode = p(n)
              for (const k of ['hx', 'hy', 'ix', 'iy'] as const) if (n[k] !== undefined) out[k] = r2(n[k]!)
              return out
            }),
          }
        : {}),
    })),
    strokes: doc.strokes.map((s) => ({ ...s, radius: r2(s.radius), pts: s.pts.map(p) })),
  }
}

/** 会话 → 一个 Blob（格式见文件头） */
export function packSession(s: SelectionSession): Blob {
  const parts: Record<string, [number, number, number?, number?, string?]> = {}
  const blobs: Blob[] = []
  let off = 0
  const put = (name: string, b: Blob | undefined, w?: number, h?: number) => {
    if (!b) return
    parts[name] = [off, b.size, w, h, b.type]
    blobs.push(b)
    off += b.size
  }
  put('sam', s.sam?.blob, s.sam?.width, s.sam?.height)
  put('brush', s.brush?.blob, s.brush?.width, s.brush?.height)
  put('prior', s.prior)
  const json = JSON.stringify({ v: 1, natural: s.natural, doc: compactDoc(s.doc), maskSize: s.maskSize, parts })
  const bytes = new TextEncoder().encode(json)
  return new Blob([MAGIC, String(bytes.length).padStart(10, '0'), bytes, ...blobs], { type: 'application/octet-stream' })
}

/** Blob → 会话；格式不对 / 坏了返回 null */
export async function unpackSession(blob: Blob | null | undefined): Promise<SelectionSession | null> {
  try {
    if (!blob || blob.size < MAGIC.length + 10) return null
    const head = await blob.slice(0, MAGIC.length + 10).text()
    if (!head.startsWith(MAGIC)) return null
    const len = Number(head.slice(MAGIC.length))
    if (!Number.isInteger(len) || len <= 0) return null
    const start = MAGIC.length + 10
    const o = JSON.parse(await blob.slice(start, start + len).text()) as Record<string, unknown>
    if (o?.v !== 1) return null
    const doc = selectionDocSanitize(o.doc)
    const nat = o.natural as { w?: unknown; h?: unknown } | undefined
    const w = num(nat?.w)
    const h = num(nat?.h)
    if (!doc || !(w > 0) || !(h > 0)) return null
    const base = start + len
    const parts = (o.parts ?? {}) as Record<string, unknown>
    const part = (name: string): { blob: Blob; width: number; height: number } | undefined => {
      const p = parts[name]
      if (!Array.isArray(p)) return undefined
      const [poff, plen, pw, ph, type] = p as [unknown, unknown, unknown, unknown, unknown]
      if (typeof poff !== 'number' || typeof plen !== 'number' || plen <= 0) return undefined
      if (base + poff + plen > blob.size) return undefined
      return {
        blob: blob.slice(base + poff, base + poff + plen, typeof type === 'string' ? type : 'image/png'),
        width: num(pw),
        height: num(ph),
      }
    }
    const sam = part('sam')
    const brush = part('brush')
    const prior = part('prior')
    return {
      v: 1,
      natural: { w, h },
      doc,
      ...(sam && sam.width > 0 && sam.height > 0 ? { sam } : {}),
      ...(brush && brush.width > 0 && brush.height > 0 ? { brush } : {}),
      ...(prior ? { prior: prior.blob } : {}),
      maskSize: Math.max(0, Math.round(num(o.maskSize))),
    }
  } catch {
    return null
  }
}
