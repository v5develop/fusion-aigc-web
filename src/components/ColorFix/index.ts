/**
 * 结果图校色套件（页面无关，2026-11-09）。模型出图常有偏色，任何展示生成图片的结果区都可以三步接入：
 *
 * 1. 状态：在结果组件里
 *    ```ts
 *    const cf = useResultColorFix({
 *      key: computed(() => task.value?.taskUid),        // 持久化键（localStorage `colorfix:<key>`）
 *      src: computed(() => selectedImageUrl.value),      // 当前结果图；视频 / 无图传 ''
 *      maskUrl: computed(() => task.value?.maskUrl),    // 可选：现成蒙版 = 「自动识别 · 服装」结果
 *      maskParts: computed(() => task.value?.maskParts), // 可选：逐件蒙版（mask_url 是它们的合并），也用来探测部位支持
 *    })
 *    ```
 * 2. 舞台：结果图改用 `cf.displaySrc` + `:style="cf.previewStyle"`，并给 `<img>` 加
 *    `:crossorigin="corsAttr(src)" @error="markCorsBlocked(src)"`（utils/colorfix，烘图要读像素）；
 *    右上角放 `<ColorFixPill :pressed="cf.panelOpen.value" @click="cf.open()" />`；
 *    想要「校色对比」档时在 `cf.compareAvailable` 为真时渲染
 *    `<ColorFixCompare :before="src" :after="cf.displaySrc.value" :after-filter="cf.liveFilter.value"
 *      @download-before="cf.downloadOriginal(name)" @download-after="cf.downloadBaked(name)" />`。
 * 3. 参数台：结果卡（`relative`）里放 `<ColorFixResultPanel :cf="cf" />`（参数 + 选区 + 涂抹弹窗）。
 *    下载用 `await cf.downloadBaked(name)`（false = 已退回原图，提示「校色效果未能写入」），
 *    存资产用 `await cf.bakeToFile(name)` 上传。
 *
 * 2026-11-11 增补：每层「更多调整」（白平衡 + HSL 分色，layers.ts adjust，add-only 不升 v）；智能选区加选框、查看方式
 * （叠加 / 黑白蒙版 / 仅选区 / 轮廓）、继续编辑（会话随蒙版存，selection-session.ts）、钢笔路径再编辑；全屏放大后局部高清；
 * 图层满 8 层给提示（LAYER_CAP_HINT）；图层列表改为 listbox + 独立工具条。
 *
 * 要点：
 * - 烘图一律无损 PNG、保留透明通道（抠图透明底）、只缩不放，导出长边 ≤ 4096（COLORFIX_EXPORT_MAX_SIDE）；
 * - 局部调色：选区 整图 / 自动识别（POST /api/v1/studio/masks，404 时自动隐藏）/ 手动涂抹（蒙版存 IndexedDB，
 *   过大只留内存），反选 + 边缘柔化；有选区时预览走画布小图，不挂 CSS filter；
 * - 远端保存可插拔：`saver: { load(key), save(key, params, region) }`，本机 localStorage 照写；
 * - 只想要原始的 v-model 面板：`ColorFixPanel`（不绑 v-model:region 时与商拍工作室现用版本一致）。
 *
 * 舞台 / 弹窗（同一家族，画面都是 ColorFixView）：
 * - 结果列表多张图：`provideColorFixHost({ save })` + 每张图 `<ColorFixItem>` + 列表上方 `<ColorFixStage :host>`；
 * - 单张图弹窗：`<ColorFixDialog v-model:show :src :color-key>`（底栏插槽拿 bakeFile 做引用 / 上传）。
 * - 全屏调色：`<ColorFixFullscreen :cf v-model:mode>`（大图缩放平移 + 对比分割线 + 右侧停靠参数台），
 *   入口调 `cf.openFullscreen()`；ColorFixView（舞台 / 弹窗）已内置入口按钮。状态与页面共用一份 cf。
 *
 * 无界面操作：`hasStoredColorFix` / `bakeStoredColorFix(key, src, opts)`（按存的参数烘图）/ `clearStoredColorFix`，
 * 状态机里用 `cf.clear()`。存资产版本：`saveColorFixVersion(assetId, cf, opts)`（按 参数 + 选区 去重，涂抹选区不去重）、
 * `saveColorFixToTaskAsset`（按任务号对上资产）。
 *
 * ⚠️ 免费档水印：校色的 src（烘图来源）必须是当前观看者有权下载的那张——与它平时「下载」同一个地址
 * （免费档是带水印的交付图），绝不能换成干净原件；烘出来的 PNG 会被下载 / 上传成资产版本。
 */
export { useResultColorFix, LAYER_CAP_HINT } from './useResultColorFix.ts'
export type { ResultColorFix, ResultColorFixOptions, ColorFixRemoteSaver } from './useResultColorFix.ts'
export { bakeForUpload, triggerDownload, withImageExt, withPngExt } from './files.ts'
export {
  hasStoredColorFix,
  bakeStoredColorFix,
  clearStoredColorFix,
  loadStoredLayers,
  storedColorFixFilter,
  type BakeStoredOptions,
} from './stored.ts'
export * from './layers.ts'
export {
  saveColorFixVersion,
  saveColorFixToTaskAsset,
  findTaskAsset,
  colorFixSignature,
  colorFixSignatureOf,
  colorFixSignatureOfVersion,
  colorFixLayersSignature,
  colorFixVersionParams,
  type SaveColorFixVersionOptions,
  type SaveColorFixVersionResult,
  type ColorFixTaskAssetResult,
} from './asset-version.ts'
export {
  provideColorFixHost,
  useColorFixHost,
  type ColorFixHost,
  type ColorFixHostEntry,
  type ColorFixHostOptions,
} from './host.ts'
export { default as ColorFixPill } from './ColorFixPill.vue'
export { default as ColorFixCompare } from './ColorFixCompare.vue'
export { default as ColorFixResultPanel } from './ColorFixResultPanel.vue'
export { default as ColorFixMaskPainter } from './ColorFixMaskPainter.vue'
export { default as ColorFixView } from './ColorFixView.vue'
export { default as ColorFixStage } from './ColorFixStage.vue'
export { default as ColorFixItem } from './ColorFixItem.vue'
export { default as ColorFixDialog } from './ColorFixDialog.vue'
export { default as ColorFixFullscreen } from './ColorFixFullscreen.vue'
export { default as ColorFixZoomView } from './ColorFixZoomView.vue'
export { default as ColorFixAdjustments } from './ColorFixAdjustments.vue'
export type { SelectionSession, SelectionDoc } from './selection-session.ts'
export { MASK_VIEW_LABELS, type MaskViewMode } from './selection-ops.ts'
export { default as ColorFixPanel } from '@/views/tools/ColorFixPanel.vue'
export {
  colorFixSegmentSupported,
  colorFixSegmentFailure,
  type ColorFixSegmentFailure,
  type ColorFixSegmentSuggestion,
  isSegmentStillComputing,
  colorFixGarmentParts,
  colorFixPresetFor,
  colorFixRequestParts,
  defaultColorFixSegmenter,
  noteColorFixGarmentParts,
  type ColorFixPresetPart,
  type ColorFixSegmenter,
} from './segment.ts'
export * from './types.ts'
export {
  corsAttr,
  markCorsBlocked,
  colorFixSanitize,
  COLORFIX_DEFAULT,
  COLORFIX_EXPORT_MAX_SIDE,
  type ColorFixParams,
} from '@/utils/colorfix.ts'
