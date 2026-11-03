/**
 * 首页「工具箱」目录。
 *
 * <p>名称、分类、描述、输入形态逐条抄自 v1.0 原型 `src/data/tools.ts`；
 * 图标路径抄自原型 `src/components/icons/qi-tool-icons.mjs`（24×24 网格、单色 currentColor）。
 * `route` 只填本项目已存在的页面；没有对应页面的工具留空，首页展示为「即将开放」。
 * 12 个 Java v1 工具接到共用工具页 `/tools/<id>`（views/tools/schemas.ts 以同一个 id 查 schema）。
 */
export type ToolCategory = 'retouch' | 'edit' | 'generate' | 'video'

export type ToolInputShape =
  | 'batch-image'
  | 'dual-image'
  | 'single-image'
  | 'text-to-image'
  | 'text-image-video'
  | 'video'

export interface ToolItem {
  id: string
  name: string
  category: ToolCategory
  description: string
  inputShape: ToolInputShape
  /** 本项目已有的页面路径；undefined = 即将开放 */
  route?: string
  /** 24×24 viewBox 内的 SVG 片段（静态常量，非用户输入） */
  icon: string
}

export const toolCategories: { key: ToolCategory; label: string }[] = [
  { key: 'retouch', label: '图像修饰' },
  { key: 'edit', label: '图像编辑' },
  { key: 'generate', label: '图像生成' },
  { key: 'video', label: '视频处理' },
]

export const toolInputShapeLabels: Record<ToolInputShape, string> = {
  'batch-image': '批量图',
  'dual-image': '双图',
  'single-image': '单图',
  'text-to-image': '文本 + 参考图',
  'text-image-video': '文本 + 图 + 视频',
  video: '视频',
}

const ICONS = {
  dewrinkle: `
    <path d="M9.8 9.2h7.9a3.6 3.6 0 0 1 3.6 3.6v3H4.9l4.9-6.6z"/>
    <path d="M3.2 18.4h18.2"/>
    <path d="M9.8 9.2V7.8A3.3 3.3 0 0 1 13.1 4.5h2.6v4.7"/>`,
  retouch: `
    <rect x="9.3" y="2.8" width="5.4" height="3" rx="1"/>
    <rect x="6.8" y="5.8" width="10.4" height="15.2" rx="2.6"/>
    <path d="M12 10c.18 1.38.82 2.02 2.2 2.2-1.38.18-2.02.82-2.2 2.2-.18-1.38-.82-2.02-2.2-2.2 1.38-.18 2.02-.82 2.2-2.2z" fill="currentColor" stroke="none"/>`,
  upscale: `
    <rect x="2.6" y="4.1" width="12.8" height="15.4" rx="2.4"/>
    <path d="M3.6 16.6 7 13.2 10.2 16.4"/>
    <circle cx="17.2" cy="15.1" r="4.2"/>
    <path d="M20.2 18.1 21.9 19.8"/>
    <path d="M17.2 13.6v3M15.7 15.1h3"/>`,
  erase: `
    <path d="M6.6 20.2 3.1 16.7a1.9 1.9 0 0 1 0-2.7l8.1-8.1a1.9 1.9 0 0 1 2.7 0l4.2 4.2a1.9 1.9 0 0 1 0 2.7l-7.3 7.4"/>
    <path d="M19.8 20.2H6.2"/>
    <path d="m6.6 11.8 5.8 5.8"/>`,
  cutout: `
    <rect x="3.1" y="3.1" width="17.8" height="17.8" rx="3" stroke-dasharray="2.4 2.6" stroke-dashoffset="1.3"/>
    <circle cx="12.1" cy="9.7" r="2.5"/>
    <path d="M7.8 16.6c.5-2.5 2.2-3.8 4.3-3.8s3.8 1.3 4.3 3.8"/>`,
  translate: `
    <rect x="2.8" y="4.4" width="18.4" height="15.2" rx="2.6"/>
    <path d="M7.2 8.2v.8M4.6 10.2h5.2"/>
    <path d="M4.4 12.1 10 16.1M10 12.1 4.4 16.1"/>
    <path d="m14.2 16.1 2.8-7.2 2.8 7.2M15.3 13.5h3.4"/>`,
  textReplace: `
    <path d="M5.6 12.3 8.7 5.1 11.8 12.3M6.6 9.9h4.2"/>
    <circle cx="16" cy="10.3" r="2.2"/>
    <path d="M18.2 8.1v4.2"/>
    <path d="M4 17.1h15.8M6.2 15.3 4 17.1l2.2 1.8M17.6 15.3 19.8 17.1l-2.2 1.8"/>`,
  ratio: `
    <rect x="4.4" y="5.2" width="15.2" height="13.6" rx="2.4"/>
    <path d="M1.8 12h20.4M4 10.2 1.8 12 4 13.8M20 10.2 22.2 12 20 13.8"/>`,
  productReplace: `
    <rect x="3" y="4.9" width="7.4" height="9.2" rx="1.6"/>
    <rect x="13.6" y="4.9" width="7.4" height="9.2" rx="1.6"/>
    <path d="M3 7.5h7.4M13.6 7.5h7.4"/>
    <path d="M7.4 18.3h9.2M9.1 16.6 7.4 18.3l1.7 1.7M14.9 16.6l1.7 1.7-1.7 1.7"/>`,
  changeClothes: `
    <path d="M9.2 5.4 6 6.76 7.1 8.76 8.8 8.12V15.4h6.4V8.12l1.7.64L18 6.76 14.8 5.4a2.7 2.16 0 0 1-5.6 0z"/>
    <path d="M7.4 19.6h9.2M9.1 17.9 7.4 19.6l1.7 1.7M14.9 17.9l1.7 1.7-1.7 1.7"/>`,
  pose: `
    <circle cx="12" cy="7.6" r="2.3"/>
    <path d="M7.8 16c.3-2.7 1.9-4.2 4.2-4.2s3.9 1.5 4.2 4.2"/>
    <path d="M7.8 15.2 5.4 11.4M16.4 14.6 19.0 14.6"/>
    <path d="M7.4 19.6h9.2M9.1 17.9 7.4 19.6l1.7 1.7M14.9 17.9l1.7 1.7-1.7 1.7"/>`,
  generate: `
    <rect x="3" y="4.2" width="18" height="15.6" rx="2.8"/>
    <path d="M12 7.2c.39 3.02 1.78 4.41 4.8 4.8-3.02.39-4.41 1.78-4.8 4.8-.39-3.02-1.78-4.41-4.8-4.8 3.02-.39 4.41-1.78 4.8-4.8z" fill="currentColor" stroke="none"/>`,
  hero: `
    <rect x="4.8" y="2.2" width="14.4" height="19.6" rx="3.2"/>
    <path d="M10.2 4.8h3.6"/>
    <rect x="7.4" y="7.2" width="9.2" height="7.2" rx="1.2"/>
    <path d="M8.2 13.6 11 10.8 16 13.6"/>
    <path d="M8.4 17.4h7.2"/>`,
  scene: `
    <rect x="2.8" y="4.2" width="18.4" height="15.6" rx="2.6"/>
    <path d="M3.6 17.2 8.6 11.6 13.6 17.2"/>
    <path d="M12.8 17.2 16.2 13.6 20 17.2"/>
    <path d="M17.8 5.2c.18 1.38.82 2.02 2.2 2.2-1.38.18-2.02.82-2.2 2.2-.18-1.38-.82-2.02-2.2-2.2 1.38-.18 2.02-.82 2.2-2.2z" fill="currentColor" stroke="none"/>`,
  videoHd: `
    <path d="M3 6v12l7.4-6z" fill="currentColor" stroke="none"/>
    <circle cx="16.6" cy="12.4" r="4.5"/>
    <path d="M20.0 15.6 21.6 17.2"/>
    <path d="M16.6 10.5v3.8M14.7 12.4h3.8"/>`,
  videoTranslate: `
    <path d="M7.2 5.7v.8M4.6 7.7h5.2"/>
    <path d="M4.4 9.6 10 13.6M10 9.6 4.4 13.6"/>
    <path d="m14.2 13.6 2.8-7.2 2.8 7.2M15.3 11h3.4"/>
    <path d="M3.4 15.9h17.2M3.4 18.7h10.6"/>`,
  videoGenerate: `
    <path d="M3 6v12l7.4-6z" fill="currentColor" stroke="none"/>
    <path d="M17.6 7.4c.39 3.02 1.78 4.41 4.8 4.8-3.02.39-4.41 1.78-4.8 4.8-.39-3.02-1.78-4.41-4.8-4.8 3.02-.39 4.41-1.78 4.8-4.8z" fill="currentColor" stroke="none"/>`,
  videoClone: `
    <rect x="3.1" y="3.2" width="17.8" height="12.4" rx="2.6"/>
    <path d="M10.1 6.4 14.6 9.4 10.1 12.4z" fill="currentColor" stroke="none"/>
    <path d="M7.4 19.6h9.2M9.1 17.9 7.4 19.6l1.7 1.7M14.9 17.9l1.7 1.7-1.7 1.7"/>`,
}

export const tools: ToolItem[] = [
  {
    id: 'cloth-wrinkle-removal',
    name: '服装去皱',
    category: 'retouch',
    description: '智能抚平衣物褶皱和折痕，优化面料纹理质感，提升服装展示的平整度与精致感。',
    inputShape: 'batch-image',
    route: '/e-commerce/clothing-remove-wrinkle',
    icon: ICONS.dewrinkle,
  },
  {
    id: 'ai-product-retouch',
    name: '商品精修',
    category: 'retouch',
    description: '一键提升商品质感、清晰度与光影层次，让商品图更精致、更适合店铺展示。',
    inputShape: 'batch-image',
    route: '/tools/ai-product-retouch',
    icon: ICONS.retouch,
  },
  {
    id: 'ai-upscale',
    name: '高清放大',
    category: 'retouch',
    description: '上传原图后选择目标分辨率，AI 提升画面清晰度与细节表现，支持 1K / 2K / 4K 放大。',
    inputShape: 'batch-image',
    route: '/tools/ai-upscale',
    icon: ICONS.upscale,
  },
  {
    id: 'ai-eraser',
    name: '智能消除',
    category: 'retouch',
    description: '涂抹选中区域后去除水印、杂物与多余元素，自动补全背景，让画面更干净自然。',
    inputShape: 'single-image',
    route: '/tools/ai-eraser',
    icon: ICONS.erase,
  },
  {
    id: 'ai-cutout',
    name: '智能抠图',
    category: 'retouch',
    description: '识别图片主体并去除背景，快速生成透明背景商品图，适合电商展示与素材制作。',
    inputShape: 'single-image',
    route: '/tools/ai-cutout',
    icon: ICONS.cutout,
  },
  {
    id: 'image-translate',
    name: '图片翻译',
    category: 'edit',
    description: '识别图片中的文字并翻译回填，更轻松地完成多语言素材本地化。',
    inputShape: 'batch-image',
    route: '/tools/image-translate',
    icon: ICONS.translate,
  },
  {
    id: 'text-replace',
    name: '文字替换',
    category: 'edit',
    description: '识别图片中的文字内容，把原文替换为目标文字，版式保持不变。',
    inputShape: 'single-image',
    route: '/tools/text-replace',
    icon: ICONS.textReplace,
  },
  {
    id: 'aspect-ratio-convert',
    name: '比例转换',
    category: 'edit',
    description: '批量上传后选择目标比例，结合画面内容智能调整构图与排版，避免生硬拉伸。',
    inputShape: 'batch-image',
    route: '/tools/aspect-ratio-convert',
    icon: ICONS.ratio,
  },
  {
    // 不接 /e-commerce/product-replace：那一页是「商品视频」下的视频替换，与这里的双图换商品不是同一能力
    id: 'product-replace',
    name: '产品替换',
    category: 'edit',
    description: '保留原有场景氛围与展示效果，快速替换商品内容，适合多款商品批量出图。',
    inputShape: 'dual-image',
    route: '/tools/product-replace',
    icon: ICONS.productReplace,
  },
  {
    id: 'ai-digital-model',
    name: '商拍换装',
    category: 'edit',
    description: '选单品、传服装与模特，AI 把衣服穿到模特身上；细节裁切与提示词由系统完成。',
    inputShape: 'dual-image',
    route: '/studio/tryon',
    icon: ICONS.changeClothes,
  },
  {
    id: 'ai-posture-fission',
    name: '姿态复刻',
    category: 'edit',
    description: '上传一张人物图，再放最多 9 张姿势参考图；身份与服装不变，只换动作与神态表情。',
    inputShape: 'single-image',
    route: '/studio/pose',
    icon: ICONS.pose,
  },
  {
    id: 'image-generate',
    name: '图片生成',
    category: 'generate',
    description: '输入提示词并按需上传参考图，自定义清晰度、比例与出图数量，快速生成目标画面。',
    inputShape: 'text-to-image',
    route: '/studio/imagegen',
    icon: ICONS.generate,
  },
  {
    id: 'ai-first-screen-main-image',
    name: '首屏主图',
    category: 'generate',
    description: '基于卖点与参考图智能生成专业首屏主图，支持多语言输出。',
    inputShape: 'text-to-image',
    route: '/tools/ai-first-screen-main-image',
    icon: ICONS.hero,
  },
  {
    id: 'ai-background-generator',
    name: '场景生成',
    category: 'generate',
    description: '保持画面主体与构图关系，快速发散不同的颜色氛围与周围布景细节。',
    inputShape: 'single-image',
    route: '/tools/ai-background-generator',
    icon: ICONS.scene,
  },
  {
    id: 'ai-video-enhance',
    name: '视频高清',
    category: 'video',
    description: '上传视频后选择目标分辨率，提升视频清晰度与细节表现，支持 720P 到 4K。',
    inputShape: 'video',
    route: '/tools/ai-video-enhance',
    icon: ICONS.videoHd,
  },
  {
    id: 'ai-video-translate',
    name: '视频翻译',
    category: 'video',
    description: '上传视频后选择目标语言与音色，自动识别语音并翻译，生成配音视频。',
    inputShape: 'video',
    route: '/tools/ai-video-translate',
    icon: ICONS.videoTranslate,
  },
  {
    // /video 页：文生视频 / 图生视频 / 动作迁移（参考视频）/ 首尾帧
    id: 'ai-video-generator',
    name: '视频生成',
    category: 'video',
    description: '输入提示词后按需上传参考视频与多张参考图，快速生成短视频内容。',
    inputShape: 'text-image-video',
    route: '/video',
    icon: ICONS.videoGenerate,
  },
  {
    // 原型的视频复刻是「识别画面 → 标保持/替换 → 出多家模型提示词」；/e-commerce/video-clone 是商品图 + 参考视频的带货生成，
    // 不是同一能力，所以不接，先显示「即将开放」
    id: 'ai-video-clone',
    name: '视频复刻',
    category: 'video',
    description: '上传一条现成的短视频，机器先认画面，你只标哪几项保持、哪几项替换；四家视频模型的提示词一次出齐。',
    inputShape: 'video',
    icon: ICONS.videoClone,
  },
]
