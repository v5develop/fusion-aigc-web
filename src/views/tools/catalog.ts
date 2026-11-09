/**
 * 工具页左侧目录（对齐 5181 原型的「AI 图片」分组栏）。
 *
 * <p>分组与短说明抄自原型；名称、图标、路由一律取首页工具箱注册表（views/home/tools.ts），
 * 注册表里没有的条目（或没有 route 的）显示为「即将开放」，不自造路由；
 * 例外是单图复刻 / SKU替换：注册表没收，但工作流页（/workflow，wf:13 / wf:14）已可用，按工作流页同一 query 直达；
 * 局部重绘同理：注册表没收，但工具页 schema 已有，直达 /tools/ai-inpaint。
 * 「本地生活」组（原型 image-local-life）：走外部路由 /local-life/*，条目取自 views/image/landing.ts（见下）。
 *
 * <p>2026-11-09：主导航隐藏了「工作流」「AI 电商」「AI 商拍」「本地生活」，它们的子功能并进 AI 图片 / AI 视频。
 * 「图片处理」「视频处理」两组仍由这里自己列（含局部重绘、数字人口播等落地页没有的条目）；
 * 其余分组（商拍 / 电商 / 服装 / 本地生活）直接取落地页 views/image/landing.ts 的同名分组，两处同源、只维护一份；
 * 已在处理组里出现过的路由不再重复列。
 */
import { tools, type ToolItem } from '@/views/home/tools'
import { pictureLanding, videoLanding, type LandingPageData } from '@/views/image/landing'

export interface CatalogEntry {
  /** 注册表 id（同首页卡片 id / 工具页 toolId） */
  id: string
  name: string
  tagline: string
  /** undefined = 即将开放 */
  route?: string
  icon?: string
}

export interface CatalogGroup {
  label: string
  entries: CatalogEntry[]
}

export interface Catalog {
  title: string
  groups: CatalogGroup[]
}

/** iconFrom：注册表没收的条目借某个注册表工具的图标（不写 = 通用占位图标） */
type Spec = [id: string, name: string, tagline: string, route?: string, iconFrom?: string]

const byId = new Map<string, ToolItem>(tools.map((t) => [t.id, t]))

/** 即将开放条目没有注册表图标，借用「图片生成」的通用图标占位，保持图标框一致 */
const PLACEHOLDER_ICON = byId.get('image-generate')?.icon

function entry([id, name, tagline, route, iconFrom]: Spec): CatalogEntry {
  const t = byId.get(id)
  const icon = t?.icon ?? (iconFrom ? byId.get(iconFrom)?.icon : undefined) ?? PLACEHOLDER_ICON
  return { id, name: t?.name ?? name, tagline, route: t?.route ?? route, icon }
}

const group = (label: string, specs: Spec[]): CatalogGroup => ({ label, entries: specs.map(entry) })

/** 落地页除首组（处理组）外的分组，原样转成目录分组；与 head 里已有路由（或 id）重复的条目跳过 */
function landingGroups(page: LandingPageData, head: CatalogGroup): CatalogGroup[] {
  const seen = new Set(head.entries.flatMap((e) => [e.id, e.route ?? '']).filter(Boolean))
  return page.sections.slice(1).flatMap((sec) => {
    const entries = sec.tools
      .filter((t) => !seen.has(t.id) && !(t.route && seen.has(t.route)))
      .map((t): CatalogEntry => ({ id: t.id, name: t.name, tagline: t.tagline, route: t.route, icon: t.icon }))
    return entries.length ? [{ label: sec.label, entries }] : []
  })
}

const imageHead = group('图片处理', [
  ['ai-upscale', '高清放大', '放大补细节'],
  ['ai-eraser', '智能消除', '去除杂物'],
  // 注册表没收（也没有原型）：工具页 schema 已就绪（schemas.ts ai-inpaint），直达 /tools/ai-inpaint，借智能消除的图标
  ['ai-inpaint', '局部重绘', '框选重画', '/tools/ai-inpaint', 'ai-eraser'],
  ['ai-cutout', '智能抠图', '一键去背景'],
  ['image-translate', '图片翻译', '多语换字'],
  ['text-replace', '文字替换', '换字不换版'],
  ['aspect-ratio-convert', '比例转换', '智能改比例'],
  ['image-generate', '图片生成', '提示词生图'],
])

const imageCatalog: Catalog = {
  title: 'AI 图片',
  groups: [imageHead, ...landingGroups(pictureLanding, imageHead)],
}

/**
 * 视频工具页（视频高清 / 视频翻译）不属于「AI 图片」，用注册表的视频分类单独成栏；分组、顺序与短说明抄新版原型。
 * 「电商」组三项注册表没收，按单图复刻同一做法直达工作流页的视频流（wf:6 / wf:7 / wf:41）；电商 / 本地生活组取视频落地页。
 * 侧栏 AI 视频面板（layout/Navigation）也读这一份。
 */
const videoHead = group('视频处理', [
  ['ai-video-enhance', '视频高清', '提升画质'],
  ['ai-video-translate', '视频翻译', '配音翻译'],
  ['ai-video-generator', '视频生成', '文生视频'],
  ['ai-video-clone', '视频复刻', '参照原片生成'],
  ['ai-voiceover', '数字人口播', '文案出口播'],
])

const videoCatalog: Catalog = {
  title: 'AI 视频',
  groups: [videoHead, ...landingGroups(videoLanding, videoHead)],
}

/** 功能切换弹层（原型 FunctionSwitcher ml）顶部的一级「AI 图片 / AI 视频」分段，按这个顺序 */
export const catalogKinds: readonly { key: 'image' | 'video'; catalog: Catalog }[] = [
  { key: 'image', catalog: imageCatalog },
  { key: 'video', catalog: videoCatalog },
]

export function catalogKindOf(toolId: string): 'image' | 'video' {
  return byId.get(toolId)?.category === 'video' ? 'video' : 'image'
}

export function catalogFor(toolId: string): Catalog {
  return byId.get(toolId)?.category === 'video' ? videoCatalog : imageCatalog
}
