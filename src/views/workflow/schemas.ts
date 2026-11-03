/**
 * 工作流页（/workflow?flow=&category=&template=）的 schema：契约里 14 个 `wf:*` 条目各一项。
 *
 * <p>界面字段（名称、上传槽位、字段、提交文案、costSource、actions）抄自 v1.0 后端包
 * `docs/api-contract.json` 的 `pages[schemaId=wf:*]`；请求体按 Java 现有路由的真实入参组装：
 * - `wf:N` 的 N 就是 v1 workflow_id，与 Java `afv_compat_workflow_template` 的 id / title / title_zh
 *   一一对应（V1.0.149 预置标题、V1.0.170 对齐编号），所以模板映射没有歧义；
 * - fashion → `POST /api/v1/workflows/fashion`（v1 ImageRequest：title、content、imageUrls、resolution、
 *   aspectRatio 必填，num 1–9）。content 用模板 payload.prompt（Java：「生成用的是端侧已替换好的 content」），
 *   从 `GET /api/v1/workflows/templates/fashion` 取；Java 按 title 精确匹配已启用模板，否则「未找到对应工作流」；
 * - visual → `POST /api/v1/workflows/visual`（v1 VisualRequest：title、imageUrl、prdImageUrls[{url,content}]、
 *   resolution、aspectRatio 必填，content 可空，num；SKU 替换组数 ≤4）；
 * - video → `POST /api/v1/workflows/video`（v1 VideoRequest：model、content≥5 字、ratio、视频档位 resolution 必填）。
 *   契约给视频条目的字段是图片那套（清晰度 1K/2K/4K、尺寸、张数），没有模型 / 脚本 / 视频档位，
 *   请求体拼不出来，按规则标 unmapped，界面显示「即将开放」，不猜。
 *
 * <p>`verified`：键名、映射、取值在 Java 代码里能逐字对上才是 true；false 的一律待联调确认（只记在这里）。
 * 历史分桶键 = 模板 title（GET /api/v1/workflows/{workflowTitle}/histories）。
 */
import type { UploadSpec } from '@/views/tools/schemas'

export type WorkflowFlow = 'fashion' | 'video' | 'visual'

export interface WorkflowUpload extends UploadSpec {
  slot: number
  /**
   * 落到 Java 请求体的哪个键：
   * - `imageUrls`：按槽位顺序拼成一个数组（模板 prompt 里的「图1、图2…」即此顺序）；
   * - `imageUrl`：单值（视觉复刻的参考图）；
   * - `prdImageUrls`：每张一项 `{url}`（视觉复刻的产品图）；
   * - `videoUrl`：单值（视频工作流，未开放）。
   */
  javaKey: 'imageUrls' | 'imageUrl' | 'prdImageUrls' | 'videoUrl'
  verified: boolean
  note?: string
  /**
   * 逐张备注（仅 `prdImageUrls`）：每张图一行文本，出网为 `prdImageUrls[i].content`
   * （Java CoreToolSubmissionRequest.ProductImage.content，@Size(max=300)，与顶层 content 不是同一个）；空的不传。
   */
  itemNote?: { label: string; maxLength: number }
}

export type WorkflowFieldType = 'select' | 'chips' | 'number' | 'textarea'

export interface WorkflowField {
  key: string
  label: string
  type: WorkflowFieldType
  required: boolean
  default?: string | number
  options?: string[]
  min?: number
  max?: number
  maxLength?: number
  javaKey: string
  /** lower = 转小写（1K → 1k）；x-count = 「x2」→ 2 */
  transform?: 'lower' | 'x-count'
  verified: boolean
  note?: string
}

export interface WorkflowSchema {
  schemaId: string
  /** v1 workflow_id（= wf:N 的 N） */
  workflowId: number
  name: string
  flow: WorkflowFlow
  /** 契约 / 原型 query 里的 category */
  category: string
  /** Java 模板 title：提交体 title + 历史分桶键 */
  templateTitle: string
  javaEndpoint: string
  status: 'mapped' | 'unmapped'
  unmappedReason?: string
  /**
   * 请求体里的 content 从哪来：
   * - template-prompt：模板 payload.prompt（服装，Java 必填）；
   * - field：表单字段（视觉复刻，可空）。
   */
  contentSource: 'template-prompt' | 'field'
  /** 固定附带的键（title 等） */
  fixedBody: Record<string, unknown>
  media: 'image' | 'video'
  uploads: WorkflowUpload[]
  fields: WorkflowField[]
  submit: { label: string; costUnit: string; costSource: string }
  actions: string[]
}

const IMG_ACCEPT = '.jpg,.jpeg,.png,.webp,.gif'
const IMG_MAX = 10 * 1024 * 1024
const VIDEO_ACCEPT = '.mp4,.mov,.webm'
const VIDEO_MAX = 500 * 1024 * 1024

const img = (
  slot: number,
  label: string,
  max: number,
  javaKey: WorkflowUpload['javaKey'],
  verified = true,
  note?: string,
) =>
  ({
    slot,
    label,
    kind: 'image',
    max,
    required: true,
    maxBytes: IMG_MAX,
    accept: IMG_ACCEPT,
    javaKey,
    verified,
    ...(note ? { note } : {}),
  }) satisfies WorkflowUpload

const video = (slot: number, label: string): WorkflowUpload => ({
  slot,
  label,
  kind: 'video',
  max: 1,
  required: true,
  maxBytes: VIDEO_MAX,
  accept: VIDEO_ACCEPT,
  minDuration: 2,
  maxDuration: 300,
  javaKey: 'videoUrl',
  verified: false,
})

const COST = { label: '开始生成', costUnit: '张', costSource: 'image-model-configs.points[目标分辨率] × 张数' }

// ---------------- 服装（fashion）：v1 ImageRequest ----------------

/**
 * 目标分辨率（契约叫「清晰度」）、画幅比例（契约叫「尺寸」）、生成张数（契约叫「张数」）：
 * 界面标签与工具页 / 视觉复刻统一，传值不变。
 * 分辨率：Java normalizeResolution 白名单 1k/2k/4k（CompatBatchCatalog.RESOLUTIONS）；v1 必填，故给默认 */
const fashionFields = (): WorkflowField[] => [
  {
    key: 'resolution',
    label: '目标分辨率',
    type: 'select',
    required: true,
    default: '2K',
    options: ['1K', '2K', '4K'],
    javaKey: 'resolution',
    transform: 'lower',
    verified: true,
  },
  {
    // 5 个比例都在 CompatBatchCatalog.ASPECT_RATIOS / GptImage2Spec 里；v1 必填
    key: 'aspectRatio',
    label: '画幅比例',
    type: 'select',
    required: true,
    default: '3:4',
    options: ['1:1', '3:4', '4:3', '9:16', '16:9'],
    javaKey: 'aspectRatio',
    verified: true,
  },
  {
    // 契约 count（x1–x4）→ Java num（@Min(1) @Max(9)，按 num 扇出成 N 条历史，直接乘进计费）
    key: 'count',
    label: '生成张数',
    type: 'select',
    required: true,
    default: 'x1',
    options: ['x1', 'x2', 'x3', 'x4'],
    javaKey: 'num',
    transform: 'x-count',
    verified: true,
  },
]

const fashion = (
  workflowId: number,
  name: string,
  templateTitle: string,
  uploads: WorkflowUpload[],
): WorkflowSchema => ({
  schemaId: `wf:${workflowId}`,
  workflowId,
  name,
  flow: 'fashion',
  category: 'model',
  templateTitle,
  javaEndpoint: '/api/v1/workflows/fashion',
  status: 'mapped',
  contentSource: 'template-prompt',
  fixedBody: { title: templateTitle },
  media: 'image',
  uploads,
  fields: fashionFields(),
  submit: COST,
  actions: [],
})

/** 服装图契约给 4 张，但模板 prompt 写的是「图1 = 服装、图2 = 模特」：多张会把后续图号整体后移 */
const GARMENT_NOTE = '契约 max=4 而模板 prompt 按「图1 服装、图2 模特」编号，多张服装时图号会后移，待联调确认'

// ---------------- 视觉复刻（visual）：v1 VisualRequest ----------------

const visualResolution = (): WorkflowField => ({
  key: 'resolution',
  label: '目标分辨率',
  type: 'chips',
  required: true,
  default: '2K',
  options: ['1K', '2K', '4K'],
  // CreaftV2Contract.VisualParams.RESOLUTIONS = 1k/2k/4k；v1 必填
  javaKey: 'resolution',
  transform: 'lower',
  verified: true,
})

const visualRatio = (): WorkflowField => ({
  key: 'aspectRatio',
  label: '画幅比例',
  type: 'chips',
  required: true,
  default: '3:4',
  // 10 个均在 CompatBatchCatalog.ASPECT_RATIOS（visualAspectRatio 校验）；v1 必填
  options: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
  javaKey: 'aspectRatio',
  verified: true,
})

// ---------------- 视频（video）：v1 VideoRequest，请求体拼不出 → unmapped ----------------

const VIDEO_REASON =
  'Java VideoRequest 必填 model、content（≥5 字）、ratio 与视频档位 resolution；契约只给了图片字段（清晰度 1K/2K/4K、尺寸、张数），缺模型与脚本，无法组装请求体'

const videoFlow = (
  workflowId: number,
  name: string,
  templateTitle: string,
  uploads: WorkflowUpload[],
): WorkflowSchema => ({
  schemaId: `wf:${workflowId}`,
  workflowId,
  name,
  flow: 'video',
  category: 'video',
  templateTitle,
  javaEndpoint: '/api/v1/workflows/video',
  status: 'unmapped',
  unmappedReason: VIDEO_REASON,
  contentSource: 'field',
  fixedBody: { title: templateTitle },
  media: 'video',
  uploads,
  fields: [],
  submit: COST,
  actions: [],
})

export const workflowSchemas: WorkflowSchema[] = [
  fashion(1, '模特替换', 'fashion-model-replace', [
    img(0, '底图', 1, 'imageUrls'),
    img(1, '目标模特图', 1, 'imageUrls'),
  ]),
  fashion(2, '模特换脸', 'fashion-model-face-swap', [
    img(0, '底图', 1, 'imageUrls'),
    img(1, '目标人脸图', 1, 'imageUrls'),
  ]),
  fashion(3, '背景替换', 'fashion-model-bg-replace', [
    img(0, '人物图', 1, 'imageUrls'),
    img(1, '背景图', 1, 'imageUrls'),
  ]),
  fashion(4, '模特换脸换背景', 'fashion-model-face-bg-replace', [
    img(0, '底图', 1, 'imageUrls'),
    img(1, '目标人脸图', 1, 'imageUrls'),
    img(2, '背景图', 1, 'imageUrls'),
  ]),
  fashion(5, '模特试穿', 'fashion-model-tryon', [
    img(0, '服装图', 4, 'imageUrls', false, GARMENT_NOTE),
    img(1, '模特图', 1, 'imageUrls'),
    img(2, '动作场景图', 1, 'imageUrls'),
  ]),
  fashion(8, '服装上身', 'fashion-model-cloth-fit', [
    img(0, '服装图', 4, 'imageUrls', false, GARMENT_NOTE),
    img(1, '模特图', 1, 'imageUrls'),
  ]),
  fashion(10, '双人换衣', 'fashion-model-due-tryon', [
    img(0, '服装图', 1, 'imageUrls'),
    img(1, '模特1', 1, 'imageUrls'),
    img(2, '模特2', 1, 'imageUrls'),
    img(3, '参考图', 1, 'imageUrls'),
  ]),
  fashion(11, '鞋子上脚', 'fashion-model-shoe-fit', [img(0, '鞋子', 1, 'imageUrls'), img(1, '模特图', 1, 'imageUrls')]),
  fashion(12, '配饰穿戴', 'fashion-model-accessory-fit', [
    img(0, '模特图', 1, 'imageUrls'),
    img(1, '配饰', 1, 'imageUrls'),
  ]),
  videoFlow(6, '模特带货', 'video-product-sell', [
    img(0, '模特图', 1, 'imageUrls', false),
    img(1, '商品图', 9, 'imageUrls', false),
    video(2, '参考视频'),
  ]),
  videoFlow(7, '商品替换', 'video-product-replace', [img(0, '商品图', 9, 'imageUrls', false), video(1, '参考视频')]),
  videoFlow(41, '口播带货', 'video-product-talk', [img(0, '产品图', 9, 'imageUrls', false)]),
  {
    schemaId: 'wf:13',
    workflowId: 13,
    name: '单图复制',
    flow: 'visual',
    category: 'visual-style-replace',
    templateTitle: 'visual-style-replace',
    javaEndpoint: '/api/v1/workflows/visual',
    status: 'mapped',
    contentSource: 'field',
    fixedBody: { title: 'visual-style-replace' },
    media: 'image',
    // 图1 = 参考图（imageUrl），产品图从图2 起（prdImageUrls），与 Java visualSources 同序
    uploads: [img(0, '参考图', 1, 'imageUrl'), img(1, '产品图', 3, 'prdImageUrls')],
    // 契约没有张数字段：不传 num（Java 默认 1；原型对单图复制也恒为 1）
    fields: [
      visualResolution(),
      visualRatio(),
      {
        key: 'prompt',
        label: '卖点描述',
        type: 'textarea',
        required: false,
        maxLength: 3000,
        javaKey: 'content',
        verified: true,
      },
    ],
    submit: COST,
    actions: [],
  },
  {
    schemaId: 'wf:14',
    workflowId: 14,
    name: 'SKU替换',
    flow: 'visual',
    category: 'visual-sku-replace',
    templateTitle: 'visual-sku-replace',
    javaEndpoint: '/api/v1/workflows/visual',
    status: 'mapped',
    contentSource: 'field',
    fixedBody: { title: 'visual-sku-replace' },
    media: 'image',
    // 每件产品单独出图：num × 产品数 个任务，一条组历史（Java isVisualSkuReplace）
    // 逐件「特殊需求」→ prdImageUrls[].content（≤300 字，Java ProductImage.content，CoreToolWorkflowSubmissionAdapter 逐件读取）
    uploads: [
      img(0, '参考图', 1, 'imageUrl'),
      { ...img(1, 'SKU产品图', 20, 'prdImageUrls'), itemNote: { label: '特殊需求', maxLength: 300 } },
    ],
    fields: [
      visualResolution(),
      visualRatio(),
      {
        // Java VISUAL_SKU_MAX_GROUPS = 4（「sku工作流组数不能超过4」）
        key: 'count',
        label: '生成张数',
        type: 'number',
        required: true,
        default: 1,
        min: 1,
        max: 4,
        javaKey: 'num',
        verified: true,
      },
      {
        key: 'prompt',
        label: '补充要求',
        type: 'textarea',
        required: false,
        maxLength: 3000,
        javaKey: 'content',
        verified: true,
      },
    ],
    submit: COST,
    actions: [],
  },
]

export const workflowFlowLabels: Record<WorkflowFlow, string> = {
  fashion: '服装工作流',
  video: '视频工作流',
  visual: '视觉复刻流',
}

/**
 * 按原型 query 找 schema：template 认中文名（也容忍英文 title）；没给 template 时取该 flow / category 的第一项。
 * flow 不认识返回 undefined。
 */
export function resolveWorkflowSchema(flow: string, category: string, template: string): WorkflowSchema | undefined {
  const sameFlow = workflowSchemas.filter((s) => s.flow === flow)
  if (!sameFlow.length) return undefined
  if (template) return sameFlow.find((s) => s.name === template || s.templateTitle === template)
  return sameFlow.find((s) => s.category === category) ?? sameFlow[0]
}

/** 工具目录等外部入口跳到某个工作流：与工作流页模板切换同一 query 形状（flow / category / template） */
export function workflowRouteOf(templateTitle: string): string | undefined {
  const s = workflowSchemas.find((x) => x.templateTitle === templateTitle)
  if (!s) return undefined
  const query = new URLSearchParams({ flow: s.flow, category: s.category, template: s.name })
  return `/workflow?${query.toString()}`
}

/** 界面值 → Java 取值；undefined 表示不传该键 */
export function toWorkflowJavaValue(field: WorkflowField, value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'string' && field.transform === 'lower') return value.toLowerCase()
  if (typeof value === 'string' && field.transform === 'x-count') return Number(value.replace(/^x/i, '')) || 1
  if (typeof value === 'string' && field.type === 'textarea') return value.trim() || undefined
  return value
}

/** 本次提交会产出几个任务（计费提示用） */
export function taskCountOf(
  schema: WorkflowSchema,
  values: Record<string, unknown>,
  uploads: Record<number, string[]>,
) {
  const numField = schema.fields.find((f) => f.javaKey === 'num')
  const num = numField ? Number(toWorkflowJavaValue(numField, values[numField.key])) || 1 : 1
  if (schema.templateTitle === 'visual-sku-replace') {
    const products = schema.uploads.find((u) => u.javaKey === 'prdImageUrls')
    return num * Math.max(products ? (uploads[products.slot]?.length ?? 0) : 0, 1)
  }
  return num
}
