/**
 * 「AI 图片」「AI 视频」导航首页的内容表（对齐新原型 AI 图片 / AI 视频的落地页（本仓库路由 /image、/video））。
 *
 * <p>标题、描述、分组、短说明逐字抄自原型截图；名称、图标、路由一律取首页工具箱注册表（views/home/tools.ts），
 * 注册表里没有的条目（或没有 route 的）显示为「即将开放」，不自造路由。
 * 商拍换装 / 姿态复刻指向商拍工作室页（/studio/*）；「图片生成」「视频生成」指向原型同名工具页（见下方常量）。
 * 末尾「本地生活」分组复用本地生活导航首页（views/local-life/landingData.ts）里的条目，名称、图标、路由同源。
 *
 * <p>2026-11-09 产品决定：主导航隐藏「工作流」「AI 电商」「AI 商拍」「本地生活」四个一级入口（页面与路由都留着，深链照开），
 * 它们的子功能按图片 / 视频归到这两页的分组里（工具页左侧目录 views/tools/catalog.ts 也由这里取，两处同源）：
 * - AI 图片：图片处理 / 商拍（商拍换装、姿态复刻、商拍生图）/ 电商（含原 AI 电商的商品图四项）/
 *   服装（含原 AI 电商的穿戴图与工作流里不与商拍重复的模板）/ 本地生活（图文类 + 店铺档案、AI文案）
 * - AI 视频：视频处理 / 电商（含原 AI 电商的爆款视频、模特替换）/ 本地生活（视频类）
 * 同一功能有两套实现的只放一处，不重复：视频复刻取 /tools/ai-video-clone（不放 /e-commerce/video-clone）、
 * 商品替换取工作流版（不放 /e-commerce/product-replace）、服装去皱取 /tools 版（不放 /e-commerce/clothing-remove-wrinkle）；
 * 搭配融图电商首页已按产品决定摘掉卡片，这里同样不放（路由仍在）。
 * 工作流服装模板里与商拍 / 电商重复的（模特试穿、服装上身、鞋子上脚、配饰穿戴 ≈ 商拍换装 / AI试鞋；背景替换 ≈ 人像换背景；
 * 模特换脸换背景 = 换脸 + 换背景）不放。
 */
import { tools, type ToolItem } from '@/views/home/tools'
import { workflowRouteOf } from '@/views/workflow/schemas'
import { localLifeLanding, localLifeBannerTools } from '@/views/local-life/landing-data'

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
  /** banner 右侧主图（原型 AiExploreView HERO_IMAGE）；缺省回落工具封面 */
  image?: string
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

const toolIcon = (id: string) => byId.get(id)?.icon
const paths = (ds: string[]) => ds.map((d) => `<path d="${d}"/>`).join('')

/**
 * 原 AI 电商 / AI 商拍下级页的图标（24×24 描边片段），按路由取；侧栏（layout/Navigation）保留的电商 / 商拍目录也读这一份。
 * 原型目录有同名功能的用原型图标（qi-tool-icons.mjs，与首页工具箱注册表里抄来的是同一份）；
 * 原型没有的功能借本项目已用的最近似图标（注册表工具图标，或商拍首页 studio/index.vue 的线性图标）。
 */
export const SECTION_ENTRY_ICONS: Record<string, string | undefined> = {
  // 原型没有：借「首屏主图」（手机首屏 + 主图）
  '/e-commerce/product-detail': toolIcon('ai-first-screen-main-image'),
  // 原型没有：借「商品精修」（商品瓶 + 星芒）
  '/e-commerce/product-kit': toolIcon('ai-product-retouch'),
  // 原型没有：借商拍首页「循环箭头」（studio/index.vue ICONS.repeat）
  '/e-commerce/product-clone': paths([
    'M17 2l3 3-3 3',
    'M4 11V9a4 4 0 0 1 4-4h12',
    'M7 22l-3-3 3-3',
    'M20 13v2a4 4 0 0 1-4 4H4',
  ]),
  // 原型没有：借商拍首页「人像」（studio/index.vue ICONS.person）
  '/e-commerce/product-in-hand': paths(['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21c0-4 3.6-6 8-6s8 2 8 6']),
  '/e-commerce/video-clone': toolIcon('ai-video-clone'),
  // 原型没有：借「视频生成」（播放键 + 大星芒）
  '/e-commerce/video-hot': toolIcon('ai-video-generator'),
  // 原型 qi-tool-icons.mjs「model-replace」（两个人 + 交换）；注册表里没有，原样抄过来
  '/e-commerce/model-replace': `
    <circle cx="5.8" cy="7.2" r="2.2"/>
    <path d="M1.9 15.4c.3-2.6 1.7-4.1 3.9-4.1s3.6 1.5 3.9 4.1"/>
    <circle cx="18.2" cy="7.2" r="2.2"/>
    <path d="M14.3 15.4c.3-2.6 1.7-4.1 3.9-4.1s3.6 1.5 3.9 4.1"/>
    <path d="M7.4 19.6h9.2M9.1 17.9 7.4 19.6l1.7 1.7M14.9 17.9l1.7 1.7-1.7 1.7"/>`,
  '/e-commerce/product-replace': toolIcon('product-replace'),
  // 原型没有：借「场景生成」（风景相框 + 小星芒）
  '/e-commerce/change-background': toolIcon('ai-background-generator'),
  // 原型没有：借商拍首页「上衣」（studio/index.vue ICONS.shirt）
  '/e-commerce/clothing-kit': paths(['M8 3l-5 3 2 4 2-1v12h10V9l2 1 2-4-5-3a4 4 0 0 1-8 0z']),
  // 原型没有：借「商拍换装」（T 恤 + 交换箭头）
  '/e-commerce/clothing-try': toolIcon('ai-digital-model'),
  '/e-commerce/clothing-remove-wrinkle': toolIcon('cloth-wrinkle-removal'),
  // 原型没有：借商拍首页「图片」（studio/index.vue ICONS.images）
  '/e-commerce/merge-image': paths([
    'M3 5h18v14H3z',
    'M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
    'M21 15l-5-5-9 9',
  ]),
  // 原型没有：借商拍首页「姿态」全身剪影（studio/index.vue ICONS.pose）
  '/e-commerce/try-shoe': paths(['M12 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M5 9l7 1 7-3', 'M12 10v5l-4 6', 'M12 15l4 6']),
  '/studio/ai-digital-model': toolIcon('ai-digital-model'),
  '/studio/ai-posture-fission': toolIcon('ai-posture-fission'),
  '/studio/image-generate': toolIcon('image-generate'),
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

/** 原 AI 电商 / AI 商拍的下级页：名称取路由 meta.title 同名（views/e-commerce/entries.ts 卡片标题），图标按路由取 */
function routeTool(route: string, name: string, tagline: string): LandingTool {
  return { id: route, name, tagline, route, icon: SECTION_ENTRY_ICONS[route] ?? EXTRA_ICONS.singleClone }
}

/** 工作流模板（工作流一级入口已隐藏，模板页 /workflow?… 仍可深链）；工作流没有这个模板就整条丢掉，不留死卡 */
function workflowTool(id: string, name: string, tagline: string, iconFrom: string): LandingTool[] {
  const route = workflowRouteOf(id)
  return route ? [{ id, name, tagline, route, icon: toolIcon(iconFrom) ?? EXTRA_ICONS.singleClone }] : []
}

export const pictureLanding: LandingPageData = {
  title: 'AI 图片',
  shelf: true,
  banners: [
    {
      id: 'ai-digital-model',
      image: '/images/landing/model-1.jpg',
      title: '商拍换装',
      desc: '整套换装，保留原来的姿势',
      cta: '去看看',
      route: STUDIO_ROUTES['ai-digital-model'],
    },
    {
      id: 'ai-posture-fission',
      image: '/images/landing/model-3.jpg',
      title: '姿态复刻',
      desc: '同一个人，换一个姿势',
      cta: '去看看',
      route: STUDIO_ROUTES['ai-posture-fission'],
    },
    {
      id: 'image-generate',
      image: '/images/landing/result-1.jpg',
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
    section('商拍', [
      ['ai-digital-model', '商拍换装', '整套换装'],
      ['ai-posture-fission', '姿态复刻', '同人换姿势'],
      // 商拍工作室的生图页（与「图片生成」工具页不是同一页），改名「商拍生图」免得两张同名卡
      [
        'studio-image-generate',
        '商拍生图',
        '商拍场景出图',
        { route: '/studio/image-generate', icon: SECTION_ENTRY_ICONS['/studio/image-generate'] },
      ],
    ]),
    {
      label: '电商',
      tools: [
        ...section('', [
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
        ]).tools,
        // 原 AI 电商「商品图」
        routeTool('/e-commerce/product-kit', 'AI商品套图', '一键全套图'),
        routeTool('/e-commerce/product-detail', 'AI详情页', '批量详情素材'),
        routeTool('/e-commerce/product-clone', '爆款图复刻', '对标爆款'),
        routeTool('/e-commerce/product-in-hand', '手持商品', '真人手持'),
      ],
    },
    {
      label: '服装',
      tools: [
        ...section('', [['cloth-wrinkle-removal', '服装去皱', '抚平褶皱']]).tools,
        // 原 AI 电商「穿戴图」（服装去皱与上面 /tools 版同一功能，不重复）
        routeTool('/e-commerce/clothing-kit', 'AI穿戴套图', '多模特穿搭'),
        routeTool('/e-commerce/clothing-try', 'AI试衣', '真人实景上身'),
        routeTool('/e-commerce/try-shoe', 'AI试鞋', '鞋子上脚'),
        routeTool('/e-commerce/change-background', '人像换背景', '保留人像换景'),
        // 工作流服装模板里商拍 / 电商没有的
        ...workflowTool('fashion-model-replace', '模特替换', '换个模特', 'ai-digital-model'),
        ...workflowTool('fashion-model-face-swap', '模特换脸', '保留穿搭换脸', 'ai-posture-fission'),
        ...workflowTool('fashion-model-due-tryon', '双人换衣', '两人同穿', 'ai-digital-model'),
      ],
    },
    {
      label: '本地生活',
      tools: llTools(
        '/local-life/full-set',
        '/local-life/note',
        '/local-life/poster',
        '/local-life/long-image',
        '/local-life/shop-profile',
        '/local-life/copywriting',
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
      image: '/images/landing/model-3.jpg',
      title: '模特带货',
      desc: '模特穿上商品，直接出带货视频',
      cta: '去看看',
      route: workflowRouteOf('video-product-sell'),
    },
    {
      id: 'video-product-replace',
      image: '/images/landing/result-2.jpg',
      title: '商品替换',
      desc: '原片换商品，场景和运镜不动',
      cta: '去看看',
      route: workflowRouteOf('video-product-replace'),
    },
    {
      id: 'ai-video-generator',
      image: '/images/landing/scene-1.jpg',
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
    {
      label: '电商',
      tools: [
        ...section('', [
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
        ]).tools,
        // 原 AI 电商「商品视频」：视频复刻 / 商品替换与上面、视频处理里的同名功能重复，不再放
        routeTool('/e-commerce/video-hot', '爆款视频', '带货短视频'),
        routeTool('/e-commerce/model-replace', '模特替换', '换视频模特'),
      ],
    },
    {
      label: '本地生活',
      tools: llTools(
        '/local-life/explore-shop',
        '/local-life/short-drama',
        '/local-life/voiceover',
        '/local-life/digital-human',
        '/local-life/action-transfer',
        '/local-life/video-remake',
      ),
    },
  ],
}
