/**
 * 「AI 图片」「AI 视频」导航首页的内容表（对齐新原型 AI 图片 / AI 视频的落地页（本仓库路由 /image、/video））。
 *
 * <p>标题、描述、分组、短说明逐字抄自原型截图；名称、图标、路由一律取首页工具箱注册表（views/home/tools.ts），
 * 注册表里没有的条目（或没有 route 的）显示为「即将开放」，不自造路由。
 * 商拍换装 / 姿态复刻指向商拍工作室页（/studio/*）；「图片生成」「视频生成」指向原型同名工具页（见下方常量）。
 * 末尾「本地生活」分组复用本地生活导航首页（views/local-life/landingData.ts）里的条目，名称、图标、路由同源。
 */
import { tools, type ToolItem } from '@/views/home/tools'
import { workflowRouteOf } from '@/views/workflow/schemas'
import { localLifeLanding, localLifeBannerTools } from '@/views/local-life/landingData'

export interface LandingTool {
  /** 注册表 id；注册表没有的条目用本地 id，仅作 key */
  id: string
  name: string
  tagline: string
  /** undefined = 即将开放 */
  route?: string
  /** 24×24 viewBox 内的 SVG 片段（静态常量） */
  icon: string
  /** 原型标「最常用」 */
  hot?: boolean
}

export interface LandingSection {
  label: string
  tools: LandingTool[]
}

export interface LandingBanner {
  id: string
  title: string
  desc: string
  cta: string
  route?: string
  /** 第三张藤紫卡 */
  accent?: boolean
}

export interface LandingPageData {
  title: string
  banners: LandingBanner[]
  sections: LandingSection[]
  /** 底部「试着复刻这些爆款」货架（创意广场模板），仅 AI 图片 / AI 视频 */
  shelf?: boolean
}

const byId = new Map<string, ToolItem>(tools.map((t) => [t.id, t]))

/**
 * 「图片生成」「视频生成」以原型为准：就是工具页 image-generate / ai-video-generator（原型 data/tools.ts，
 * 历史 ai-image-generator / ai-video-generator），与左侧导航目录同一个页面；首屏主卡与分组卡都指向它，一个名字一个页面。
 * 原通用生图 / 生视频页（/image/generate、/video/generate）原型里没有，不放卡片，只承接老深链与做同款。
 */
const IMAGE_GENERATE_TOOL_ROUTE = '/tools/image-generate'
const VIDEO_GENERATE_TOOL_ROUTE = '/tools/ai-video-generator'
/** 商拍换装 / 姿态复刻走商拍工作室（Go 网关 /api/v1/studio，含多人配对等新能力） */
const STUDIO_ROUTES: Record<string, string> = {
  'ai-digital-model': '/studio/ai-digital-model',
  'ai-posture-fission': '/studio/ai-posture-fission',
  'image-generate': IMAGE_GENERATE_TOOL_ROUTE,
}

/**
 * 注册表里没有的条目所用图标：按原型截图的图形意思画的近似件（24×24、单色 currentColor），非原型原件。
 */
const EXTRA_ICONS = {
  singleClone: `
    <rect x="7.6" y="7.4" width="13.2" height="13.2" rx="2.4"/>
    <path d="M16.4 7.4V5.6a2.2 2.2 0 0 0-2.2-2.2H5.6a2.2 2.2 0 0 0-2.2 2.2v8.6a2.2 2.2 0 0 0 2.2 2.2h2"/>
    <path d="M8.6 18.2 12 14.8l2.6 2.6 1.6-1.6 3.6 3.2"/>`,
  skuReplace: `
    <path d="M3.4 9.2V4.6a1.2 1.2 0 0 1 1.2-1.2h4.6l7.4 7.4-5.8 5.8z"/>
    <circle cx="7" cy="7" r="1.2"/>
    <path d="M7.4 19.6h9.2M9.1 17.9 7.4 19.6l1.7 1.7M14.9 17.9l1.7 1.7-1.7 1.7"/>`,
  modelSell: `
    <circle cx="8" cy="7.4" r="2.6"/>
    <path d="M3.2 19.6c.4-3.6 2.2-5.6 4.8-5.6 1.4 0 2.6.6 3.4 1.6"/>
    <path d="M13.6 11.6h7l-.8 8h-5.4z"/>
    <path d="M15.6 11.6v-1a1.5 1.5 0 0 1 3 0v1"/>`,
  voiceSell: `
    <rect x="5" y="3.4" width="5" height="9" rx="2.5"/>
    <path d="M3 10.4a4.5 4.5 0 0 0 9 0M7.5 15v4.6"/>
    <path d="M13.6 11.6h7l-.8 8h-5.4z"/>
    <path d="M15.6 11.6v-1a1.5 1.5 0 0 1 3 0v1"/>`,
}

type Spec = [id: string, name: string, tagline: string, extra?: Partial<LandingTool>]

function tool([id, name, tagline, extra]: Spec): LandingTool {
  const t = byId.get(id)
  return {
    id,
    name: t?.name ?? name,
    tagline,
    route: STUDIO_ROUTES[id] ?? t?.route,
    icon: t?.icon ?? EXTRA_ICONS.singleClone,
    ...extra,
  }
}

/** 取本地生活导航首页里的条目（按路由），保证名称 / 图标 / 路由同源；找不到就直接丢掉，不自造 */
function llTools(...routes: string[]): LandingTool[] {
  const all = [...localLifeBannerTools, ...localLifeLanding.sections.flatMap((x) => x.tools)]
  return routes.map((r) => all.find((t) => t.route === r)).filter((t): t is LandingTool => !!t)
}

const section = (label: string, specs: Spec[]): LandingSection => ({ label, tools: specs.map(tool) })

export const pictureLanding: LandingPageData = {
  title: 'AI 图片',
  shelf: true,
  banners: [
    {
      id: 'ai-digital-model',
      title: '商拍换装',
      desc: '整套换装，保留原来的姿势',
      cta: '去看看',
      route: STUDIO_ROUTES['ai-digital-model'],
    },
    {
      id: 'ai-posture-fission',
      title: '姿态复刻',
      desc: '同一个人，换一个姿势',
      cta: '去看看',
      route: STUDIO_ROUTES['ai-posture-fission'],
    },
    {
      id: 'image-generate',
      title: '图片生成',
      desc: '输入一句话，生成第一张可用的图',
      cta: '开始生成',
      route: IMAGE_GENERATE_TOOL_ROUTE,
      accent: true,
    },
  ],
  sections: [
    section('图片处理', [
      ['ai-upscale', '高清放大', '放大补细节', { hot: true }],
      ['ai-eraser', '智能消除', '去除杂物', { hot: true }],
      ['ai-cutout', '智能抠图', '一键去背景'],
      ['image-translate', '图片翻译', '多语换字'],
      ['text-replace', '文字替换', '换字不换版'],
      ['aspect-ratio-convert', '比例转换', '智能改比例'],
      ['image-generate', '图片生成', '提示词生图'],
    ]),
    section('电商', [
      ['ai-product-retouch', '商品精修', '提升质感', { hot: true }],
      ['product-replace', '产品替换', '换品保场景', { hot: true }],
      ['ai-first-screen-main-image', '首屏主图', '卖点主图'],
      ['ai-background-generator', '场景生成', '更换场景'],
      // 工作流页已接通（视觉复刻流），直达对应模板
      [
        'single-image-clone',
        '单图复刻',
        '同款复制',
        { icon: EXTRA_ICONS.singleClone, route: workflowRouteOf('visual-style-replace') },
      ],
      [
        'sku-replace',
        'SKU替换',
        '批量换货',
        { icon: EXTRA_ICONS.skuReplace, route: workflowRouteOf('visual-sku-replace') },
      ],
    ]),
    section('服装', [
      ['cloth-wrinkle-removal', '服装去皱', '抚平褶皱'],
      ['ai-digital-model', '商拍换装', '整套换装'],
      ['ai-posture-fission', '姿态复刻', '同人换姿势'],
    ]),
    {
      label: '本地生活',
      tools: llTools(
        '/local-life/full-set',
        '/local-life/note',
        '/local-life/poster',
        '/local-life/long-image',
      ),
    },
  ],
}

export const videoLanding: LandingPageData = {
  title: 'AI 视频',
  shelf: true,
  banners: [
    {
      id: 'model-sell',
      title: '模特带货',
      desc: '模特穿上商品，直接出带货视频',
      cta: '去看看',
      route: workflowRouteOf('video-product-sell'),
    },
    {
      id: 'video-product-replace',
      title: '商品替换',
      desc: '原片换商品，场景和运镜不动',
      cta: '去看看',
      route: workflowRouteOf('video-product-replace'),
    },
    {
      id: 'ai-video-generator',
      title: '视频生成',
      desc: '一句话生成一段可用的短视频',
      cta: '开始生成',
      route: VIDEO_GENERATE_TOOL_ROUTE,
      accent: true,
    },
  ],
  sections: [
    section('视频处理', [
      ['ai-video-enhance', '视频高清', '提升画质', { hot: true }],
      ['ai-video-translate', '视频翻译', '配音翻译'],
      ['ai-video-generator', '视频生成', '文生视频'],
      ['ai-video-clone', '视频复刻', '参照原片生成'],
    ]),
    section('电商', [
      [
        'model-sell',
        '模特带货',
        '模特卖货',
        { icon: EXTRA_ICONS.modelSell, route: workflowRouteOf('video-product-sell') },
      ],
      [
        'video-product-replace',
        '商品替换',
        '原片换品',
        {
          icon: byId.get('product-replace')?.icon ?? EXTRA_ICONS.skuReplace,
          route: workflowRouteOf('video-product-replace'),
        },
      ],
      [
        'voice-sell',
        '口播带货',
        '产品口播',
        { icon: EXTRA_ICONS.voiceSell, hot: true, route: workflowRouteOf('video-product-talk') },
      ],
    ]),
    {
      label: '本地生活',
      tools: llTools(
        '/local-life/explore-shop',
        '/local-life/short-drama',
        '/local-life/voiceover',
        '/local-life/action-transfer',
        '/local-life/video-remake',
      ),
    },
  ],
}
