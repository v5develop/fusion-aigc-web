/**
 * 工具页左侧目录（对齐 5181 原型的「AI 图片」分组栏）。
 *
 * <p>分组与短说明抄自原型；名称、图标、路由一律取首页工具箱注册表（views/home/tools.ts），
 * 注册表里没有的条目（或没有 route 的）显示为「即将开放」，不自造路由；
 * 例外是单图复刻 / SKU替换：注册表没收，但工作流页（/workflow，wf:13 / wf:14）已可用，按工作流页同一 query 直达；
 * 局部重绘同理：注册表没收，但工具页 schema 已有，直达 /tools/ai-inpaint。
 * 原型「本地生活」组的条目在原型截图里看不全、注册表里也没有对应工具，这里不列。
 */
import { tools, type ToolItem } from '@/views/home/tools'
import { workflowRouteOf } from '@/views/workflow/schemas'

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

const imageCatalog: Catalog = {
  title: 'AI 图片',
  groups: [
    group('图片处理', [
      ['ai-upscale', '高清放大', '放大补细节'],
      ['ai-eraser', '智能消除', '去除杂物'],
      // 注册表没收（也没有原型）：工具页 schema 已就绪（schemas.ts ai-inpaint），直达 /tools/ai-inpaint，借智能消除的图标
      ['ai-inpaint', '局部重绘', '框选重画', '/tools/ai-inpaint', 'ai-eraser'],
      ['ai-cutout', '智能抠图', '一键去背景'],
      ['image-translate', '图片翻译', '多语换字'],
      ['text-replace', '文字替换', '换字不换版'],
      ['aspect-ratio-convert', '比例转换', '智能改比例'],
      ['image-generate', '图片生成', '提示词生图'],
    ]),
    group('电商', [
      ['ai-product-retouch', '商品精修', '提升质感'],
      ['product-replace', '产品替换', '换品保场景'],
      ['ai-first-screen-main-image', '首屏主图', '卖点主图'],
      ['ai-background-generator', '场景生成', '更换场景'],
      // 注册表里没有这两项：直达工作流页的视觉复刻流（wf:13 单图复制 / wf:14 SKU替换）
      ['single-image-clone', '单图复刻', '同款复制', workflowRouteOf('visual-style-replace')],
      ['sku-replace', 'SKU替换', '批量换货', workflowRouteOf('visual-sku-replace')],
    ]),
    group('服装', [
      ['cloth-wrinkle-removal', '服装去皱', '抚平褶皱'],
      ['ai-digital-model', '商拍换装', '整套换装'],
      ['ai-posture-fission', '姿态复刻', '同人换姿势'],
    ]),
  ],
}

/**
 * 视频工具页（视频高清 / 视频翻译）不属于「AI 图片」，用注册表的视频分类单独成栏；分组、顺序与短说明抄新版原型。
 * 「电商」组三项注册表没收，按单图复刻同一做法直达工作流页的视频流（wf:6 / wf:7 / wf:41）。
 * 侧栏 AI 视频面板（layout/Navigation）也读这一份。
 */
const videoCatalog: Catalog = {
  title: 'AI 视频',
  groups: [
    group('视频处理', [
      ['ai-video-enhance', '视频高清', '提升画质'],
      ['ai-video-translate', '视频翻译', '配音翻译'],
      ['ai-video-generator', '视频生成', '文生视频'],
      ['ai-video-clone', '视频复刻', '复刻提示词'],
    ]),
    group('电商', [
      ['model-sell', '模特带货', '模特卖货', workflowRouteOf('video-product-sell')],
      ['video-product-replace', '商品替换', '原片换品', workflowRouteOf('video-product-replace'), 'product-replace'],
      ['voice-sell', '口播带货', '产品口播', workflowRouteOf('video-product-talk')],
    ]),
  ],
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
