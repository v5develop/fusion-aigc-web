/**
 * 工具箱各工具的页面 schema（/tools/:toolId 共用一个页面，按这里渲染）。
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

import { restoredInpaint, type InpaintBoxes } from './inpaint'

export type UploadKind = 'image' | 'video'

/**
 * 上传槽位的版式（只管长相，不影响上传 / 校验 / 请求体），对齐 s1.1「本次更新了什么」§1.1：
 * - `batch`：60×100 白边浮片格，5 列 × 4 行铺满 408×716，空态 / 满额卡都 434×742（高清放大 / 比例转换 / 商品精修 / 图片翻译）；
 * - `pipe`：产品替换底图，60×100 · 5 列 × 4 行 = 408×512，空态 4 个底图占位 + 1 个添加格；
 * - `single`：单图，空态只有 48 云影球，卡 434×742，球在卡正中（智能消除 / 智能抠图 / 文字替换；视频单槽同用）；
 * - `ml`：单角色参考图槽，60×100 叠片，片下不写说明、数量写在槽头（首屏主图 / 场景生成）；
 * - `material`：一叠片就是入口，片下两行说明（名称 11/15·500、数量 10/15），无数字角标（产品替换素材、单图复刻 / SKU 替换）；
 * - `video`：新版原型视频高清的上传卡：卡片撑满操作栏余高、1px 描边圆角 6，文案靠上居中（大字 / 说明 / 格式行 / 「资产添加」），
 *   没有云影球；用了这个版式的工具页，底部设置行与提交按钮也换成同一原型的样子（见 index.vue 的 compact）。
 */
export type UploadLayout = 'batch' | 'pipe' | 'single' | 'ml' | 'material' | 'video'

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
  javaKey:
    | 'imageUrl'
    | 'imageUrls'
    | 'originalImageUrl'
    | 'productImageUrl'
    | 'referenceImageUrl'
    | 'clothImageUrl'
    | 'modelImageUrl'
    | 'videoUrl'
    /** 局部重绘：地址不单独出网，随框选区域合成 `images[{url, bbox}]`（见 inpaint.ts），不按张拆分 */
    | 'images'
  verified: boolean
  /**
   * 只在当前视频模型支持这种生成方式时开放（video-model-configs 的 supportedModes：v2v 参考视频 / i2v 参考图）；
   * 不支持时槽位换成一行说明、已传的素材清空、不进请求体。supportedModes 为空 = 全部支持。
   */
  needsMode?: 'v2v' | 'i2v'
  /** s1.1 上传态版式（纯展示）；不写按 kind / max 推断：视频或单张 = single，多张 = batch */
  layout?: UploadLayout
  /** 空态大字（纯展示，原型给了才写；不写 = 「点击上传图片 / 视频」） */
  title?: string
  /** 空态大字下的一行说明（纯展示，原型给了才写） */
  subtitle?: string
  /** 空态格式行（纯展示，原型给了才写；不写 = 按 accept / maxBytes / 时长拼出来）；校验仍按 accept / maxBytes / 时长 */
  hint?: string
}

/** 上传槽位组件（ToolUploadSlot）只看的那几项；工作流页（views/workflow）复用同一个组件 */
export type UploadSpec = Pick<
  ToolUpload,
  | 'label'
  | 'kind'
  | 'max'
  | 'required'
  | 'maxBytes'
  | 'accept'
  | 'minDuration'
  | 'maxDuration'
  | 'title'
  | 'subtitle'
  | 'hint'
>

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
  | 'inpaint-region'

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
  /** 文本最少字数（按字符计，去首尾空白）；视频生成 content min_length=5 */
  minLength?: number
  /** 输入框占位（原型给了才写；不写 = 「请输入{label}」） */
  placeholder?: string
  /** 字段下方的一行辅助说明（原型 typo-assist，如输入润色） */
  description?: string
  /**
   * 选项由服务端下发（GET /api/v1/features/video-model-configs），不写死在 schema：
   * 模型 → 该模型的清晰度 → 该清晰度的比例；时长取该模型的 duration:[min,max] 逐秒。
   * 换模型后不再合法的取值由页面自动落到第一档。
   */
  dynamic?: 'videoModel' | 'videoResolution' | 'videoRatio' | 'videoDuration'
  /** 只在某个 mode 取值下显示并提交（比例转换的预设 / 自定义尺寸） */
  showWhen?: { key: string; equals: string }
  /** Java 请求体里的键；`voice` 一个界面字段落两个键 */
  javaKey: string | string[]
  /** 取值变换，见 toJavaValue */
  transform?: 'lower' | 'omit-auto' | 'int'
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
  /**
   * 历史从哪条接口取（不写 = 工具历史）：`workflow` = 提交打工作流路由（如 /workflows/video + constants.title），
   * 历史按 title 分桶：GET / DELETE /api/v1/workflows/{historyTitle}/histories，由 useToolHistory 换成工具历史的形状
   */
  historyKind?: 'workflow'
  /** true = 同步接口（抠图）：成功直接返回 {url} */
  sync?: boolean
  title: string
  description: string
  /** 功能介绍面板里的使用步骤（没有 scenarios 时显示） */
  steps: string[]
  /** 功能介绍面板的一句话介绍（原型 intro 原文；不写 = 用 description） */
  intro?: string
  /** 功能介绍面板的「适用场景」（原型给了才写，写了就替代 steps） */
  scenarios?: string[]
  /** 提交按钮上方的一行提示（原型 ToolSubmitBar hint 原文） */
  hint?: string
  /** 提交按钮文案覆盖（不写 = submit.label；图片生成「立即生成」） */
  submitLabel?: string
  /** 结果对比：false = 不出对比；{ index, label } = 与第 index 个上传槽的原图对比，label 为原图一侧的名称 */
  compare?: false | { index: number; label: string }
  /** 显示「默认校色」开关与校色面板（商拍换装 / 姿态复刻） */
  colorFix?: boolean
  /** AI 帮写的 bizType（后端 CompatPromptWriteService.BIZ_TYPES）；不写 = 不出帮写入口 */
  helpBizType?: string
  /** 多张上传时逐张各提交一次（即使 javaKey 是数组键，每次只带一张） */
  perItemSubmit?: boolean
  /** 结果卡标题（原型给了才写；不写 = 「生成结果」） */
  resultTitle?: string
  media: UploadKind
  uploads: ToolUpload[]
  fields: ToolField[]
  /**
   * 提交按钮文案；countLabel = 逐张提交的槽位有图时按任务数写成「{label}（N 张）」（原型商拍换装「开始换装（2 张）」，纯展示）
   */
  submit: { label: string; costUnit: string; costSource: string; countLabel?: boolean }
  /**
   * 上传区改由专用素材板承载（纯展示，槽位 / javaKey / 校验不变）：
   * `tryon` = 商拍换装（ToolTryonMaterials：服装图弹窗选单品 + 角度格，模特图叠片），slot 0 服装图、slot 1 模特图
   */
  uploadsView?: 'tryon'
  /**
   * 预计消耗取哪张价目表（不写 = 按 costSource 读 biz-points）：
   * - `image-model-configs`：GET /api/v1/features/image-model-configs（图片生成路由自己的价目）size[目标分辨率].points × 张数；
   * - `video-model-configs`：GET /api/v1/features/video-model-configs 当前模型 size[清晰度].points（每秒）× 时长。
   */
  price?: 'image-model-configs' | 'video-model-configs'
  /** 每次提交都带上的固定键（界面不出现），如姿态复刻固定 mode=reference */
  constants?: Record<string, unknown>
  /** 提示词框显示「我的提示词」入口与提示词库浮层（生成类工具：图片生成 / 视频生成 / 场景生成 / 首屏主图） */
  promptLibrary?: boolean
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
/** 比例转换预设：Java CompatBatchCatalog.ASPECT_RATIOS 全部 13 档（含竖向 9:21 / 1:3），已去掉「自适应」 */
const CONVERT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '1:3', '3:1', '9:16', '16:9', '21:9', '9:21']
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
    intro: '一键提升商品质感、清晰度与光影层次，适合商品主图、详情页素材与活动图优化。',
    scenarios: ['商品细节不够清晰的素材优化', '电商主图与详情页图片质感提升', '活动物料与投放素材的精修处理'],
    hint: '按上传张数逐张提交，一张图一个任务',
    media: 'image',
    uploads: [{ ...imageSlot('图片', 20, 'imageUrl'), layout: 'batch' }],
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
    intro: 'AI 智能提升图片的分辨率与细节表现，上传原图后选择清晰度即可获得放大后的高清版本。',
    scenarios: ['电商主图清晰度升级', '印刷物料高清输出', '老照片放大修复', '社交媒体高清分享'],
    hint: '按上传张数逐张提交，整批使用同一档清晰度',
    media: 'image',
    uploads: [{ ...imageSlot('图片', 20, 'imageUrl'), layout: 'batch' }],
    // v1 AIImageUpscalerRequest.resolution 必填，故给默认值
    fields: [{ ...resolutionField('清晰度', '1K'), required: true }],
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
    intro: '涂抹选中区域后去除水印、杂物与多余元素，自动补全背景，让画面更干净自然。',
    scenarios: ['商品图上的水印 / logo 去除', '画面里多余杂物的清理', '路人 / 反光等瑕疵的修补'],
    hint: '涂红的区域会被抹掉，结果回到下方历史记录',
    media: 'image',
    uploads: [
      {
        ...imageSlot('原图', 1, 'originalImageUrl'),
        layout: 'single',
        title: '上传要消除内容的图片',
        subtitle: '上传后在图上涂抹要抹掉的区域',
      },
    ],
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
    homeId: 'ai-inpaint',
    schemaId: 'tool:ai-inpaint',
    apiTool: 'ai-inpaint',
    // 契约 AIInpaintRequest：content 必填（≥1 字）、images 1–2 项（每项 url + bbox 恰好 4 个 0–1 比例点）、num 1–9。
    // 没有原型，也不在首页注册表里：版式沿用工具页三栏，框选见 InpaintRegionPicker.vue
    javaRoute: '/api/v1/tools/ai-inpaint',
    historyTitle: 'ai-inpaint',
    title: '局部重绘',
    description: '在图上框出要改的区域并描述想要的内容，只重画框内部分，框外画面保持不变。',
    steps: ['上传 1–2 张原图', '在每张图上拖出要重绘的区域', '描述框内要出现的内容', '选择张数，点击「开始重绘」'],
    intro: '在图上框出要改的区域并描述想要的内容，只重画框内部分，框外画面保持不变。',
    scenarios: ['替换画面里的局部物件', '给空白处补上新元素', '修掉瑕疵并换成想要的内容'],
    hint: '结果按所选张数回到下方历史记录',
    media: 'image',
    uploads: [
      {
        ...imageSlot('原图', 2, 'images'),
        layout: 'ml',
        title: '上传需要重绘的图片',
        subtitle: '上传后在图上框出要重绘的区域',
      },
    ],
    fields: [
      {
        key: 'region',
        label: '重绘区域',
        type: 'inpaint-region',
        required: true,
        // 出网键 images 由上传地址 + 框选区域合成（inpaint.ts）；顺序左上、右上、右下、左下，与 Java InpaintImage.bbox 一致
        javaKey: 'images',
        verified: true,
      },
      {
        key: 'prompt',
        label: '重绘内容',
        type: 'textarea',
        required: true,
        maxLength: 3000,
        placeholder: '描述框内要出现的内容，例如：换成一盆绿植，光线与周围一致',
        javaKey: 'content',
        verified: true,
      },
      countField(),
    ],
    // biz-points 没有 inpaint 键；Java 按原图尺寸落 GPT Image 2 档位报价（CompatV1PricingFactsResolver），前端拿不到单价
    submit: {
      label: '开始重绘',
      costUnit: '张',
      costSource: '未显示（价目接口未给该工具报价，按原图尺寸档位 × 张数）',
    },
    actions: [],
  },
  {
    homeId: 'ai-cutout',
    schemaId: 'tool:ai-cutout',
    apiTool: 'ai-cutout',
    javaRoute: '/api/v1/tools/cutout',
    historyTitle: 'cutout',
    sync: true,
    title: '智能抠图',
    description: '识别图片主体并去除背景，快速生成透明背景的商品图，适合电商展示与素材制作。',
    steps: ['上传 1 张原图', '点击「开始抠图」，通常数十秒内出结果', '下载透明背景图或放大查看'],
    resultTitle: '抠图结果',
    intro: '识别图片主体并去除背景，快速生成透明背景的商品图，适合电商展示与素材制作。',
    scenarios: ['电商商品图去背景', '透明底素材制作', '海报 / 拼图的主体提取'],
    hint: '通常当场出图，处理较久时转入下方历史记录',
    media: 'image',
    uploads: [
      {
        ...imageSlot('原图', 1, 'imageUrl'),
        layout: 'single',
        title: '上传需要抠图的图片',
        subtitle: '识别主体并去除背景，输出透明底',
      },
    ],
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
    intro: '自动识别图片中的文字并翻译回填，按原版式替换为目标语言，一键产出本地化素材。',
    scenarios: ['跨境电商商品图本地化', '活动海报多语言版本', '海外社媒素材翻译', '多语言市场投放'],
    hint: '按上传张数逐张提交，整批译成同一种语言',
    media: 'image',
    uploads: [{ ...imageSlot('图片', 20, 'imageUrl'), layout: 'batch' }],
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
    intro: '识别图片中的文字内容，把原文替换为目标文字，版式与整体设计保持不变。',
    scenarios: ['商品图上的价格 / 卖点改字', '海报文案的多版本快速产出', '素材本地化的定点改写'],
    hint: '识别后改写至少一处文案才能提交',
    media: 'image',
    uploads: [
      {
        ...imageSlot('原图', 1, 'imageUrl'),
        layout: 'single',
        title: '上传要改字的图片',
        subtitle: '识别出文字区域后逐条改写',
      },
    ],
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
    steps: ['上传 1–20 张图片', '选择预设比例，或填写自定义输出尺寸', '点击「开始转换」，每张图单独生成一条记录'],
    intro: '批量上传后选择目标比例，AI 结合画面内容智能调整构图与排版，尽量避免生硬拉伸。',
    scenarios: ['电商主图多平台适配', '社媒封面统一尺寸', '信息流广告素材', '多平台内容分发'],
    hint: '按上传张数逐张提交，一张图一个任务',
    perItemSubmit: true,
    media: 'image',
    uploads: [{ ...imageSlot('图片', 20, 'imageUrls'), layout: 'batch' }],
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
        options: CONVERT_RATIOS,
        showWhen: { key: 'mode', equals: '预设比例' },
        javaKey: 'aspectRatio',
        verified: true,
        optionsVerified: true,
      },
      {
        key: 'width',
        label: '输出宽度（像素）',
        placeholder: '宽',
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
        placeholder: '高',
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
    intro: '保留原有场景氛围与展示效果，把底图里的商品换成你上传的替换素材，适合同场景多款商品批量出图。',
    scenarios: ['同场景下多款商品的批量展示', '模特图和场景图的快速换品制作', '活动期间不同 SKU 的素材延展'],
    hint: '每张底图各出一个任务，整批共用同一张替换素材',
    media: 'image',
    uploads: [
      { ...imageSlot('底图', 20, 'originalImageUrl'), layout: 'pipe' },
      { ...imageSlot('替换素材', 1, 'productImageUrl', true, 1), layout: 'material' },
    ],
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
    intro: '基于卖点与参考图智能生成专业首屏主图，支持多语言输出。',
    scenarios: ['电商首屏主图的批量产出', '大促 / 上新的多语言主图', '同一卖点的多版本快速比稿'],
    hint: '一次提交出一个任务，结果按所选张数回到历史记录',
    media: 'image',
    uploads: [{ ...imageSlot('参考图（至少一张）', 9, 'imageUrls'), layout: 'ml' }],
    fields: [
      {
        key: 'prompt',
        label: '卖点描述',
        type: 'textarea',
        required: true,
        maxLength: 3000,
        placeholder: '写清主推卖点与想强调的信息，例如：柔软亲肤、A 类母婴标准、买一送一',
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
        default: false,
        description: '让模型先把卖点改写成更适合出图的描述',
        javaKey: 'rewritePrompt',
        verified: true,
      },
    ],
    submit: { label: '开始生成', costUnit: '次', costSource: 'image-model-configs.points[目标分辨率] × 张数' },
    promptLibrary: true,
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
    intro: '保持画面主体与构图关系，快速发散不同的颜色氛围与周围布景细节。',
    scenarios: ['商品主图的背景氛围替换', '同一主体的多套场景延展', '季节 / 大促主题的快速换景'],
    hint: '一次提交出一个任务，结果按所选张数回到历史记录',
    helpBizType: 'image-prompt',
    media: 'image',
    uploads: [
      {
        ...imageSlot('参考图（选填）', 1, 'imageUrl', false),
        layout: 'ml',
        title: '上传参考图',
        subtitle: '留空即完全按下方描述生成',
      },
    ],
    fields: [
      {
        key: 'prompt',
        label: '场景描述',
        type: 'textarea',
        required: true,
        maxLength: 3000,
        placeholder: '描述想要的场景氛围、布景与光影，例如：明亮的北欧风木质桌面，晨光斜射，浅景深',
        javaKey: 'content',
        verified: true,
      },
      resolutionField(),
      aspectRatioField(),
      countField(),
    ],
    submit: { label: '开始生成', costUnit: '次', costSource: 'image-model-configs.points[目标分辨率] × 张数' },
    promptLibrary: true,
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
    intro: '上传视频后选择目标分辨率，提升视频清晰度与细节表现，支持 720P 到 4K。',
    scenarios: ['老素材 / 低码率视频的画质提升', '投放前的成片规格升级', '拉伸放大前的清晰度补齐'],
    hint: '视频任务耗时较长，完成后回到下方历史记录',
    media: 'video',
    uploads: [
      {
        slot: 0,
        label: '视频',
        layout: 'video',
        title: '上传需要提升画质的视频',
        subtitle: '选择目标分辨率后提交',
        hint: '支持 MP4 / MOV / WEBM，单个不超过 500MB，时长 2～300 秒',
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
    intro: '上传视频后选择目标语言与音色，自动识别语音并翻译，生成配音视频。',
    scenarios: ['跨境电商视频广告本地化', '多语言课程视频制作', '社交媒体内容跨语言传播'],
    hint: '视频任务耗时较长，完成后回到下方历史记录',
    media: 'video',
    uploads: [
      {
        slot: 0,
        label: '视频',
        layout: 'video',
        title: '上传需要翻译的视频',
        subtitle: '识别语音并翻译为目标语言，用所选音色配音',
        hint: '支持 MP4 / MOV / WEBM，单个不超过 500MB，时长 2～300 秒',
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
        default: true,
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
  {
    homeId: 'cloth-wrinkle-removal',
    schemaId: 'tool:cloth-wrinkle-removal',
    apiTool: 'cloth-wrinkle-removal',
    // 契约 AIClothingDewrinkleRequest：只有 image_url（必填），按张逐张提交
    javaRoute: '/api/v1/tools/ai-clothing-dewrinkle',
    historyTitle: 'ai-clothing-dewrinkle',
    title: '服装去皱',
    description: '智能识别并抚平衣物上的褶皱和折痕，同时优化面料纹理质感，让服装展示效果更平整精致。',
    steps: ['上传 1–20 张服装图', '点击「开始去皱」，按上传张数逐张提交，一张图一个任务'],
    intro: '智能识别并抚平衣物上的褶皱和折痕，同时优化面料纹理质感，让服装展示效果更平整精致。',
    scenarios: [
      '平铺拍摄的衣服褶皱去除与优化',
      '模特上身图中衣物褶皱的自然抚平',
      '商品主图 / 详情页服装质感的快速优化',
    ],
    hint: '按上传张数逐张提交，一张图一个任务',
    media: 'image',
    uploads: [{ ...imageSlot('图片', 20, 'imageUrl'), layout: 'batch' }],
    fields: [],
    submit: { label: '开始去皱', costUnit: '张', costSource: '未显示（价目接口未给该工具报价）' },
    actions: [],
  },
  {
    homeId: 'ai-digital-model',
    schemaId: 'tool:ai-digital-model',
    apiTool: 'ai-digital-model',
    // 契约 AIModelTryonRequest：cloth_image_url + model_image_url 均必填；原型的单品 / 角度 / 面料 / 长度 / 袖长不在契约里，不提交
    javaRoute: '/api/v1/tools/ai-model-tryon',
    historyTitle: 'ai-model-tryon',
    title: '商拍换装',
    // 线上原型功能介绍原文（含「选出要替换的单品」：单品在服装图弹窗里选）
    description: '上传服装与模特，选出要替换的单品，AI 把衣服穿到模特身上；细节裁切与提示词由系统自动完成。',
    steps: ['上传 1 张服装图', '上传 1–9 张模特图', '点击「开始换装」，每位模特单独生成一条记录'],
    intro: '上传服装与模特，选出要替换的单品，AI 把衣服穿到模特身上；细节裁切与提示词由系统自动完成。',
    scenarios: ['同一套搭配换给多位模特', '一件衣服出多张上身图', '网店主图 / 详情页的试穿素材'],
    hint: '按模特逐个提交，每个任务单独出图',
    compare: { index: 1, label: '模特图' },
    colorFix: true,
    media: 'image',
    uploads: [
      { ...imageSlot('服装图', 1, 'clothImageUrl'), layout: 'material' },
      // 单值键多张 = 逐张提交：每位模特一个任务（原型「按模特逐个提交，每个任务单独出图」）
      { ...imageSlot('模特图', 9, 'modelImageUrl', true, 1), layout: 'material' },
    ],
    fields: [],
    // 服装图弹窗（单品 / 一套合影 / 角度格）只整理素材：写回 clothImageUrl 的是原型 clothUrl() 那一张
    uploadsView: 'tryon',
    submit: { label: '开始换装', costUnit: '张', costSource: '未显示（价目接口未给该工具报价）', countLabel: true },
    actions: [],
  },
  {
    homeId: 'ai-posture-fission',
    schemaId: 'tool:ai-posture-fission',
    apiTool: 'ai-posture-fission',
    // 契约 AIPostureFissionRequest：image_url 必填、mode 必填（fission/reference/imitation）；
    // 原型是「人物图 + 最多 9 张姿势图，每个姿势一个任务」= reference 模式，姿势图落 referenceImageUrl（reference 下必填）
    javaRoute: '/api/v1/tools/ai-posture-fission',
    historyTitle: 'ai-posture-fission',
    title: '姿态复刻',
    description: '上传一张人物图，再放最多 9 张姿势参考图；身份、服装、场景、光线都锁在人物图上，只换动作与神态表情。',
    steps: [
      '上传 1 张人物图',
      '上传 1–9 张姿势图',
      '（选填）写补充说明',
      '点击「开始复刻」，每个姿势一个任务，单独出图',
    ],
    intro: '上传一张人物图，再放最多 9 张姿势参考图；身份、服装、场景、光线都锁在人物图上，只换动作与神态表情。',
    scenarios: ['同一模特的一组姿态延展', '服装 / 配饰的多角度展示', '缺素材时的快速补拍替代'],
    hint: '每个姿势一个任务，单独出图',
    compare: { index: 1, label: '参考姿势图' },
    colorFix: true,
    media: 'image',
    constants: { mode: 'reference' },
    uploads: [
      { ...imageSlot('人物图', 1, 'imageUrl'), layout: 'material' },
      { ...imageSlot('姿势图', 9, 'referenceImageUrl', true, 1), layout: 'material' },
    ],
    fields: [
      {
        key: 'prompt',
        label: '补充说明',
        type: 'textarea',
        required: false,
        maxLength: 3000,
        placeholder: '这套姿势统一的补充要求，会加到每一张里，例如：动作幅度小一点、手里不要拿东西（选填）',
        // content 在 reference 模式下可空（只有 imitation 必填）
        javaKey: 'content',
        verified: true,
      },
      // 契约 resolution 默认 1k（只支持 1k/2k/4k）、aspect_ratio 默认 1:1；原型默认 3:4
      resolutionField(),
      { ...aspectRatioField(), default: '3:4' },
    ],
    submit: { label: '开始复刻', costUnit: '张', costSource: '未显示（价目接口未给该工具报价）' },
    actions: [],
  },
  {
    homeId: 'image-generate',
    schemaId: 'tool:image-generate',
    apiTool: 'image-generate',
    // 契约 AIImageGeneratorRequest：content / resolution / aspect_ratio 必填，image_urls 选填，num 1–9，rewrite_prompt 默认开
    javaRoute: '/api/v1/tools/ai-image-generator',
    historyTitle: 'ai-image-generator',
    title: '图片生成',
    description: '输入提示词并按需上传参考图，自定义清晰度、比例与出图数量，快速生成目标画面。',
    steps: ['（选填）上传 1–9 张参考图', '填写画面描述', '选择清晰度、比例与张数', '点击「开始生成」'],
    intro: '输入提示词并按需上传参考图，自定义清晰度、比例与出图数量，快速生成目标画面。',
    scenarios: ['无素材时的概念图快速产出', '同一描述的多版本比稿', '参考图风格延展'],
    hint: '不传参考图即纯文字生成；结果按所选张数回到历史记录',
    submitLabel: '立即生成',
    compare: false,
    helpBizType: 'image-prompt',
    media: 'image',
    uploads: [{ ...imageSlot('参考图（选填）', 9, 'imageUrls', false), layout: 'ml' }],
    fields: [
      {
        key: 'prompt',
        label: '画面描述',
        type: 'textarea',
        required: true,
        maxLength: 3000,
        placeholder: '描述想要的画面：主体、场景、风格、光影，例如：白瓷杯放在原木桌面，晨光斜射，极简北欧风',
        javaKey: 'content',
        verified: true,
      },
      { ...resolutionField(), required: true },
      { ...aspectRatioField(), required: true },
      countField(),
      {
        key: 'rewritePrompt',
        label: '输入润色',
        type: 'switch',
        required: false,
        default: true,
        description: '让模型先把描述改写得更适合出图',
        javaKey: 'rewritePrompt',
        verified: true,
      },
    ],
    price: 'image-model-configs',
    submit: { label: '开始生成', costUnit: '次', costSource: 'image-model-configs.points[目标分辨率] × 张数' },
    promptLibrary: true,
    actions: [],
  },
  {
    homeId: 'ai-video-generator',
    schemaId: 'tool:ai-video-generator',
    apiTool: 'ai-video-generator',
    // 契约 AIVideoGeneratorRequest：content（≥5 字）/ model / ratio / resolution 必填；duration 默认 4、generate_audio / rewrite_prompt 默认开；
    // video_url 与 image_urls 均选填。模型 / 清晰度 / 比例 / 时长取 /features/video-model-configs，提交时三者由后端联合校验
    javaRoute: '/api/v1/tools/ai-video-generator',
    historyTitle: 'ai-video-generator',
    title: '视频生成',
    description: '输入提示词后按需上传参考视频与多张参考图，快速生成短视频内容。',
    steps: ['（选填）上传参考视频与参考图', '填写画面描述', '选择模型、清晰度、比例与时长', '点击「开始生成」'],
    intro: '输入提示词后按需上传参考视频与多张参考图，快速生成短视频内容。',
    scenarios: ['商品短视频的快速成片', '静态素材转动态展示', '创意脚本的画面试拍'],
    hint: '参考视频与参考图都选填；视频任务耗时较长，完成后回到下方历史记录',
    media: 'video',
    uploads: [
      {
        slot: 0,
        label: '参考视频（选填）',
        layout: 'single',
        title: '上传参考视频',
        subtitle: '以这段视频为基础生成新视频',
        kind: 'video',
        max: 1,
        required: false,
        maxBytes: VIDEO_MAX,
        accept: VIDEO_ACCEPT,
        javaKey: 'videoUrl',
        verified: true,
        needsMode: 'v2v',
      },
      { ...imageSlot('参考图（选填）', 9, 'imageUrls', false, 1), layout: 'ml', needsMode: 'i2v' },
    ],
    fields: [
      {
        key: 'prompt',
        label: '画面描述',
        type: 'textarea',
        required: true,
        minLength: 5,
        // 视频规格的 prompt 上限（Java CompatV1InputChecks.VIDEO_CONTENT_MAX_CHARS）
        maxLength: 5000,
        placeholder: '描述想生成的视频：主体是谁、在做什么、镜头如何运动、整体氛围如何',
        javaKey: 'content',
        verified: true,
      },
      {
        key: 'model',
        label: '模型',
        type: 'select',
        required: true,
        dynamic: 'videoModel',
        javaKey: 'model',
        verified: true,
        optionsVerified: true,
      },
      {
        key: 'resolution',
        label: '清晰度',
        type: 'chips',
        required: true,
        dynamic: 'videoResolution',
        javaKey: 'resolution',
        transform: 'lower',
        verified: true,
        optionsVerified: true,
      },
      {
        key: 'aspectRatio',
        label: '画幅比例',
        type: 'chips',
        required: true,
        dynamic: 'videoRatio',
        // 视频侧是 ratio，不是 aspectRatio（CoreToolSubmissionRequest.ratio）
        javaKey: 'ratio',
        verified: true,
        optionsVerified: true,
      },
      {
        key: 'duration',
        label: '时长',
        type: 'select',
        required: true,
        dynamic: 'videoDuration',
        javaKey: 'duration',
        transform: 'int',
        verified: true,
        optionsVerified: true,
      },
      {
        key: 'generateAudio',
        label: '生成音频',
        type: 'switch',
        required: false,
        default: true,
        javaKey: 'generateAudio',
        verified: true,
      },
      {
        key: 'rewritePrompt',
        label: '输入润色',
        type: 'switch',
        required: false,
        default: true,
        description: '让模型先把描述改写得更适合出片',
        javaKey: 'rewritePrompt',
        verified: true,
      },
    ],
    price: 'video-model-configs',
    submit: { label: '开始生成', costUnit: '秒', costSource: 'video-model-configs.points[模型][清晰度] × 秒' },
    promptLibrary: true,
    actions: [],
  },
  {
    homeId: 'ai-video-clone',
    schemaId: 'tool:ai-video-clone',
    apiTool: 'ai-video-clone',
    // 复用视频工作流 POST /api/v1/workflows/video（title=video-clone，Java VIDEO_CLONE_TITLE）：原片必填（受理面拒缺片）、
    // 参考图选填 ≤9、content ≥5 字；模型 / 清晰度 / 比例 / 时长与视频生成同源（video-model-configs）。
    // 原型的「解析十一维 → 标保持 / 替换」依赖独立解析服务，后端没有，这一版只做原片 + 参考图 + 描述直接出片。
    javaRoute: '/api/v1/workflows/video',
    historyTitle: 'video-clone',
    historyKind: 'workflow',
    constants: { title: 'video-clone' },
    title: '视频复刻',
    description: '上传一条现成的短视频，配上参考图，写清改成什么样，选好模型与清晰度，直接生成新视频。',
    steps: [
      '上传 1 段原片（2–300 秒，≤500M）',
      '（选填）上传参考图',
      '写清改成什么样',
      '选择模型、清晰度、比例与时长',
      '点击「开始生成」',
    ],
    intro: '上传一条现成的短视频，配上参考图，写清改成什么样，选好模型与清晰度，直接生成新视频。',
    scenarios: ['换装片逐套换衣服', '同一条片子换人换场景', '保留原动作与运镜的二次创作'],
    hint: '视频任务耗时较长，完成后回到下方历史记录',
    media: 'video',
    uploads: [
      {
        slot: 0,
        label: '原片',
        layout: 'single',
        title: '把视频拖进来，或点这里选',
        hint: 'MP4 / MOV / WEBM · 15–30 秒最准 · 单个不超过 500MB',
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
      { ...imageSlot('参考图', 9, 'imageUrls', false, 1), layout: 'ml', hint: '最多 9 张' },
    ],
    fields: [
      {
        key: 'prompt',
        label: '画面描述',
        type: 'textarea',
        required: true,
        minLength: 5,
        // 视频路由的 content 上限（Java CompatV1InputChecks.VIDEO_CONTENT_MAX_CHARS）
        maxLength: 5000,
        placeholder: '改成什么样：一句话写清',
        javaKey: 'content',
        verified: true,
      },
      {
        key: 'model',
        label: '模型',
        type: 'select',
        required: true,
        dynamic: 'videoModel',
        javaKey: 'model',
        verified: true,
        optionsVerified: true,
      },
      {
        key: 'resolution',
        label: '清晰度',
        type: 'chips',
        required: true,
        dynamic: 'videoResolution',
        javaKey: 'resolution',
        transform: 'lower',
        verified: true,
        optionsVerified: true,
      },
      {
        key: 'aspectRatio',
        label: '画幅比例',
        type: 'chips',
        required: true,
        dynamic: 'videoRatio',
        javaKey: 'ratio',
        verified: true,
        optionsVerified: true,
      },
      {
        key: 'duration',
        label: '时长',
        type: 'select',
        required: true,
        dynamic: 'videoDuration',
        javaKey: 'duration',
        transform: 'int',
        verified: true,
        optionsVerified: true,
      },
    ],
    // 不写 price：video-model-configs 报的是 /tools/ai-video-generator 的价目，/workflows/video 走自己的价目表，
    // 拿前者的数字当预计消耗会不准，所以只写「按秒计费」（与工作流页视频流同口径）
    submit: { label: '开始生成', costUnit: '秒', costSource: 'workflows/video 按模型、清晰度与时长计费' },
    actions: [],
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
  if (field.transform === 'int') {
    const n = Number(value)
    return Number.isFinite(n) ? Math.round(n) : undefined
  }
  return value
}

// ---------------- 「重新编辑」：原始提交体 → 表单（toJavaValue 的反方向） ----------------

/** 非空字符串，否则 undefined */
export function restoredText(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined
}

/** 地址：只认 http(s)（与资产选择同一口径），否则 undefined */
export function restoredUrl(v: unknown): string | undefined {
  return typeof v === 'string' && /^https?:\/\//i.test(v) ? v : undefined
}

export function restoredUrls(v: unknown): string[] {
  return Array.isArray(v) ? v.map(restoredUrl).filter((u): u is string => !!u) : []
}

/** 出网值对回界面选项：原样或忽略大小写（1k → 1K、1080p → 1080P）；对不上返回 undefined */
export function restoredOption(options: readonly string[] | undefined, v: unknown): string | undefined {
  if (typeof v !== 'string' && typeof v !== 'number') return undefined
  const s = String(v)
  return options?.find((o) => o === s) ?? options?.find((o) => o.toLowerCase() === s.toLowerCase())
}

export function restoredNumber(v: unknown, min?: number, max?: number): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Math.round(v)))
}

/** 文字替换的一条（与 CoreToolSubmissionRequest.TextInfo 同形，pos 恰好 4 个像素点） */
export interface RestoredTextInfo {
  targetText: string
  text: string
  rect: { angle: number; height: number; left: number; top: number; width: number; pos: { x: number; y: number }[] }
}

export interface ToolFormRestore {
  uploads: Record<number, string[]>
  values: Record<string, unknown>
  /** 文字替换的识别结果；不是这个工具或没有可用条目时为 undefined */
  regions?: RestoredTextInfo[]
  /** 配音音色的两个出网键，页面按音色库对回 voiceId */
  voice?: { voiceModel: string; voiceKey: string }
  /** 有涂抹蒙版字段：蒙版是画布笔迹，回填不了，需要用户重新涂抹 */
  needsMask: boolean
  /** 局部重绘各图的框选区域（按地址）；不是这个工具时为 undefined */
  inpaint?: InpaintBoxes
}

const finite = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

function restoredTextInfo(v: unknown): RestoredTextInfo[] {
  if (!Array.isArray(v)) return []
  const out: RestoredTextInfo[] = []
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue
    const { targetText, text, textRectangles: r } = raw as Record<string, unknown>
    if (typeof targetText !== 'string' || typeof text !== 'string' || !r || typeof r !== 'object') continue
    const rect = r as Record<string, unknown>
    const pos = Array.isArray(rect.pos) ? rect.pos : []
    // Java 要求恰好 4 点，少了就不是原来那块区域：这一条不回填
    if (pos.length !== 4 || !pos.every((p) => p && typeof p === 'object')) continue
    out.push({
      targetText,
      text,
      rect: {
        angle: finite(rect.angle),
        height: finite(rect.height),
        left: finite(rect.left),
        top: finite(rect.top),
        width: finite(rect.width),
        pos: pos.map((p) => {
          const point = p as Record<string, unknown>
          return { x: finite(point.x), y: finite(point.y) }
        }),
      },
    })
  }
  return out
}

/**
 * 原始提交体（服务端存的 CoreToolSubmissionRequest）→ 本页表单：键与 buildBodies / fieldEntries 出网时一一对应。
 * 认不出的键、类型不对的值、对不上选项的取值一律忽略（字段保持默认值）；不做任何上传，地址原样放进槽位。
 */
export function restoreToolForm(s: ToolSchema, params: Record<string, unknown>): ToolFormRestore {
  const uploads: Record<number, string[]> = {}
  const inpaint = s.fields.some((f) => f.type === 'inpaint-region') ? restoredInpaint(params.images) : undefined
  for (const u of s.uploads) {
    const urls =
      u.javaKey === 'images'
        ? (inpaint?.urls ?? [])
        : u.javaKey === 'imageUrls'
          ? restoredUrls(params.imageUrls)
          : [restoredUrl(params[u.javaKey])]
    uploads[u.slot] = urls.filter((x): x is string => !!x).slice(0, u.max)
  }

  const values: Record<string, unknown> = {}
  // 只用于界面分支的字段（比例转换「尺寸方式」）：哪个取值下的字段在提交体里有值，就是当时选的那个
  for (const f of s.fields) {
    if (!f.uiOnly) continue
    const hit = f.options?.find((opt) =>
      s.fields.some(
        (g) =>
          g.showWhen?.key === f.key &&
          g.showWhen.equals === opt &&
          typeof g.javaKey === 'string' &&
          params[g.javaKey] !== undefined &&
          params[g.javaKey] !== null,
      ),
    )
    if (hit) values[f.key] = hit
  }
  const visible = (f: ToolField) => !f.showWhen || values[f.showWhen.key] === f.showWhen.equals

  let regions: RestoredTextInfo[] | undefined
  let voice: ToolFormRestore['voice']
  for (const f of s.fields) {
    if (f.uiOnly || f.type === 'mask' || f.type === 'inpaint-region') continue
    if (f.type === 'region-list') {
      const list = restoredTextInfo(params.textInformation)
      if (list.length) regions = list
      continue
    }
    if (f.type === 'voice') {
      const voiceModel = restoredText(params.voiceModel)
      const voiceKey = restoredText(params.voiceKey)
      if (voiceModel && voiceKey) voice = { voiceModel, voiceKey }
      continue
    }
    if (typeof f.javaKey !== 'string') continue
    const raw = params[f.javaKey]
    let value: unknown
    if (f.dynamic) {
      // 服务端下发的选项：原样放回（数字转成选项用的字符串），对不上当前模型的由页面落到第一档
      if (typeof raw === 'string' || typeof raw === 'number') value = String(raw)
    } else if (raw === undefined || raw === null) {
      // 「自适应」出网时不传 aspectRatio：当时那一档可见、提交体里又没有这个键，就是选了自适应
      if (f.transform === 'omit-auto' && f.options?.includes('自适应') && visible(f)) value = '自适应'
    } else if (f.type === 'chips' || f.type === 'select') value = restoredOption(f.options, raw)
    else if (f.type === 'stepper' || f.type === 'number') value = restoredNumber(raw, f.min, f.max)
    else if (f.type === 'switch') value = typeof raw === 'boolean' ? raw : undefined
    else if (f.type === 'textarea')
      value = typeof raw === 'string' ? raw.slice(0, f.maxLength ?? raw.length) : undefined
    if (value !== undefined) values[f.key] = value
  }

  return {
    uploads,
    values,
    regions,
    voice,
    needsMask: s.fields.some((f) => f.type === 'mask'),
    inpaint: inpaint?.boxes,
  }
}
