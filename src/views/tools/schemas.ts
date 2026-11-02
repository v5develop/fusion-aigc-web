/**
 * 工具箱 12 个工具的页面 schema（/tools/:toolId 共用一个页面，按这里渲染）。
 *
 * <p>界面字段（标签、上传槽位、提交文案、costSource、actions）抄自 v1.0 后端包
 * `docs/api-contract.json` 的 `pages[schemaId]`；请求体按 Java 现有 v1 路由的真实入参组装：
 * - 17 条 `/api/v1/tools/ai-*` 共用 `CoreToolSubmissionRequest`（camelCase，无兜底 map，键名写错会被静默丢弃）；
 * - 抠图走 `CreaftV1CutoutController` 的 `CreaftV1CutoutRequest`（只有 imageUrl，同步出结果）。
 * 必填/取值同时对过 Java 的 `compat/v1-request-models.json`（v1 pydantic 导出）。
 *
 * <p>`verified`：键名与映射在 Java 代码里能逐字对上才是 true；`optionsVerified`：
 * 选项取值也在 Java 里有白名单可对才是 true。false 的一律「待联调确认」，只记在这里，不对用户展示。
 */

export type UploadKind = 'image' | 'video'

export interface ToolUpload {
  /** 槽位序号（与契约 uploads[].slot 一致） */
  slot: number
  label: string
  kind: UploadKind
  max: number
  required: boolean
  maxBytes: number
  accept: string
  /** 视频时长下限 / 上限（秒），契约给了才有 */
  minDuration?: number
  maxDuration?: number
  /**
   * 落到 Java 请求体的哪个键：
   * - `imageUrl` / `originalImageUrl` / `videoUrl`：单值键，多张时**逐张各提交一次**（契约「按张逐张提交」）；
   * - `imageUrls`：数组键，整批一次提交。
   */
  javaKey: 'imageUrl' | 'imageUrls' | 'originalImageUrl' | 'productImageUrl' | 'videoUrl'
  verified: boolean
}

export type FieldType =
  | 'chips'
  | 'select'
  | 'textarea'
  | 'stepper'
  | 'switch'
  | 'number'
  | 'mask'
  | 'region-list'
  | 'voice'

export interface ToolField {
  key: string
  label: string
  type: FieldType
  required: boolean
  default?: string | number | boolean
  options?: string[]
  min?: number
  max?: number
  maxLength?: number
  /** 只在某个 mode 取值下显示并提交（比例转换的预设 / 自定义尺寸） */
  showWhen?: { key: string; equals: string }
  /** Java 请求体里的键；`voice` 一个界面字段落两个键 */
  javaKey: string | string[]
  /** 取值变换，见 toJavaValue */
  transform?: 'lower' | 'omit-auto'
  /** 只用于界面分支，不进请求体（如比例转换的「尺寸方式」） */
  uiOnly?: boolean
  verified: boolean
  optionsVerified?: boolean
  /** 联调备注（不展示给用户） */
  note?: string
}

export interface ToolSchema {
  /** 首页卡片 id，也是路由参数 /tools/:toolId */
  homeId: string
  schemaId: string
  apiTool: string
  /** Java 提交路由（相对 baseURL） */
  javaRoute: string
  /** 历史接口的 toolTitle：GET /api/v1/tools/{toolTitle}/histories */
  historyTitle: string
  /** true = 同步接口（抠图）：成功直接返回 {url} */
  sync?: boolean
  title: string
  description: string
  /** 功能介绍面板里的使用步骤 */
  steps: string[]
  media: UploadKind
  uploads: ToolUpload[]
  fields: ToolField[]
  submit: { label: string; costUnit: string; costSource: string }
  actions: string[]
}

const IMG_ACCEPT = '.jpg,.jpeg,.png,.webp,.gif'
const IMG_MAX = 10 * 1024 * 1024
const VIDEO_ACCEPT = '.mp4,.mov,.webm'
const VIDEO_MAX = 500 * 1024 * 1024

const imageSlot = (
  label: string,
  max: number,
  javaKey: ToolUpload['javaKey'],
  required = true,
  slot = 0,
): ToolUpload => ({
  slot,
  label,
  kind: 'image',
  max,
  required,
  maxBytes: IMG_MAX,
  accept: IMG_ACCEPT,
  javaKey,
  verified: true,
})

const RES_1K_4K = ['1K', '2K', '4K']
const IMAGE_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']

/** 分辨率：Java normalizeResolution 白名单 1k/2k/4k（CompatBatchCatalog.RESOLUTIONS），界面大写需转小写 */
const resolutionField = (label = '目标分辨率', def = '1K'): ToolField => ({
  key: 'resolution',
  label,
  type: 'chips',
  required: false,
  default: def,
  options: RES_1K_4K,
  javaKey: 'resolution',
  transform: 'lower',
  verified: true,
  optionsVerified: true,
})

/** 画幅：Java requireImageAspectRatio（GptImage2Spec.mapToSpec）+ CompatBatchCatalog.ASPECT_RATIOS 均含这 10 个 */
const aspectRatioField = (): ToolField => ({
  key: 'aspectRatio',
  label: '画幅比例',
  type: 'chips',
  required: false,
  default: '1:1',
  options: IMAGE_RATIOS,
  javaKey: 'aspectRatio',
  verified: true,
  optionsVerified: true,
})

/** 张数：契约 count → Java num（@Min(1) @Max(9)，直接乘进计费） */
const countField = (): ToolField => ({
  key: 'count',
  label: '生成张数',
  type: 'stepper',
  required: false,
  default: 1,
  min: 1,
  max: 9,
  javaKey: 'num',
  verified: true,
})

export const toolSchemas: ToolSchema[] = [
  {
    homeId: 'ai-product-retouch',
    schemaId: 'tool:ai-product-retouch',
    apiTool: 'ai-product-retouch',
    javaRoute: '/api/v1/tools/ai-retouch',
    historyTitle: 'ai-retouch',
    title: '商品精修',
    description: '一键提升商品质感、清晰度与光影层次，让商品图更精致、更适合店铺展示。',
    steps: ['上传 1–20 张商品图', '点击「开始精修」，每张图单独生成一条记录', '在历史记录里点一条，右侧查看与下载结果'],
    media: 'image',
    uploads: [imageSlot('图片', 20, 'imageUrl')],
    fields: [],
    submit: { label: '开始精修', costUnit: '张', costSource: '未显示（桌面 1.0.17 未给该工具报价）' },
    actions: [],
  },
  {
    homeId: 'ai-upscale',
    schemaId: 'tool:ai-upscale',
    apiTool: 'ai-upscale',
    javaRoute: '/api/v1/tools/ai-image-upscaler',
    historyTitle: 'ai-image-upscaler',
    title: '高清放大',
    description: '上传原图后选择目标分辨率，AI 提升画面清晰度与细节表现，支持 1K / 2K / 4K 放大。',
    steps: ['上传 1–20 张图片', '选择目标清晰度', '点击「开始放大」，每张图单独生成一条记录'],
    media: 'image',
    uploads: [imageSlot('图片', 20, 'imageUrl')],
    // v1 AIImageUpscalerRequest.resolution 必填，故给默认值
    fields: [{ ...resolutionField('清晰度', '2K'), required: true }],
    submit: { label: '开始放大', costUnit: '张', costSource: '工具单价（upscale）× 张数' },
    actions: [],
  },
  {
    homeId: 'ai-eraser',
    schemaId: 'tool:ai-eraser',
    apiTool: 'ai-eraser',
    javaRoute: '/api/v1/tools/ai-erase',
    historyTitle: 'ai-erase',
    title: '智能消除',
    description: '涂抹选中区域后去除水印、杂物与多余元素，自动补全背景，让画面更干净自然。',
    steps: ['上传 1 张原图', '用画笔涂抹要去掉的区域', '点击「开始消除」'],
    media: 'image',
    uploads: [imageSlot('原图', 1, 'originalImageUrl')],
    fields: [
      {
        key: 'mask',
        label: '涂抹区域',
        type: 'mask',
        required: true,
        javaKey: 'maskUrl',
        // 键名 maskUrl 已对上（Java 必填）；蒙版图格式（黑底白涂、与原图同尺寸）是按 v1 惯例生成，未在 Java 里找到约束
        verified: true,
        note: '蒙版格式（黑底白色涂抹、PNG、与原图同像素尺寸）待联调确认',
      },
    ],
    submit: { label: '开始消除', costUnit: '次', costSource: '未显示（桌面 1.0.17 未给该工具报价）' },
    actions: ['换一张'],
  },
  {
    homeId: 'ai-cutout',
    schemaId: 'tool:ai-cutout',
    apiTool: 'ai-cutout',
    javaRoute: '/api/v1/tools/cutout',
    historyTitle: 'cutout',
    sync: true,
    title: '智能抠图',
    description: '识别图片主体并去除背景，快速生成透明背景商品图，适合电商展示与素材制作。',
    steps: ['上传 1 张原图', '点击「开始抠图」，通常数十秒内出结果', '下载透明背景图或放大查看'],
    media: 'image',
    uploads: [imageSlot('原图', 1, 'imageUrl')],
    fields: [],
    submit: { label: '开始抠图', costUnit: '次', costSource: 'features/biz-points.cutout' },
    actions: ['换一张', '下载结果', '放大查看抠图结果'],
  },
  {
    homeId: 'image-translate',
    schemaId: 'tool:image-translate',
    apiTool: 'image-translate',
    javaRoute: '/api/v1/tools/ai-image-translate',
    historyTitle: 'ai-image-translate',
    title: '图片翻译',
    description: '识别图片中的文字并翻译回填，更轻松地完成多语言素材本地化。',
    steps: ['上传 1–20 张图片', '选择目标语言（整批同一语言）', '点击「开始翻译」，每张图单独生成一条记录'],
    media: 'image',
    uploads: [imageSlot('图片', 20, 'imageUrl')],
    fields: [
      {
        key: 'targetLanguage',
        label: '目标语言',
        type: 'select',
        required: true,
        default: '英语',
        options: [
          '中文',
          '英语',
          '繁体中文',
          '葡萄牙语',
          '俄语',
          '阿拉伯语',
          '泰语',
          '越南语',
          '意大利语',
          '日语',
          '波兰语',
          '土耳其语',
          '印尼语',
          '印地语',
          '韩语',
          '法语',
          '德语',
          '西班牙语',
        ],
        // 键名 targetLanguage（不是 language）已对上；Java 只判非空，取值原样透传，无白名单
        javaKey: 'targetLanguage',
        verified: true,
        optionsVerified: false,
        note: '中文语言名能否被执行方识别待联调确认',
      },
    ],
    submit: { label: '开始翻译', costUnit: '张', costSource: '未显示（按张逐张提交，整批同一语言）' },
    actions: [],
  },
  {
    homeId: 'text-replace',
    schemaId: 'tool:text-replace',
    apiTool: 'text-replace',
    javaRoute: '/api/v1/tools/ai-text-replace',
    historyTitle: 'ai-text-replace',
    title: '文字替换',
    description: '识别图片中的文字内容，把原文替换为目标文字，版式保持不变。',
    steps: ['上传 1 张原图', '点击「识别文字」（识别单独计费）', '在识别结果里改写要替换的文字', '点击「开始替换」'],
    media: 'image',
    uploads: [imageSlot('原图', 1, 'imageUrl')],
    fields: [
      {
        key: 'regions',
        label: '识别结果',
        type: 'region-list',
        required: true,
        maxLength: 100,
        // 契约 regions → Java textInformation[{targetText, text, textRectangles{angle,height,left,top,width,pos[4]}}]，
        // 像素矩形来自 POST /api/v1/tools/ocr 的 Results[].TextRectangles（Java 控制器说明里给了原样键名）
        javaKey: 'textInformation',
        verified: true,
        note: 'OCR 结果 TextRectangles 的 Pos 偶有空数组：这类区域不能提交（Java 要求恰好 4 点），已在界面过滤',
      },
    ],
    submit: { label: '开始替换', costUnit: '次', costSource: '识别单独计费；替换本身未显示报价' },
    actions: ['识别文字', '重新识别'],
  },
  {
    homeId: 'aspect-ratio-convert',
    schemaId: 'tool:aspect-ratio-convert',
    apiTool: 'aspect-ratio-convert',
    javaRoute: '/api/v1/tools/ai-ratio-convert',
    historyTitle: 'ai-ratio-convert',
    title: '比例转换',
    description: '批量上传后选择目标比例，结合画面内容智能调整构图与排版，避免生硬拉伸。',
    steps: ['上传 1–20 张图片（整批一次提交）', '选择预设比例，或填写自定义输出尺寸', '点击「开始转换」'],
    media: 'image',
    uploads: [imageSlot('图片', 20, 'imageUrls')],
    fields: [
      {
        key: 'mode',
        label: '尺寸方式',
        type: 'chips',
        required: true,
        default: '预设比例',
        options: ['预设比例', '自定义尺寸'],
        javaKey: [],
        uiOnly: true,
        // Java 注释：resolution+aspectRatio 与 width+height 二选一、各自成对
        verified: true,
      },
      { ...resolutionField(), showWhen: { key: 'mode', equals: '预设比例' } },
      {
        key: 'aspectRatio',
        label: '画幅比例',
        type: 'chips',
        required: false,
        default: '1:1',
        options: ['1:1', '3:4', '4:3', '9:16', '16:9', '自适应'],
        showWhen: { key: 'mode', equals: '预设比例' },
        javaKey: 'aspectRatio',
        transform: 'omit-auto',
        verified: true,
        optionsVerified: false,
        note: '「自适应」不在 Java 比例白名单里，当前按不传 aspectRatio 处理，后端是否接受待联调确认',
      },
      {
        key: 'width',
        label: '输出宽度（像素）',
        type: 'number',
        required: true,
        default: 1024,
        min: 64,
        max: 8192,
        showWhen: { key: 'mode', equals: '自定义尺寸' },
        javaKey: 'width',
        verified: true,
      },
      {
        key: 'height',
        label: '输出高度（像素）',
        type: 'number',
        required: true,
        default: 1024,
        min: 64,
        max: 8192,
        showWhen: { key: 'mode', equals: '自定义尺寸' },
        javaKey: 'height',
        verified: true,
      },
    ],
    submit: {
      label: '开始转换',
      costUnit: '张',
      costSource: '预设比例：工具单价（ratioConvert）× 张数；自定义尺寸不显示',
    },
    actions: [],
  },
  {
    homeId: 'product-replace',
    schemaId: 'tool:product-replace',
    apiTool: 'product-replace',
    javaRoute: '/api/v1/tools/ai-product-replace',
    historyTitle: 'ai-product-replace',
    title: '产品替换',
    description: '保留原有场景氛围与展示效果，快速替换商品内容，适合多款商品批量出图。',
    steps: ['上传 1–20 张底图', '上传 1 张替换素材（新商品图）', '点击「开始替换」，每张底图单独生成一条记录'],
    media: 'image',
    uploads: [imageSlot('底图', 20, 'originalImageUrl'), imageSlot('替换素材', 1, 'productImageUrl', true, 1)],
    fields: [],
    submit: { label: '开始替换', costUnit: '张', costSource: '未显示（桌面 1.0.17 未给该工具报价）' },
    actions: [],
  },
  {
    homeId: 'ai-first-screen-main-image',
    schemaId: 'tool:ai-first-screen-main-image',
    apiTool: 'ai-first-screen-main-image',
    javaRoute: '/api/v1/tools/ai-first-screen-main-image',
    historyTitle: 'ai-first-screen-main-image',
    title: '首屏主图',
    description: '基于卖点与参考图智能生成专业首屏主图，支持多语言输出。',
    steps: ['上传 1–9 张参考图', '填写卖点描述', '选择分辨率、比例、张数与输出语言', '点击「开始生成」'],
    media: 'image',
    uploads: [imageSlot('参考图（至少一张）', 9, 'imageUrls')],
    fields: [
      {
        key: 'prompt',
        label: '卖点描述',
        type: 'textarea',
        required: true,
        maxLength: 3000,
        javaKey: 'content',
        verified: true,
      },
      resolutionField(),
      aspectRatioField(),
      countField(),
      {
        key: 'language',
        label: '输出语言',
        type: 'select',
        required: true,
        default: '中文',
        options: [
          '中文',
          '英语',
          '繁体中文',
          '韩语',
          '法语',
          '德语',
          '西班牙语',
          '葡萄牙语',
          '俄语',
          '阿拉伯语',
          '泰语',
          '越南语',
          '意大利语',
          '日语',
          '波兰语',
          '土耳其语',
          '印尼语',
          '印地语',
          '无语言',
        ],
        // v1 默认值是「中文」，键名已对上；其余语言名（含「无语言」）Java 原样透传，无白名单
        javaKey: 'language',
        verified: true,
        optionsVerified: false,
        note: '除「中文」外的语言名（尤其「无语言」）待联调确认',
      },
      {
        key: 'rewritePrompt',
        label: '输入润色',
        type: 'switch',
        required: false,
        default: true,
        javaKey: 'rewritePrompt',
        verified: true,
      },
    ],
    submit: { label: '开始生成', costUnit: '次', costSource: 'image-model-configs.points[目标分辨率] × 张数' },
    actions: [],
  },
  {
    homeId: 'ai-background-generator',
    schemaId: 'tool:ai-background-generator',
    apiTool: 'ai-background-generator',
    javaRoute: '/api/v1/tools/ai-background-generator',
    historyTitle: 'ai-background-generator',
    title: '场景生成',
    description: '保持画面主体与构图关系，快速发散不同的颜色氛围与周围布景细节。',
    steps: ['（选填）上传 1 张参考图', '填写场景描述', '选择分辨率、比例与张数', '点击「开始生成」'],
    media: 'image',
    uploads: [imageSlot('参考图（选填）', 1, 'imageUrl', false)],
    fields: [
      {
        key: 'prompt',
        label: '场景描述',
        type: 'textarea',
        required: true,
        maxLength: 3000,
        javaKey: 'content',
        verified: true,
      },
      resolutionField(),
      aspectRatioField(),
      countField(),
    ],
    submit: { label: '开始生成', costUnit: '次', costSource: 'image-model-configs.points[目标分辨率] × 张数' },
    actions: [],
  },
  {
    homeId: 'ai-video-enhance',
    schemaId: 'tool:ai-video-enhance',
    apiTool: 'ai-video-enhance',
    javaRoute: '/api/v1/tools/ai-video-enhance',
    historyTitle: 'ai-video-enhance',
    title: '视频高清',
    description: '上传视频后选择目标分辨率，提升视频清晰度与细节表现，支持 720P 到 4K。',
    steps: ['上传 1 段视频（2–300 秒，≤500M）', '选择目标分辨率', '点击「开始提升画质」'],
    media: 'video',
    uploads: [
      {
        slot: 0,
        label: '视频',
        kind: 'video',
        max: 1,
        required: true,
        maxBytes: VIDEO_MAX,
        accept: VIDEO_ACCEPT,
        minDuration: 2,
        maxDuration: 300,
        javaKey: 'videoUrl',
        verified: true,
      },
    ],
    fields: [
      {
        key: 'resolution',
        label: '目标分辨率',
        type: 'chips',
        required: true,
        default: '1080P',
        options: ['720P', '1080P', '2K', '4K'],
        // v1 literal 720p/1080p/2k/4k（CompatBatchCatalog.VIDEO_ENHANCE_RESOLUTIONS）
        javaKey: 'resolution',
        transform: 'lower',
        verified: true,
        optionsVerified: true,
      },
    ],
    submit: { label: '开始提升画质', costUnit: '秒', costSource: 'features/biz-points.videoEnhance[目标分辨率] × 秒' },
    actions: [],
  },
  {
    homeId: 'ai-video-translate',
    schemaId: 'tool:ai-video-translate',
    apiTool: 'ai-video-translate',
    javaRoute: '/api/v1/tools/ai-video-translate',
    historyTitle: 'ai-video-translate',
    title: '视频翻译',
    description: '上传视频后选择目标语言与音色，自动识别语音并翻译，生成配音视频。',
    steps: ['上传 1 段视频（2–300 秒，≤500M）', '选择目标语言与配音音色', '按需开启字幕选项', '点击「开始翻译」'],
    media: 'video',
    uploads: [
      {
        slot: 0,
        label: '视频',
        kind: 'video',
        max: 1,
        required: true,
        maxBytes: VIDEO_MAX,
        accept: VIDEO_ACCEPT,
        minDuration: 2,
        maxDuration: 300,
        javaKey: 'videoUrl',
        verified: true,
      },
    ],
    fields: [
      {
        key: 'language',
        label: '目标语言',
        type: 'select',
        required: true,
        default: '英语',
        options: ['中文（普通话）', '英语', '法语', '德语', '俄语', '意大利语', '西班牙语', '葡萄牙语', '日语', '韩语'],
        javaKey: 'language',
        verified: true,
        optionsVerified: false,
        note: 'Java 只判非空、原样透传；语言名取值待联调确认',
      },
      {
        key: 'voice',
        label: '配音音色',
        type: 'voice',
        required: true,
        // 契约 voice → Java voiceModel + voiceKey（均必填）；选项取 GET /api/v1/voices/list 的 model / voiceKey
        javaKey: ['voiceModel', 'voiceKey'],
        verified: true,
        optionsVerified: false,
        note: '音色库 VoiceView.model → voiceModel 的对应关系与音色库是否已有数据待联调确认',
      },
      {
        key: 'addSubtitle',
        label: '添加字幕',
        type: 'switch',
        required: false,
        default: false,
        javaKey: 'addSubtitle',
        verified: true,
      },
      {
        key: 'eraseOriginalSubtitle',
        label: '擦除原字幕',
        type: 'switch',
        required: false,
        default: false,
        javaKey: 'eraseOriginalSubtitle',
        verified: true,
      },
    ],
    submit: {
      label: '开始翻译',
      costUnit: '秒',
      costSource: 'features/biz-points.videoTranslate（生成；擦原字幕时再加 erase）',
    },
    actions: ['试听'],
  },
]

export function findToolSchema(homeId: string): ToolSchema | undefined {
  return toolSchemas.find((s) => s.homeId === homeId)
}

/** 字段是否在当前表单值下显示（并参与提交） */
export function isFieldVisible(field: ToolField, values: Record<string, unknown>): boolean {
  return !field.showWhen || values[field.showWhen.key] === field.showWhen.equals
}

/** 界面值 → Java 取值；返回 undefined 表示不传该键 */
export function toJavaValue(field: ToolField, value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined
  if (field.transform === 'lower' && typeof value === 'string') return value.toLowerCase()
  if (field.transform === 'omit-auto' && value === '自适应') return undefined
  return value
}
