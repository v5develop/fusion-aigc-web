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
  /** 推荐位 banner：恰好 3 张（版式按首卡跨两行 + 右列 2 张写死，多或少都会错位） */
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
  // 兜底：圆角方块 + 星芒（找不到图标的条目用，不再借「单图复刻」）
  generic: `
    <rect x="3.4" y="3.4" width="17.2" height="17.2" rx="3.4"/>
    <path d="M12 7.6c.3 2.7 1.7 4.1 4.4 4.4-2.7.3-4.1 1.7-4.4 4.4-.3-2.7-1.7-4.1-4.4-4.4 2.7-.3 4.1-1.7 4.4-4.4z"/>`,
  // 模特替换：两个人 + 交换箭头（原型 qi-tool-icons.mjs「model-replace」）
  modelReplace: `
    <circle cx="5.8" cy="7.2" r="2.2"/>
    <path d="M1.9 15.4c.3-2.6 1.7-4.1 3.9-4.1s3.6 1.5 3.9 4.1"/>
    <circle cx="18.2" cy="7.2" r="2.2"/>
    <path d="M14.3 15.4c.3-2.6 1.7-4.1 3.9-4.1s3.6 1.5 3.9 4.1"/>
    <path d="M7.4 19.6h9.2M9.1 17.9 7.4 19.6l1.7 1.7M14.9 17.9l1.7 1.7-1.7 1.7"/>`,
  // AI试衣：衣架 + 小星芒（与「服装去皱」的熨斗区分）
  tryOn: `
    <path d="M12 9.4V8a2.6 2.6 0 1 0-2.6-2.6"/>
    <path d="M12 9.4 2.8 16a1.2 1.2 0 0 0 .7 2.2h17a1.2 1.2 0 0 0 .7-2.2z"/>
    <path d="M18.4 3.2l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z"/>`,
  // 模特换脸：人脸 + 交换箭头
  faceSwap: `
    <circle cx="12" cy="8" r="4.6"/>
    <path d="M10.2 7.4h.01M13.8 7.4h.01M10.2 9.6a2.6 2.6 0 0 0 3.6 0"/>
    <path d="M7.4 19.6h9.2M9.1 17.9 7.4 19.6l1.7 1.7M14.9 17.9l1.7 1.7-1.7 1.7"/>`,
  // 双人换衣：两件上衣 + 交换箭头
  dualTryOn: `
    <path d="M5.2 3.6 2.6 5l1 2 1.3-.5v5h4.2v-5l1.3.5 1-2-2.6-1.4a1.9 1.6 0 0 1-3.6 0z"/>
    <path transform="translate(10.4 0)" d="M5.2 3.6 2.6 5l1 2 1.3-.5v5h4.2v-5l1.3.5 1-2-2.6-1.4a1.9 1.6 0 0 1-3.6 0z"/>
    <path d="M7.4 19.6h9.2M9.1 17.9 7.4 19.6l1.7 1.7M14.9 17.9l1.7 1.7-1.7 1.7"/>`,
  // AI试鞋：运动鞋侧面
  shoe: `
    <path d="M3 16.6V9.4l3.2 1.6 2.4-2.6 1.4 1.6c1.1 1.3 2.6 2 4.3 2.2l4 .5A2.7 2.7 0 0 1 21 15.4v1.2z"/>
    <path d="M3 20h18M9.8 12l1.2 1.2M12.2 12.8l1.2 1.2"/>`,
  // 商拍生图：相机（商拍场景出图）
  studioShot: `
    <path d="M4 8h3l1.6-2.4h6.8L17 8h3a1.6 1.6 0 0 1 1.6 1.6v8.6A1.6 1.6 0 0 1 20 19.8H4a1.6 1.6 0 0 1-1.6-1.6V9.6A1.6 1.6 0 0 1 4 8z"/>
    <circle cx="12" cy="13.6" r="3.2"/>`,
  // AI商品套图：2×2 图格，其一虚线（一套图）
  productKit: `
    <rect x="3.4" y="3.4" width="7.2" height="7.2" rx="1.8"/>
    <rect x="13.4" y="3.4" width="7.2" height="7.2" rx="1.8"/>
    <rect x="3.4" y="13.4" width="7.2" height="7.2" rx="1.8"/>
    <rect x="13.4" y="13.4" width="7.2" height="7.2" rx="1.8" stroke-dasharray="2.2 2.2"/>`,
  // AI详情页：竖长页（顶图 + 文字行）
  detailPage: `
    <rect x="5.8" y="2.8" width="12.4" height="18.4" rx="2"/>
    <rect x="8.6" y="5.8" width="6.8" height="4.6" rx="1"/>
    <path d="M8.6 13.6h6.8M8.6 16.8h4"/>`,
  // 爆款图复刻：图片 + 右上火苗
  hotImageClone: `
    <rect x="3.4" y="9.4" width="11.2" height="11.2" rx="2"/>
    <path d="M4 18l3-2.8 2.4 2.2 1.8-1.4 2.6 2"/>
    <path d="M18 2.8c.4 2 2.6 3 2.6 5.4a2.6 2.6 0 0 1-5.2 0c0-1 .5-1.7 1.1-2.3.1.7.5 1 1 1.1 0-1.6.2-3 .5-4.2z"/>`,
  // 手持商品：立方体商品 + 托起的手
  inHand: `
    <path d="M12 3.4 17.4 6v5.6L12 14.2 6.6 11.6V6zM6.6 6 12 8.6 17.4 6M12 8.6v5.6"/>
    <path d="M3 16.8h3.6l3.2 1.6h4.4a1.5 1.5 0 0 1 0 3H9.2l-2.6-1H3"/>`,
  // 视频高清：画框 + 向上箭头（画质提升）
  videoHd: `
    <rect x="3" y="4.6" width="18" height="14.8" rx="2.6"/>
    <path d="M12 15.6V9M9.2 11.8 12 9l2.8 2.8"/>`,
  // 视频翻译：对话气泡 + 字母 A + 转译箭头
  videoTranslate: `
    <path d="M5 3.8h10.4a1.8 1.8 0 0 1 1.8 1.8v6.2a1.8 1.8 0 0 1-1.8 1.8H9.8L6.4 16.8v-3.2H5a1.8 1.8 0 0 1-1.8-1.8V5.6A1.8 1.8 0 0 1 5 3.8z"/>
    <path d="M6.8 10.8 10.2 5.8l3.4 5M8 9.2h4.4"/>
    <path d="M13.6 19.8h6.8M18.2 17.6l2.2 2.2-2.2 2.2"/>`,
  // 视频复刻：实线画框（带播放）→ 虚线画框（复刻出一份）
  videoReplicate: `
    <rect x="2.6" y="3.4" width="10" height="7.6" rx="2"/>
    <path d="M6.6 5.4 9.2 7.2 6.6 9z"/>
    <rect x="11.4" y="12.8" width="10" height="7.6" rx="2" stroke-dasharray="2.2 2.2"/>
    <path d="M5.4 14.4v3.4A1.2 1.2 0 0 0 6.6 19H8.6M7 17.4 8.8 19 7 20.6"/>`,
  // 爆款视频：播放键嵌在火苗里
  hotVideo: `
    <path d="M12 2.4c.8 4 6.2 6 6.2 11.6a6.2 6.2 0 0 1-12.4 0c0-2.3 1-3.9 2.3-5 .2 1.5 1 2.3 2.1 2.5 0-3.4.6-6.4 1.8-9.1z"/>
    <path d="M10.4 13.2 14.4 15.6 10.4 18z"/>`,
}

const toolIcon = (id: string) => byId.get(id)?.icon
const paths = (ds: string[]) => ds.map((d) => `<path d="${d}"/>`).join('')

/**
 * 原 AI 电商 / AI 商拍下级页的图标（24×24 描边片段），按路由取；侧栏（layout/Navigation）保留的电商 / 商拍目录也读这一份。
 * 原型目录有同名功能的用原型图标（qi-tool-icons.mjs，与首页工具箱注册表里抄来的是同一份）；
 * 原型没有的功能借本项目已用的最近似图标（注册表工具图标，或商拍首页 studio/index.vue 的线性图标）。
 */
export const SECTION_ENTRY_ICONS: Record<string, string | undefined> = {
  // 原型没有：自绘竖长页（不再借「首屏主图」，同页会撞图标）
  '/e-commerce/product-detail': EXTRA_ICONS.detailPage,
  // 原型没有：自绘 2×2 图格（不再借「商品精修」）
  '/e-commerce/product-kit': EXTRA_ICONS.productKit,
  // 原型没有：自绘图片 + 火苗（爆款图复刻）
  '/e-commerce/product-clone': EXTRA_ICONS.hotImageClone,
  // 原型没有：自绘商品 + 托起的手
  '/e-commerce/product-in-hand': EXTRA_ICONS.inHand,
  '/e-commerce/video-clone': toolIcon('ai-video-clone'),
  // 原型没有：自绘火苗里的播放键（不再借「视频生成」，同页会撞图标）
  '/e-commerce/video-hot': EXTRA_ICONS.hotVideo,
  // 原型 qi-tool-icons.mjs「model-replace」（两个人 + 交换）；注册表里没有，见 EXTRA_ICONS.modelReplace
  '/e-commerce/model-replace': EXTRA_ICONS.modelReplace,
  '/e-commerce/product-replace': toolIcon('product-replace'),
  // 原型没有：借「场景生成」（风景相框 + 小星芒）
  '/e-commerce/change-background': toolIcon('ai-background-generator'),
  // 原型没有：借商拍首页「上衣」（studio/index.vue ICONS.shirt）
  '/e-commerce/clothing-kit': paths(['M8 3l-5 3 2 4 2-1v12h10V9l2 1 2-4-5-3a4 4 0 0 1-8 0z']),
  // 原型没有：自绘衣架（不再借「商拍换装」，同页会撞图标）
  '/e-commerce/clothing-try': EXTRA_ICONS.tryOn,
  '/e-commerce/clothing-remove-wrinkle': toolIcon('cloth-wrinkle-removal'),
  // 原型没有：借商拍首页「图片」（studio/index.vue ICONS.images）
  '/e-commerce/merge-image': paths([
    'M3 5h18v14H3z',
    'M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
    'M21 15l-5-5-9 9',
  ]),
  // 原型没有：自绘运动鞋
  '/e-commerce/try-shoe': EXTRA_ICONS.shoe,
  '/studio/ai-digital-model': toolIcon('ai-digital-model'),
  '/studio/ai-posture-fission': toolIcon('ai-posture-fission'),
  // 商拍生图：相机，与「图片生成」的星芒图框区分
  '/studio/image-generate': EXTRA_ICONS.studioShot,
}

type Spec = [id: string, name: string, tagline: string, extra?: Partial<LandingTool>]

function tool([id, name, tagline, extra]: Spec): LandingTool {
  const t = byId.get(id)
  return {
    id,
    name: t?.name ?? name,
    tagline,
    route: STUDIO_ROUTES[id] ?? t?.route,
    icon: t?.icon ?? EXTRA_ICONS.generic,
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
  return { id: route, name, tagline, route, icon: SECTION_ENTRY_ICONS[route] ?? EXTRA_ICONS.generic }
}

/** 工作流模板（工作流一级入口已隐藏，模板页 /workflow?… 仍可深链）；工作流没有这个模板就整条丢掉，不留死卡 */
function workflowTool(
  id: string,
  name: string,
  tagline: string,
  iconFrom: string,
  iconOverride?: string,
): LandingTool[] {
  const route = workflowRouteOf(id)
  return route ? [{ id, name, tagline, route, icon: iconOverride ?? toolIcon(iconFrom) ?? EXTRA_ICONS.generic }] : []
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
    // 2026-11-12：服装组置顶（对齐 5186 目录），其余顺序不变
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
        ...workflowTool('fashion-model-replace', '模特替换', '换个模特', 'ai-digital-model', EXTRA_ICONS.modelReplace),
        ...workflowTool('fashion-model-face-swap', '模特换脸', '保留穿搭换脸', 'ai-posture-fission', EXTRA_ICONS.faceSwap),
        ...workflowTool('fashion-model-due-tryon', '双人换衣', '两人同穿', 'ai-digital-model', EXTRA_ICONS.dualTryOn),
      ],
    },
    section('图片处理', [
      ['ai-upscale', '高清放大', '放大补细节', { hot: true }],
      ['ai-eraser', '智能消除', '去除杂物', { hot: true }],
      ['ai-cutout', '智能抠图', '一键去背景'],
      ['image-translate', '图片翻译', '多语换字'],
      ['text-replace', '文字替换', '换字不换版'],
      ['aspect-ratio-convert', '比例转换', '智能改比例'],
      ['ai-poster-replicate', '图片复刻', '参考海报出同款版式'],
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
      ['ai-video-enhance', '视频高清', '提升画质', { hot: true, icon: EXTRA_ICONS.videoHd }],
      ['ai-video-translate', '视频翻译', '配音翻译', { icon: EXTRA_ICONS.videoTranslate }],
      ['ai-video-generator', '视频生成', '文生视频'],
      ['ai-video-clone', '视频复刻', '参照原片生成', { icon: EXTRA_ICONS.videoReplicate }],
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
        '/local-life/video-replicate',
        '/local-life/video-remake',
      ),
    },
  ],
}
