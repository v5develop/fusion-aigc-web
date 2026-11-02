/**
 * 工具页左侧目录（对齐 5181 原型的「AI 图片」分组栏）。
 *
 * <p>分组与短说明抄自原型；名称、图标、路由一律取首页工具箱注册表（views/home/tools.ts），
 * 注册表里没有的条目（或没有 route 的）显示为「即将开放」，不自造路由。
 * 原型「本地生活」组的条目在原型截图里看不全、注册表里也没有对应工具，这里不列。
 */
import { tools, type ToolItem } from '@/views/home/tools'

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

type Spec = [id: string, name: string, tagline: string]

const byId = new Map<string, ToolItem>(tools.map((t) => [t.id, t]))

function entry([id, name, tagline]: Spec): CatalogEntry {
  const t = byId.get(id)
  return { id, name: t?.name ?? name, tagline, route: t?.route, icon: t?.icon }
}

const group = (label: string, specs: Spec[]): CatalogGroup => ({ label, entries: specs.map(entry) })

const imageCatalog: Catalog = {
  title: 'AI 图片',
  groups: [
    group('图片处理', [
      ['ai-upscale', '高清放大', '放大补细节'],
      ['ai-eraser', '智能消除', '去除杂物'],
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
      // 注册表里没有这两项：即将开放
      ['single-image-clone', '单图复刻', '同款复制'],
      ['sku-replace', 'SKU替换', '批量换货'],
    ]),
    group('服装', [
      ['cloth-wrinkle-removal', '服装去皱', '抚平褶皱'],
      ['ai-digital-model', '商拍换装', '整套换装'],
      ['ai-posture-fission', '姿态复刻', '同人换姿势'],
    ]),
  ],
}

/** 视频工具页（视频高清 / 视频翻译）不属于「AI 图片」，用注册表的视频分类单独成栏 */
const videoCatalog: Catalog = {
  title: 'AI 视频',
  groups: [
    group('视频处理', [
      ['ai-video-enhance', '视频高清', '提升清晰度'],
      ['ai-video-translate', '视频翻译', '翻译配音'],
      ['ai-video-generator', '视频生成', '提示词生视频'],
    ]),
  ],
}

export function catalogFor(toolId: string): Catalog {
  return byId.get(toolId)?.category === 'video' ? videoCatalog : imageCatalog
}
