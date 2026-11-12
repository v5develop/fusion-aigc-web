/**
 * 结果图校色的页面无关状态机（见 ./index.ts 顶部的接入说明）。
 *
 * <p>职责：校色图层（./layers.ts：整图底层 + 最多 7 个选区图层，各自 五参数 / 替换颜色 / 选区 / 反选 / 柔化 / 可见）按结果键
 * 持久化；图层或蒙版变化后停手烘真像素（自下而上逐层透过软蒙版合成）；导出（下载 / 存资产）按长边 ≤4096 只缩不放、
 * 无损 PNG、保留透明通道。
 *
 * <p>兼容：`params` / `region` 仍在，读写的是「当前选中的图层」——老的参数台（ColorFixPanel v-model）原样能用；
 * 只有底层（或底层全零 + 一个选区图层）时出图与旧版逐像素一致（同走 colorFixImage）。存储照写旧键
 * （`colorfix:` / `colorfix-region:`，见 layers.ts legacyOf），另写 `colorfix-layers:`；只认旧键的老代码照常工作。
 *
 * <p>预览：
 * <ul>
 *   <li>只有整图底层在起作用：烘好前原图挂 CSS filter（previewStyle），拖动跟手；</li>
 *   <li>有选区 / 多层 / 替换颜色：画布小图预览——停手 60ms 先烘长边 720 的小图，再 260ms 烘 1600 的预览图；
 *       新图出来前沿用上一张烘好的（同一张原图时）。</li>
 * </ul>
 * 选区图层的蒙版还没就绪（识别中 / 还没涂 / 识别失败）：预览先跳过这一层，导出拒绝（调用方退回原图）。
 *
 * <p>「校色开着」（active）= 可用 && 有图 && 有效（调过参数 / 本条存过参数）或参数台开着——与工具页 v1 语义一致：
 * 只点开参数台没动参数，不落存储，下次切回仍算没校色。
 *
 * <p>图层撤销 / 重做：结构操作（加 / 删 / 复制 / 排序 / 显隐 / 改名）各算一步，滑杆等连续调整停手 400ms 合成一步；
 * 只记图层本身，蒙版不进历史（删掉的图层撤销回来蒙版还在：蒙版要到「移除校色」才删）。没有持久化键时蒙版与选区会话
 * 存在 mask-store 的内存 LRU 里（作用域用本实例的临时键），同样撤销即回，卸载时清掉。
 *
 * <p>图层上限 8：添加 / 复制 / 从底层进入涂抹 / 智能选区在满额时不再静默失败——置 {@link LAYER_CAP_HINT} 到 capNotice（4s 后清），
 * 图层列表显示这句话。
 *
 * <p>更多调整（2026-11-11）：每层可选白平衡 + HSL 分色 + 色阶 + 曲线（layers.ts adjust），替换颜色之后、五参数之前生效
 * （顺序：替换颜色 → 白平衡 → HSL → 色阶 → 曲线 → 五参数）；有它时预览走画布。
 * 全屏放大到超过预览图分辨率时，{@link renderDetail} 只渲可视区域的原分辨率小块（utils/colorfix colorFixRenderCrop，Worker 里算）。
 *
 * <p>粘贴校色参数（{@link pasteLayers}，preset.ts）：整套替换为预设里能带走的图层（底层 + 自动识别层，自动识别层在这张图上重新识别），
 * 一步可撤销。
 *
 * <p>向下合并（{@link mergeDown}，2026-11-11）：像 Photoshop 栅格化——选中层与它下面那层合成一个像素层（layers.ts 像素层），内容 = 合并那一刻
 * 渲染到这两层为止的结果（原图分辨率、导出口径逐像素精算，Worker 里算），覆盖度 = 两层蒙版覆盖范围的并集（二值，理由见 utils/colorfix
 * colorFixMergeRender）；合并前后整张图逐像素相同。像素数据在 pixel-store.ts（和蒙版同生命周期，撤销历史里引用的钉住不淘汰）；
 * 合并整步可撤销（两层与它们的蒙版原样回来）。图太大 / 存不下就拒绝并提示。
 *
 * <p>拼合（{@link flatten}，2026-11-11）：另一条路——整套图层烘成一张新图存为资产新版本（保留可编辑性用「复制图层」，不想占本机存储用拼合）。
 * 宿主提供 `flattener`（如资产详情：把当前效果烘成新版本并设为当前版本）时可用；拼合成功、宿主切到新图后，
 * 图层清空为零参数的整图底层，从新图继续调（不会再套一遍默认校色）。宿主没提供时不出这个入口。
 */
import { computed, onBeforeUnmount, ref, shallowReactive, watch, type Ref } from 'vue'
import {
  ColorFixMaskLoadError,
  ColorFixMergeTooLargeError,
  colorFixMergeRender,
  COLORFIX_DEFAULT,
  COLORFIX_EXPORT_MAX_SIDE,
  COLORFIX_ZERO,
  colorFixDataUrlToBlob,
  colorFixDominantColor,
  colorFixFilter,
  colorFixRenderCrop,
  type ColorFixCropResult,
  colorFixRenderLayers,
  colorFixSanitize,
  colorFixEquals,
  colorFixIsZero,
  loadColorFix,
  saveColorFix,
  type ColorFixParams,
  type ColorFixRenderLayer,
} from '@/utils/colorfix.ts'
import { downloadImage } from '@/utils/download'
import {
  COLORFIX_GARMENT_PARTS,
  COLORFIX_REGION_DEFAULT,
  colorFixPartsEqual,
  colorFixPartsSanitize,
  type ColorFixAutoTarget,
  type ColorFixGarmentPart,
  type ColorFixRegion,
  type ColorFixRegionMode,
} from './types.ts'
import {
  colorFixGarmentParts,
  colorFixPresetFor,
  colorFixRequestParts,
  colorFixSegmentFailure,
  colorFixSegmentSupported,
  defaultColorFixSegmenter,
  noteColorFixGarmentParts,
  type ColorFixPresetPart,
  type ColorFixMaskSource,
  type ColorFixSegmenter,
  type ColorFixSegmentSuggestion,
} from './segment.ts'
import { clearPixelPins, deletePixel, loadPixel, savePixel, setPixelPins } from './pixel-store.ts'
import {
  copyPaintedMask,
  deletePaintedMask,
  deletePaintedMasksOf,
  deleteSelectionSession,
  legacySignature,
  loadSelectionSession,
  saveSelectionSession,
  loadLayers,
  loadPaintedMask,
  loadRegion,
  onPaintedMaskChange,
  saveLayers,
  saveRegion,
  savePaintedMask,
} from './mask-store.ts'
import {
  BASE_LAYER_ID,
  COLORFIX_LAYERS_MAX,
  adjustActive,
  autoLayerName,
  cloneAdjust,
  cloneLayers,
  isBaseLayer,
  isPixelLayer,
  isSelectionLayer,
  layerEffective,
  layerMaskScope,
  layersEqual,
  layersFromLegacy,
  legacyOf,
  makeBaseLayer,
  makePixelLayer,
  mergeDownBlocked,
  newLayerId,
  newPixelId,
  nextLayerIndex,
  nextPixelName,
  pixelScope,
  recolorActive,
  type ColorFixLayer,
  type ColorFixRecolor,
} from './layers.ts'
import { clearStoredColorFix } from './stored.ts'
import { pointSegmentBlocked } from './point-support.ts'
import { triggerDownload, withImageExt, withPngExt } from './files.ts'
import { packSession, unpackSession, type SelectionSession } from './selection-session.ts'
import { adjustSignature, type ColorFixAdjust } from '@/utils/colorfix-math.ts'
import type { ColorFixReference } from './references.ts'
import type { ColorFixAutoColor } from './auto-color.ts'

export { triggerDownload }

/** 图层满额时的提示 */
export const LAYER_CAP_HINT = `最多 ${COLORFIX_LAYERS_MAX} 层：可删除不用的图层，或「向下合并」两层后继续加`
/** 图层满额时的提示（宿主支持拼合时） */
export const LAYER_CAP_HINT_FLATTEN = `最多 ${COLORFIX_LAYERS_MAX} 层：可删除不用的图层、「向下合并」两层，或「拼合」成新版本后继续加`

/** 拼合时交给宿主的东西 */
export interface ColorFixFlattenContext {
  /** 校色底图（= cf.src） */
  sourceImage: string
  /** 拼合前的图层（存进版本参数备查） */
  layers: ColorFixLayer[]
  /** 按当前图层烘真图（长边 ≤ maxSide，默认 4096；无损 PNG） */
  bakeFile: (name?: string, maxSide?: number) => Promise<File>
}

let instanceSeq = 0

/** 远端保存（可选）：本机 localStorage 照写，另外停手 500ms 调 save；load 在切到这个键时调一次（本机没有时才采用） */
export interface ColorFixRemoteSaver {
  load?(key: string, ctx?: { hasLocal: boolean }): Promise<ColorFixParams | null> | ColorFixParams | null
  /** true = 本机已有存档时也问 load，返回值与本机不同就采纳（宿主自己管优先级，如商拍的 内存 → 待同步 → 服务端 → 本机） */
  authoritative?: boolean
  /** params / region 为折回旧形状的值（见 layers.ts legacyOf）；layers 为完整图层（新增参数，老实现可忽略） */
  save?(key: string, params: ColorFixParams, region: ColorFixRegion, layers?: ColorFixLayer[]): Promise<unknown> | void
  /** 宿主自己的防抖也立即发出去（引擎在页面关闭 / 切走 / 卸载、发完最后一次 save 后调） */
  flush?(): void
}

export interface ResultColorFixOptions {
  /** 持久化键（任务号 / 结果号）；空 = 不持久化（参数随会话） */
  key: Ref<string | undefined | null>
  /** 当前要校色的原图地址；空 = 没有可校色的图 */
  src: Ref<string | undefined | null>
  /**
   * 蒙版 / 像素存储的稳定标识（可选，如商拍任务号）：换图（私有 → 公有地址）后选区、像素层、撤销里引用的数据都不变。
   * 给了它之后，按旧作用域（图片地址）存过的手动蒙版在新作用域读不到时，会读一次旧的并搬过来（老数据照常还原）
   */
  scopeImage?: Ref<string | undefined | null>
  /** 现成的蒙版（如商拍任务的 mask_url）：作为 {@link maskTarget} 这个目标的「自动识别」结果，免一次识别请求 */
  maskUrl?: Ref<string | undefined | null>
  /** 当前图的来源标识（商拍任务号 / 画布 run + 候选下标）：自动识别时带上，私有签名地址靠它识别；素材库等不传 */
  maskSource?: Ref<ColorFixMaskSource | undefined | null>
  /** maskUrl 代表哪个识别目标，默认 garment */
  maskTarget?: ColorFixAutoTarget
  /**
   * 现成的逐件服装蒙版（如商拍任务的 mask_parts）：maskUrl 是它们的合并；空数组 = maskUrl 是全部服装。
   * 是数组（哪怕空）即说明服务端支持服装细分部位；undefined = 不知道（老网关）
   */
  maskParts?: Ref<ColorFixPresetPart[] | undefined | null>
  /**
   * 参考图（可选，如商拍换装的原服装图）：校色时以浮卡显示，供肉眼对色；带 part 的参考图同时是「单品」，
   * 参数台 / 图上点选可按单品切换图层（见 ./references.ts）。不传 / 空 = 不出浮卡
   */
  references?: Ref<ColorFixReference[] | undefined | null>
  /**
   * 参考图自动校色（可选，见 ./auto-color.ts）：宿主给了才出「自动校色」按钮（参考卡里），结果经 {@link applyPieceParams}
   * 灌进各单品图层当初值。不传 = 没有这个入口
   */
  autoColor?: ColorFixAutoColor
  /** 总开关（如只对图片结果开）；不传 = 开 */
  enabled?: Ref<boolean>
  /** 「恢复默认」/ 初始参数 */
  defaults?: ColorFixParams
  /** 没存过选区时的初始选区（如商拍有 mask_url 时传 { mode: 'auto', target: 'garment' }）；默认整图 */
  defaultRegion?: Partial<ColorFixRegion>
  /** 提供哪些选区方式；默认都给（自动识别在接口 404 / segmenter=null 时自动隐藏） */
  regionModes?: ColorFixRegionMode[]
  /**
   * 自动识别不可用（接口 404 / segmenter=null）且没有现成蒙版时的宿主兜底：返回蒙版地址就当作这层的识别结果，
   * 返回 ''/null 照常报「不支持自动识别」。不传 = 不兜底（其它页面行为不变）
   */
  unsupportedMask?: (target: ColorFixAutoTarget, parts: ColorFixGarmentPart[]) => string | null
  /** 自动识别函数；null = 不提供自动识别（有 maskUrl 时仍可用那一个目标） */
  segmenter?: ColorFixSegmenter | null
  /** 远端保存（可选） */
  saver?: ColorFixRemoteSaver
  /**
   * 拼合（可选）：把当前效果存成一张新图并让 src 切过去（如资产新版本），成功返回 true。
   * 不传 = 不提供拼合。见文件头。
   */
  flattener?: (ctx: ColorFixFlattenContext) => Promise<boolean>
}

const PREVIEW_SIDE = 1600
const QUICK_SIDE = 720
/** 自动识别等这么久还没出来：换成「首次识别较慢」的提示 */
const MASK_SLOW_MS = 15_000
/** 连续调整合成一步撤销的停手时间 */
const HISTORY_BURST_MS = 400
const HISTORY_MAX = 60

/** 一个选区图层的蒙版状态 */
interface LayerMaskState {
  auto: string
  paint: string
  point: string
  paintVolatile: boolean
  pointVolatile: boolean
  busy: boolean
  error: string
  retryable: boolean
  suggest: ColorFixSegmentSuggestion[]
  slow: boolean
}
const MASK_EMPTY: LayerMaskState = {
  auto: '',
  paint: '',
  point: '',
  paintVolatile: false,
  pointVolatile: false,
  busy: false,
  error: '',
  retryable: false,
  suggest: [],
  slow: false,
}

export function useResultColorFix(opts: ResultColorFixOptions) {
  const defaults = opts.defaults ?? COLORFIX_DEFAULT
  const regionDefault = (): ColorFixRegion => ({ ...COLORFIX_REGION_DEFAULT, ...opts.defaultRegion })
  const enabled = computed(() => opts.enabled?.value ?? true)
  const src = computed(() => (enabled.value && opts.src.value) || '')
  const key = computed(() => opts.key.value || '')
  /** 没有持久化键时蒙版作用域用的临时键（本实例唯一；蒙版只进内存） */
  const memKey = `~mem${(instanceSeq = (instanceSeq + 1) % 1e9)}${Math.floor(Math.random() * 1e6).toString(36)}`
  const scopeKey = computed(() => key.value || memKey)
  /**
   * 蒙版 / 像素在存储里的「原图标识」：宿主给了 `scopeImage`（如商拍的任务号）就用它——图片地址在入库后会从私有桶签名地址换成
   * 公有地址，不稳定的地址进键会让入库窗口里涂的选区 / 合并的像素层换地址后找不回；没给就是图片地址本身（去查询串，见 layers.ts）。
   */
  const scopeImg = computed(() => opts.scopeImage?.value || src.value)
  /** 当前蒙版只放内存（没有持久化键） */
  const memoryOnly = computed(() => !key.value)

  const initialLayers = () => layersFromLegacy(defaults, regionDefault())
  const firstSelected = (list: ColorFixLayer[]) => list.find((l) => !isBaseLayer(l))?.id ?? BASE_LAYER_ID

  const layers = ref<ColorFixLayer[]>(initialLayers())
  const selectedLayerId = ref<string>(firstSelected(layers.value))
  const selectedLayer = computed<ColorFixLayer>(
    () => layers.value.find((l) => l.id === selectedLayerId.value) ?? layers.value[0]!,
  )

  /** 本条是否校色过：参数台里动过参数 / 选区，或存储里有这条的参数 */
  const touched = ref(false)
  const panelOpen = ref(false)
  const painterOpen = ref(false)
  /** 点选弹窗（本机 SAM 分割） */
  const pointOpen = ref(false)
  /**
   * 全屏调色（ColorFixFullscreen）开着：参数台改由全屏层右侧停靠的那份渲染，宿主页面上浮着的那份（含涂抹 / 点选弹窗）
   * 让位，免得同一份状态出两套弹窗。状态与参数台共用，退出全屏编辑原样保留。
   */
  const fullscreen = ref(false)

  // ---------------- 图层编辑 ----------------

  function updateLayer(id: string, patch: Partial<ColorFixLayer>) {
    layers.value = layers.value.map((l) => (l.id === id ? { ...l, ...patch } : l))
  }

  /** 选区变了：自动名字跟着变（识别目标 / 部位） */
  function renameForRegion(l: ColorFixLayer, region: ColorFixRegion): string {
    if (!l.autoName || isBaseLayer(l)) return l.name
    if (region.mode === 'auto') return autoLayerName(region, 0)
    if (/^选区 \d+$/.test(l.name)) return l.name
    return autoLayerName(region, nextLayerIndex(layers.value.filter((x) => x.id !== l.id)))
  }

  /** 当前选中图层的五参数（兼容旧接口：读写都落到选中的那一层） */
  const params = computed<ColorFixParams>({
    get: () => selectedLayer.value.params,
    set: (p) => updateLayer(selectedLayer.value.id, { params: { ...p } }),
  })
  /** 当前选中图层的选区（底层恒为整图，写入忽略 mode） */
  const region = computed<ColorFixRegion>({
    get: () => selectedLayer.value.region,
    set: (r) => {
      const l = selectedLayer.value
      if (isBaseLayer(l)) return
      const next: ColorFixRegion = { ...r, mode: r.mode === 'whole' ? l.region.mode : r.mode }
      updateLayer(l.id, { region: next, name: renameForRegion(l, next) })
    },
  })
  /** 当前选中图层的「替换为目标颜色」；null = 关 */
  const recolor = computed<ColorFixRecolor | null>({
    get: () => selectedLayer.value.recolor,
    set: (r) => updateLayer(selectedLayer.value.id, { recolor: r ? { ...r } : null }),
  })
  /** 当前选中图层的「更多调整」（白平衡 + HSL 分色）；null = 没调过 */
  const adjust = computed<ColorFixAdjust | null>({
    get: () => selectedLayer.value.adjust ?? null,
    set: (a) => updateLayer(selectedLayer.value.id, { adjust: a ? cloneAdjust(a) : null }),
  })

  // ---------------- 选区与蒙版 ----------------

  const segmenter = opts.segmenter === undefined ? defaultColorFixSegmenter : opts.segmenter
  const maskTarget = opts.maskTarget ?? 'garment'
  const presetMask = computed(() => opts.maskUrl?.value || '')

  /** 当前能提供的自动识别目标（接口不可用时只剩 maskUrl 那一个） */
  const autoTargets = computed<ColorFixAutoTarget[]>(() =>
    segmenter && colorFixSegmentSupported.value
      ? ['garment', 'product', 'person', 'background']
      : presetMask.value
        ? [maskTarget]
        : [],
  )
  const presetParts = computed(() => opts.maskParts?.value ?? null)
  /** 参考图（浮卡 / 单品切换用） */
  const references = computed<ColorFixReference[]>(() => opts.references?.value ?? [])
  // 任务带 mask_parts 字段（哪怕空数组）= 新服务端，支持服装细分部位
  watch(
    () => Array.isArray(opts.maskParts?.value),
    (yes) => {
      if (yes && !colorFixGarmentParts.value.length) noteColorFixGarmentParts([...COLORFIX_GARMENT_PARTS])
    },
    { immediate: true },
  )
  /** 「自动识别 · 服装」可细分的部位；空 = 不出部位选择 */
  const garmentParts = computed(() =>
    autoTargets.value.includes('garment') && segmenter && colorFixSegmentSupported.value
      ? colorFixGarmentParts.value
      : [],
  )
  const regionModes = computed<ColorFixRegionMode[]>(() =>
    (opts.regionModes ?? ['whole', 'auto', 'paint', 'point']).filter(
      (m) => m !== 'auto' || autoTargets.value.length > 0,
    ),
  )

  /** 各选区图层的蒙版状态（按图层 id） */
  const masks = shallowReactive(new Map<string, LayerMaskState>())
  const maskOf = (id: string): LayerMaskState => masks.get(id) ?? MASK_EMPTY
  function patchMask(id: string, patch: Partial<LayerMaskState>) {
    masks.set(id, { ...maskOf(id), ...patch })
  }

  /** 某层当前生效的蒙版；底层 / 未就绪为 '' */
  function effectiveMaskOf(l: ColorFixLayer): string {
    if (!isSelectionLayer(l)) return ''
    const m = maskOf(l.id)
    if (l.region.mode === 'auto') return m.auto
    if (l.region.mode === 'paint') return m.paint
    if (l.region.mode === 'point') return m.point
    return ''
  }
  /** 某层当前生效的蒙版（未反选；底层 / 未就绪 / 没有这层 = ''）——单品命中检测用 */
  const layerMask = (id: string): string => {
    const l = layers.value.find((x) => x.id === id)
    return l ? effectiveMaskOf(l) : ''
  }
  /** 现成蒙版里能直接当作「服装 · parts」的那张（商拍任务的 mask_url / mask_parts）；没有 = '' */
  const presetMaskFor = (parts: readonly ColorFixGarmentPart[]): string =>
    colorFixPresetFor(colorFixRequestParts(maskTarget, [...parts]), presetMask.value, presetParts.value)
  const pendingOf = (l: ColorFixLayer) => (isPixelLayer(l) ? !pixelReady(l) : !isBaseLayer(l) && !effectiveMaskOf(l))

  // --- 像素层的数据（按 pid；复制图层共用同一份）：换图 / 换键就重读 ---

  interface PixelState {
    full: string
    preview: string
    /** loading = 正在从本机读；ok = 可用；missing = 本机没有（被淘汰 / 换了设备 / 这张图不是合并时的那张） */
    state: 'loading' | 'ok' | 'missing'
    /** 只在内存（太大 / 库不可用 / 没有持久化键），刷新后会丢 */
    volatile: boolean
  }
  const pixels = shallowReactive(new Map<string, PixelState>())
  const pixelOf = (l: ColorFixLayer): PixelState | undefined => (l.pixel ? pixels.get(l.pixel.pid) : undefined)
  function pixelReady(l: ColorFixLayer): boolean {
    return pixelOf(l)?.state === 'ok'
  }
  const pixelScopes = (pid: string) =>
    [pixelScope(scopeKey.value, scopeImg.value, pid, 'full'), pixelScope(scopeKey.value, scopeImg.value, pid, 'preview')] as const
  const pixelTickets = new Map<string, number>()
  async function loadPixelData(pid: string) {
    const my = (pixelTickets.get(pid) ?? 0) + 1
    pixelTickets.set(pid, my)
    const [fullScope, previewScope] = pixelScopes(pid)
    pixels.set(pid, { full: '', preview: '', state: 'loading', volatile: false })
    const [full, preview] = await Promise.all([loadPixel(fullScope), loadPixel(previewScope)])
    if (pixelTickets.get(pid) !== my) return
    pixels.set(pid, { full, preview: preview || full, state: full ? 'ok' : 'missing', volatile: false })
  }
  const pixelLoaded = new Map<string, string>()
  watch(
    () => [
      ...new Set(layers.value.filter((l) => isPixelLayer(l) && l.pixel).map((l) => l.pixel!.pid)),
    ].map((pid) => `${pid}|${scopeKey.value}|${scopeImg.value}`),
    (list) => {
      const alive = new Set<string>()
      for (const sig of list) {
        const pid = sig.slice(0, sig.indexOf('|'))
        alive.add(pid)
        if (pixelLoaded.get(pid) === sig) continue
        pixelLoaded.set(pid, sig)
        if (src.value) void loadPixelData(pid)
      }
      for (const pid of [...pixelLoaded.keys()]) {
        if (alive.has(pid)) continue
        pixelLoaded.delete(pid)
        pixelTickets.set(pid, (pixelTickets.get(pid) ?? 0) + 1)
        pixels.delete(pid)
      }
    },
    { immediate: true },
  )

  // --- 自动识别：每层一条，换目标 / 部位 / 图 / 重试就重来 ---

  interface SegCtl {
    ticket: number
    abort: AbortController | null
    slowTimer: ReturnType<typeof setTimeout> | null
    sig: string
  }
  const segCtls = new Map<string, SegCtl>()
  const retryTicks = shallowReactive(new Map<string, number>())

  function stopSeg(ctl: SegCtl) {
    ctl.abort?.abort()
    ctl.abort = null
    if (ctl.slowTimer) clearTimeout(ctl.slowTimer)
    ctl.slowTimer = null
  }

  async function runAuto(l: ColorFixLayer, ctl: SegCtl) {
    const my = ++ctl.ticket
    // 上一轮的 abort 推迟到这一轮登记之后：同一份识别（键没变，如部位数组换了引用）接着等，不从头重来
    const prevAbort = ctl.abort
    ctl.abort = null
    if (ctl.slowTimer) clearTimeout(ctl.slowTimer)
    ctl.slowTimer = null
    patchMask(l.id, { error: '', retryable: false, suggest: [], slow: false })
    const image = src.value
    if (l.region.mode !== 'auto' || !image) {
      prevAbort?.abort()
      patchMask(l.id, { busy: false })
      return
    }
    const target = l.region.target
    const parts = colorFixRequestParts(target, l.region.parts)
    const presetHit = target === maskTarget ? colorFixPresetFor(parts, presetMask.value, presetParts.value) : ''
    if (presetHit) {
      prevAbort?.abort()
      patchMask(l.id, { auto: presetHit, busy: false })
      return
    }
    patchMask(l.id, { auto: '' })
    if (!segmenter || !colorFixSegmentSupported.value) {
      // 宿主兜底（可选，如商拍「全部服装」退回整图）：给了蒙版就用它，不报「不支持自动识别」
      const fallback = opts.unsupportedMask?.(target, parts)
      if (fallback) {
        prevAbort?.abort()
        patchMask(l.id, { auto: fallback, busy: false })
        return
      }
      prevAbort?.abort()
      patchMask(l.id, { busy: false, error: '当前环境不支持自动识别，请改用手动涂抹' })
      return
    }
    patchMask(l.id, { busy: true })
    const abort = new AbortController()
    ctl.abort = abort
    ctl.slowTimer = setTimeout(() => {
      if (my === ctl.ticket) patchMask(l.id, { slow: true })
    }, MASK_SLOW_MS)
    try {
      const maskSource = opts.maskSource?.value ?? null
      const call = segmenter(image, target, parts, { signal: abort.signal, source: maskSource })
      prevAbort?.abort()
      const url = await call
      if (my === ctl.ticket) patchMask(l.id, { auto: url })
    } catch (err) {
      if (my === ctl.ticket && !abort.signal.aborted) {
        const f = colorFixSegmentFailure(err, target, opts.maskSource?.value)
        if (f)
          patchMask(l.id, {
            error: f.message,
            retryable: f.retryable && colorFixSegmentSupported.value,
            suggest: f.suggest ?? [],
          })
      }
    } finally {
      prevAbort?.abort()
      if (my === ctl.ticket) {
        if (ctl.slowTimer) clearTimeout(ctl.slowTimer)
        ctl.slowTimer = null
        if (ctl.abort === abort) ctl.abort = null
        patchMask(l.id, { busy: false, slow: false })
      }
    }
  }

  const autoSigs = computed(() =>
    layers.value
      .filter(isSelectionLayer)
      .map((l) => {
        const parts = l.region.mode === 'auto' ? colorFixRequestParts(l.region.target, l.region.parts).join(',') : ''
        const sig =
          l.region.mode === 'auto'
            ? `auto|${l.region.target}|${parts}|${src.value}|${presetMask.value}|${JSON.stringify(presetParts.value)}|${retryTicks.get(l.id) ?? 0}`
            : `off|${src.value}`
        return [l.id, sig] as const
      }),
  )
  watch(
    autoSigs,
    (list) => {
      const alive = new Set(list.map(([id]) => id))
      for (const [id, ctl] of segCtls) {
        if (alive.has(id)) continue
        ctl.ticket += 1
        stopSeg(ctl)
        segCtls.delete(id)
      }
      for (const [id, sig] of list) {
        let ctl = segCtls.get(id)
        if (ctl && ctl.sig === sig) continue
        if (!ctl) {
          ctl = { ticket: 0, abort: null, slowTimer: null, sig }
          segCtls.set(id, ctl)
        }
        ctl.sig = sig
        const l = layers.value.find((x) => x.id === id)
        if (l) void runAuto(l, ctl)
      }
    },
    { immediate: true },
  )

  // --- 手动蒙版（涂抹 / 点选）：每层两份作用域，换图 / 换键就重读 ---

  /** 读一个蒙版；给了 scopeImage 且新作用域里没有：读一次旧作用域（图片地址）并搬过来 */
  async function loadStoredMask(scope: string, id: string, mode: 'paint' | 'point'): Promise<string> {
    const url = await loadPaintedMask(scope)
    if (url || !opts.scopeImage?.value || !src.value) return url
    const old = layerMaskScope(scopeKey.value, src.value, id, mode)
    if (!old || old === scope) return ''
    const moved = await copyPaintedMask(old, scope, { memoryOnly: memoryOnly.value }).catch(() => null)
    return moved?.url ?? ''
  }
  const storeTickets = new Map<string, number>()
  async function loadStoredMasks(id: string) {
    const my = (storeTickets.get(id) ?? 0) + 1
    storeTickets.set(id, my)
    const paintScope = layerMaskScope(scopeKey.value, scopeImg.value, id, 'paint')
    const pointScope = layerMaskScope(scopeKey.value, scopeImg.value, id, 'point')
    patchMask(id, { paint: '', point: '', paintVolatile: false, pointVolatile: false })
    const [paint, point] = await Promise.all([
      paintScope ? loadStoredMask(paintScope, id, 'paint') : '',
      pointScope ? loadStoredMask(pointScope, id, 'point') : '',
    ])
    if (storeTickets.get(id) === my) patchMask(id, { paint, point })
  }
  const storeSigs = computed(() =>
    layers.value.filter(isSelectionLayer).map((l) => `${l.id}|${scopeKey.value}|${scopeImg.value}`),
  )
  const storeLoaded = new Map<string, string>()
  watch(
    storeSigs,
    (list) => {
      const alive = new Set<string>()
      for (const sig of list) {
        const id = sig.slice(0, sig.indexOf('|'))
        alive.add(id)
        if (storeLoaded.get(id) === sig) continue
        storeLoaded.set(id, sig)
        void loadStoredMasks(id)
      }
      for (const id of [...storeLoaded.keys()]) {
        if (alive.has(id)) continue
        storeLoaded.delete(id)
        storeTickets.set(id, (storeTickets.get(id) ?? 0) + 1)
        masks.delete(id)
      }
    },
    { immediate: true },
  )

  // 别处替换 / 删除 / 淘汰了同一作用域的蒙版（旧 objectURL 会被回收）：重新读一次，不清空现有值、不动 volatile 标记
  const stopMaskSync = onPaintedMaskChange((scope) => {
    for (const l of layers.value) {
      if (!isSelectionLayer(l)) continue
      for (const mode of ['paint', 'point'] as const) {
        if (scope !== layerMaskScope(scopeKey.value, scopeImg.value, l.id, mode)) continue
        const my = (storeTickets.get(l.id) ?? 0) + 1
        storeTickets.set(l.id, my)
        void loadPaintedMask(scope).then((url) => {
          if (storeTickets.get(l.id) === my) patchMask(l.id, { [mode]: url })
        })
      }
    }
  })
  onBeforeUnmount(() => {
    stopMaskSync()
    for (const ctl of segCtls.values()) {
      ctl.ticket += 1
      stopSeg(ctl)
    }
    // 没有持久化键：本实例的内存蒙版 / 会话 / 像素层随组件走
    void deletePaintedMasksOf(memKey, { memoryOnly: true })
    clearPixelPins(memKey)
  })

  // --- 选中图层的蒙版状态（参数台 / 全屏状态行沿用旧字段名） ---

  const selMask = computed(() => maskOf(selectedLayer.value.id))
  const selAuto = computed(() => selectedLayer.value.region.mode === 'auto' && !isBaseLayer(selectedLayer.value))
  const maskBusy = computed(() => selAuto.value && selMask.value.busy)
  const maskError = computed(() => (selAuto.value ? selMask.value.error : ''))
  /** 识别失败可以手动重试（超时 / 6001 服务不可用 / 太频繁等；4001 没识别到不给） */
  const maskRetryable = computed(() => selAuto.value && selMask.value.retryable)
  /** 识别失败时建议的替代方式（4001 没识别到：换人物 / 点选 / 手动涂抹） */
  const maskSuggest = computed(() => (selAuto.value ? selMask.value.suggest : []))
  /** 识别已等了 {@link MASK_SLOW_MS} 以上（首次识别慢，面板换成「约需 1 分钟」的提示） */
  const maskSlow = computed(() => selAuto.value && selMask.value.slow)
  const paintedMask = computed(() => selMask.value.paint)
  /** 涂抹蒙版只留在内存（太大 / IndexedDB 不可用），刷新后会丢 */
  const paintedVolatile = computed(() => selMask.value.paintVolatile)
  const pointMask = computed(() => selMask.value.point)
  const pointVolatile = computed(() => selMask.value.pointVolatile)
  /** 选中图层当前生效的蒙版地址；底层 / 蒙版未就绪为 ''（全屏「显示选区」用） */
  const effectiveMask = computed(() => effectiveMaskOf(selectedLayer.value))

  /** 识别失败后手动重试（选中图层） */
  function retryMask(layerId = selectedLayer.value.id) {
    const l = layers.value.find((x) => x.id === layerId)
    if (l && l.region.mode === 'auto' && !maskOf(l.id).busy) retryTicks.set(l.id, (retryTicks.get(l.id) ?? 0) + 1)
  }

  // ---------------- 图层操作 ----------------

  const canAddLayer = computed(() => layers.value.length < COLORFIX_LAYERS_MAX)

  /** 满额提示语（宿主支持拼合时多一句「拼合」） */
  const capHint = computed(() => (opts.flattener ? LAYER_CAP_HINT_FLATTEN : LAYER_CAP_HINT))
  /** 图层区的一行提示（满额被拒 / 复制粘贴 / 拼合结果，4s 后清空）；'' = 无 */
  const capNotice = ref('')
  let capTimer: ReturnType<typeof setTimeout> | null = null
  function noteLayers(text: string, ms = 4000) {
    capNotice.value = text
    if (capTimer) clearTimeout(capTimer)
    capTimer = setTimeout(() => {
      capNotice.value = ''
      capTimer = null
    }, ms)
  }
  function noteCap() {
    noteLayers(capHint.value)
  }

  // 像素层数据的引用：当前图层 + 撤销 / 重做历史里出现过的 pid。这些钉住不让库淘汰；
  // 同一次载入里从所有引用中消失的（撤销栈被新操作截断 / 超出 60 步）从本机删掉。换键 / 换图载入时只重置，不删（那是别的记录的数据）
  let refPids = new Set<string>()
  function referencedPids(): Set<string> {
    const set = new Set<string>()
    const add = (list: readonly ColorFixLayer[]) => {
      for (const l of list) if (l.pixel) set.add(l.pixel.pid)
    }
    add(layers.value)
    for (const s of past.value) add(s.layers)
    for (const s of future.value) add(s.layers)
    return set
  }
  function syncPixelRefs(reset = false) {
    const now = referencedPids()
    if (!reset) {
      for (const pid of refPids) {
        if (now.has(pid)) continue
        for (const scope of pixelScopes(pid)) void deletePixel(scope)
        pixelLoaded.delete(pid)
        pixels.delete(pid)
      }
    }
    refPids = now
    setPixelPins(
      memKey,
      [...now].flatMap((pid) => pixelScopes(pid)).filter(Boolean),
    )
  }
  watch([scopeKey, scopeImg], () => syncPixelRefs(), { flush: 'post' })

  // 撤销 / 重做（只记图层）
  type Snapshot = { layers: ColorFixLayer[]; selected: string }
  const past = ref<Snapshot[]>([])
  const future = ref<Snapshot[]>([])
  let committed = JSON.stringify(layers.value)
  let committedSnap: Snapshot = { layers: cloneLayers(layers.value), selected: selectedLayerId.value }
  let burstTimer: ReturnType<typeof setTimeout> | null = null
  /** 正在合成一步连续调整（撤销按钮据此可点） */
  const bursting = ref(false)
  const snapshot = (): Snapshot => ({ layers: cloneLayers(layers.value), selected: selectedLayerId.value })
  function markCommitted() {
    committed = JSON.stringify(layers.value)
    committedSnap = snapshot()
  }
  function flushBurst() {
    if (!burstTimer) return
    clearTimeout(burstTimer)
    burstTimer = null
    bursting.value = false
    markCommitted()
  }
  function pushPast(s: Snapshot) {
    past.value = [...past.value, s].slice(-HISTORY_MAX)
    future.value = []
    syncPixelRefs()
  }
  function resetHistory() {
    if (burstTimer) clearTimeout(burstTimer)
    burstTimer = null
    bursting.value = false
    past.value = []
    future.value = []
    markCommitted()
    syncPixelRefs(true)
  }
  /** 连续调整（watch 里调）：一段停手前的改动合成一步 */
  function noteEdit() {
    if (JSON.stringify(layers.value) === committed) return
    if (!burstTimer) pushPast(committedSnap)
    else clearTimeout(burstTimer)
    bursting.value = true
    burstTimer = setTimeout(() => {
      burstTimer = null
      bursting.value = false
      markCommitted()
    }, HISTORY_BURST_MS)
  }
  /** 结构操作：独立一步 */
  function structural(run: () => void) {
    flushBurst()
    const before = snapshot()
    run()
    if (JSON.stringify(layers.value) === committed) return
    pushPast(before)
    markCommitted()
  }
  function restore(s: Snapshot) {
    layers.value = cloneLayers(s.layers)
    selectedLayerId.value = layers.value.some((l) => l.id === s.selected) ? s.selected : BASE_LAYER_ID
    markCommitted()
    syncPixelRefs()
  }
  const canUndoLayers = computed(() => past.value.length > 0 || bursting.value)
  const canRedoLayers = computed(() => future.value.length > 0)
  function undoLayers() {
    flushBurst()
    const prev = past.value[past.value.length - 1]
    if (!prev) return
    past.value = past.value.slice(0, -1)
    future.value = [...future.value, snapshot()]
    restore(prev)
  }
  function redoLayers() {
    flushBurst()
    const next = future.value[future.value.length - 1]
    if (!next) return
    future.value = future.value.slice(0, -1)
    past.value = [...past.value, snapshot()]
    restore(next)
  }

  function selectLayer(id: string) {
    if (layers.value.some((l) => l.id === id)) selectedLayerId.value = id
  }

  /**
   * 新建选区图层（参数从零起调）并选中；超过上限返回 ''。mode = 点选 / 涂抹 时直接打开对应弹窗。
   */
  function addLayer(mode: 'auto' | 'point' | 'paint' = 'point', init: Partial<ColorFixRegion> = {}): string {
    if (!canAddLayer.value) {
      noteCap()
      return ''
    }
    const target = init.target ?? (autoTargets.value.includes('garment') ? 'garment' : autoTargets.value[0] ?? 'garment')
    const r: ColorFixRegion = { ...COLORFIX_REGION_DEFAULT, ...init, mode, target }
    const l: ColorFixLayer = {
      id: newLayerId(),
      name: autoLayerName(r, nextLayerIndex(layers.value)),
      autoName: true,
      visible: true,
      params: { ...COLORFIX_ZERO },
      region: r,
      recolor: null,
    }
    structural(() => {
      layers.value = [...layers.value, l]
      selectedLayerId.value = l.id
    })
    if (mode === 'point' && src.value && !pointSegmentBlocked.value) pointOpen.value = true
    if (mode === 'paint' && src.value) painterOpen.value = true
    return l.id
  }

  /**
   * 把一组单品的校色参数灌进它们的图层，**整件事一步可撤销**（参考图自动校色用，见 ./auto-color.ts）：
   * 每件单品 = 「自动识别 · 服装 · 这些部位」图层，已有就只换参数（识别、替换颜色、更多调整都留着），没有就新建（满 8 层的跳过并提示）；
   * 参数先夹到合法范围，不合法的丢掉。最后选中第一件灌进去的单品。
   * 求解是对**原图**解的：整图底层若有校色参数（如提交时开了「默认校色」），叠上去会重复校一遍，所以一并归零（同一步里，可撤销），
   * 返回 baseReset 让调用方告诉用户。返回 applied = 实际灌进去的 key。
   */
  function applyPieceParams(
    entries: ReadonlyArray<{ key: string; parts: readonly ColorFixGarmentPart[]; params: ColorFixParams }>,
  ): { applied: string[]; baseReset: boolean } {
    const applied: string[] = []
    let baseReset = false
    let capped = false
    let focus = ''
    structural(() => {
      let list = layers.value
      for (const e of entries) {
        const params = colorFixSanitize(e.params)
        const parts = colorFixPartsSanitize(e.parts)
        if (!params || !parts.length) continue
        const at = list.findIndex(
          (l) =>
            isSelectionLayer(l) &&
            l.region.mode === 'auto' &&
            l.region.target === 'garment' &&
            colorFixPartsEqual(colorFixPartsSanitize(l.region.parts), parts),
        )
        if (at >= 0) {
          const id = list[at]!.id
          list = list.map((l, i) => (i === at ? { ...l, params: { ...params }, visible: true } : l))
          focus ||= id
        } else if (list.length < COLORFIX_LAYERS_MAX) {
          const r: ColorFixRegion = { ...COLORFIX_REGION_DEFAULT, mode: 'auto', target: 'garment', parts }
          const l: ColorFixLayer = {
            id: newLayerId(),
            name: autoLayerName(r, nextLayerIndex(list)),
            autoName: true,
            visible: true,
            params: { ...params },
            region: r,
            recolor: null,
          }
          list = [...list, l]
          focus ||= l.id
        } else {
          capped = true
          continue
        }
        applied.push(e.key)
      }
      if (!applied.length) return
      list = list.map((l) => {
        if (!isBaseLayer(l) || isPixelLayer(l) || colorFixIsZero(l.params)) return l
        baseReset = true
        return { ...l, params: { ...COLORFIX_ZERO } }
      })
      layers.value = list
      if (focus) selectedLayerId.value = focus
    })
    if (capped) noteCap()
    return { applied, baseReset }
  }

  /** 复制图层（蒙版一并复制到新图层名下）；底层不能复制，超过上限返回 '' */
  function duplicateLayer(id: string): string {
    const at = layers.value.findIndex((l) => l.id === id)
    const from = layers.value[at]
    if (!from || isBaseLayer(from)) return ''
    if (!canAddLayer.value) {
      noteCap()
      return ''
    }
    const copy: ColorFixLayer = {
      ...cloneLayers([from])[0]!,
      id: newLayerId(),
      name: `${from.name} 副本`.slice(0, 24),
      autoName: false,
    }
    structural(() => {
      const list = [...layers.value]
      list.splice(at + 1, 0, copy)
      layers.value = list
      selectedLayerId.value = copy.id
    })
    // 像素层不可变：复制出来的图层直接引用同一份像素数据（pid 相同），没有蒙版要复制
    if (isPixelLayer(from)) return copy.id
    const k = scopeKey.value
    const memOnly = memoryOnly.value
    const image = src.value
    void (async () => {
      for (const mode of ['paint', 'point'] as const) {
        const fromScope = layerMaskScope(k, scopeImg.value, from.id, mode)
        const toScope = layerMaskScope(k, scopeImg.value, copy.id, mode)
        if (!fromScope || !toScope) continue
        const saved = await copyPaintedMask(fromScope, toScope, { memoryOnly: memOnly })
        if (saved && image === src.value && layers.value.some((l) => l.id === copy.id))
          patchMask(copy.id, { [mode]: saved.url, [`${mode}Volatile`]: !saved.persisted })
      }
    })()
    return copy.id
  }

  /**
   * 粘贴校色参数：整套替换为给定图层（第一层须是底层；调用方用 preset.ts presetLayersForPaste 准备好），一步可撤销。
   * 自动识别层会在这张图上重新识别；新图层没有蒙版历史。
   */
  function pasteLayers(next: readonly ColorFixLayer[]) {
    const list = cloneLayers(next).slice(0, COLORFIX_LAYERS_MAX)
    if (!list.length || !isBaseLayer(list[0]!)) return
    structural(() => {
      layers.value = list
      selectedLayerId.value = firstSelected(list)
    })
  }

  /** 删除选区图层（底层不能删）；蒙版留着，撤销回来还能用 */
  function removeLayer(id: string) {
    const at = layers.value.findIndex((l) => l.id === id)
    const l = layers.value[at]
    if (!l || isBaseLayer(l)) return
    structural(() => {
      const list = layers.value.filter((x) => x.id !== id)
      layers.value = list
      if (selectedLayerId.value === id) selectedLayerId.value = (list[at] ?? list[at - 1] ?? list[0]!).id
    })
  }

  /** 上移（delta = 1，往上叠 = 后合成）/ 下移（−1）；底层固定在最下 */
  function moveLayer(id: string, delta: number) {
    const list = [...layers.value]
    const at = list.findIndex((l) => l.id === id)
    const to = at + delta
    if (at <= 0 || to <= 0 || to >= list.length) return
    structural(() => {
      const [item] = list.splice(at, 1)
      list.splice(to, 0, item!)
      layers.value = list
    })
  }

  function setLayerVisible(id: string, visible: boolean) {
    structural(() => updateLayer(id, { visible }))
  }

  function renameLayer(id: string, name: string) {
    const n = name.trim().slice(0, 24)
    const l = layers.value.find((x) => x.id === id)
    if (!l || isBaseLayer(l)) return
    if (isPixelLayer(l)) {
      structural(() => updateLayer(id, { name: n || nextPixelName(layers.value.filter((x) => x.id !== id)), autoName: false }))
      return
    }
    structural(() => updateLayer(id, n ? { name: n, autoName: false } : { name: renameForRegion({ ...l, autoName: true }, l.region), autoName: true }))
  }

  function setLayerRecolor(id: string, r: ColorFixRecolor | null) {
    updateLayer(id, { recolor: r ? { ...r } : null })
  }

  /** 选中图层若是底层，就先新建一个指定方式的选区图层（旧入口「涂抹 / 点选」落在底层上时） */
  function ensureSelectionLayer(mode: 'point' | 'paint'): ColorFixLayer | null {
    const l = selectedLayer.value
    if (isSelectionLayer(l)) return l
    const id = addLayer(mode)
    return layers.value.find((x) => x.id === id) ?? null
  }

  // ---------------- 涂抹 / 点选的结果 ----------------

  async function applyMask(mode: 'paint' | 'point', blob: Blob, session?: Omit<SelectionSession, 'maskSize'> | null) {
    const l = ensureSelectionLayer(mode)
    if (!l) return
    const k = scopeKey.value
    const memOnly = memoryOnly.value
    const image = src.value
    const scope = layerMaskScope(k, scopeImg.value, l.id, mode)
    if (!scope) return
    const { url, persisted } = await savePaintedMask(scope, blob, { memoryOnly: memOnly })
    // 选区会话（继续编辑用）与蒙版同作用域、同生命周期；没给会话 = 删掉旧的（免得下次还原成过期的编辑状态）
    try {
      if (session) await saveSelectionSession(scope, packSession({ ...session, maskSize: blob.size }), { memoryOnly: memOnly })
      else await deleteSelectionSession(scope)
    } catch {
      /* 会话丢了只是下次从蒙版重新开始 */
    }
    if (image !== src.value || k !== scopeKey.value || !layers.value.some((x) => x.id === l.id)) return
    patchMask(l.id, mode === 'paint' ? { paint: url, paintVolatile: !persisted } : { point: url, pointVolatile: !persisted })
    const cur = layers.value.find((x) => x.id === l.id)!
    if (cur.region.mode !== mode) {
      const next = { ...cur.region, mode }
      updateLayer(l.id, { region: next, name: renameForRegion(cur, next) })
    }
    if (mode === 'paint') painterOpen.value = false
    else pointOpen.value = false
  }

  /** 手动涂抹完成：存蒙版（IndexedDB / 内存）并把选中图层切到「手动涂抹」；session = 智能选区的编辑状态（可选） */
  function applyPaintedMask(blob: Blob, session?: Omit<SelectionSession, 'maskSize'> | null) {
    return applyMask('paint', blob, session)
  }

  /** 点选完成：存蒙版并把选中图层切到「点选」 */
  function applyPointMask(blob: Blob, session?: Omit<SelectionSession, 'maskSize'> | null) {
    return applyMask('point', blob, session)
  }

  /**
   * 选中图层上次的智能选区会话（继续编辑）：蒙版还在、会话与蒙版对得上（字节数一致）、原图没换才返回；否则 null（从蒙版重新开始）。
   */
  async function loadSelectionSessionOf(mode: 'paint' | 'point'): Promise<SelectionSession | null> {
    const l = selectedLayer.value
    if (!isSelectionLayer(l) || !maskOf(l.id)[mode]) return null
    const scope = layerMaskScope(scopeKey.value, scopeImg.value, l.id, mode)
    if (!scope) return null
    const hit = await loadSelectionSession(scope).catch(() => null)
    if (!hit || hit.maskSize < 0) return null
    const session = await unpackSession(hit.blob)
    return session && session.maskSize === hit.maskSize ? session : null
  }

  async function clearPaintedMask() {
    const l = selectedLayer.value
    const scope = layerMaskScope(scopeKey.value, scopeImg.value, l.id, 'paint')
    patchMask(l.id, { paint: '' })
    if (scope) await deletePaintedMask(scope)
  }

  /** 打开涂抹（选中的是底层时先新建一个涂抹图层） */
  function openPainter() {
    if (!src.value) return
    if (!isSelectionLayer(selectedLayer.value)) addLayer('paint')
    else painterOpen.value = true
  }
  // 满额时 addLayer 自己会置 capNotice（不静默失败）

  /** 打开点选（浏览器不支持时不开；选中的是底层时先新建一个点选图层） */
  function openPointSelect() {
    if (!src.value || pointSegmentBlocked.value) return
    if (!isSelectionLayer(selectedLayer.value)) addLayer('point')
    else pointOpen.value = true
  }
  function setPointOpen(v: boolean) {
    pointOpen.value = v
  }

  // 原图换了（切记录 / 切候选）：点选 / 涂抹弹窗是对着旧图画的，直接关掉，免得把旧图的选区存到新图名下
  watch(src, (next, prev) => {
    if (next === prev) return
    painterOpen.value = false
    pointOpen.value = false
  })

  // ---------------- 持久化 ----------------

  let remoteTimer: ReturnType<typeof setTimeout> | null = null
  function persist() {
    const k = key.value
    if (!k || !touched.value) return
    const leg = legacyOf(layers.value)
    saveColorFix(k, leg.params)
    saveRegion(k, leg.region)
    saveLayers(k, layers.value, selectedLayerId.value, legacySignature(leg.params, leg.region))
    if (opts.saver?.save) {
      if (remoteTimer) clearTimeout(remoteTimer)
      const snap = cloneLayers(layers.value)
      remoteJob = () => void Promise.resolve(opts.saver?.save?.(k, leg.params, leg.region, snap)).catch(() => {})
      remoteTimer = setTimeout(() => {
        remoteTimer = null
        const job = remoteJob
        remoteJob = null
        job?.()
      }, 500)
    }
  }

  /** 防抖里还没发出去的远端保存立即发（页面关闭 / 切走 / 卸载），再让宿主 saver 把它自己的防抖也冲掉 */
  let remoteJob: (() => void) | null = null
  function flushRemote() {
    if (remoteTimer) clearTimeout(remoteTimer)
    remoteTimer = null
    const job = remoteJob
    remoteJob = null
    job?.()
    opts.saver?.flush?.()
  }
  // pagehide 无条件冲（Safari / bfcache 下它触发时 visibilityState 可能还是 visible）；visibilitychange 只在变 hidden 时冲
  function onPageHide() {
    flushRemote()
  }
  function onVisibility() {
    if (document.visibilityState === 'hidden') flushRemote()
  }
  if (opts.saver?.save && typeof window !== 'undefined') {
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibility)
  }

  let loading = false
  /** 拼合成功后、宿主切到新图之前置位：下一次换键时图层清空为零参数，参数台 / 全屏保持打开 */
  let flattenNext = false
  /** 拼合开始时的图 key：只有「从这张图换到它的新版本」才清图层，翻到别的资产时不认 */
  let flattenFromKey = ''
  /** 拼合途中翻到了别的资产（本次拼合不再改当前状态） */
  let flattenAbandoned = false
  let flattenTimer: ReturnType<typeof setTimeout> | null = null
  function loadFrom(list: ColorFixLayer[], selected?: string) {
    layers.value = list
    selectedLayerId.value = selected && list.some((l) => l.id === selected) ? selected : firstSelected(list)
    resetHistory()
  }
  watch(
    key,
    async (k, oldK) => {
      // 换键（切任务 / 切资产）：上一条防抖里还没发的远端保存立即发出去，不被新键的保存顶掉
      if (oldK !== undefined) flushRemote()
      loading = true
      if (flattenNext) {
        const fromFlattened = oldK === flattenFromKey
        flattenNext = false
        if (flattenTimer) clearTimeout(flattenTimer)
        flattenTimer = null
        if (fromFlattened) {
          loadFrom([makeBaseLayer(COLORFIX_ZERO)])
          touched.value = false
          painterOpen.value = false
          pointOpen.value = false
          loading = false
          return
        }
        // 拼合途中被翻到别的资产：不动它的图层，落到下面按它自己的存储状态常规加载
        flattenAbandoned = true
      }
      const stored = k ? loadColorFix(k) : null
      const storedRegion = k ? loadRegion(k) : null
      const stack = k && stored ? loadLayers(k, legacySignature(stored, storedRegion)) : null
      if (stack) loadFrom(stack.layers, stack.selected)
      else loadFrom(layersFromLegacy(stored ? { ...stored } : defaults, storedRegion ?? regionDefault()))
      touched.value = !!stored
      panelOpen.value = false
      painterOpen.value = false
      pointOpen.value = false
      fullscreen.value = false
      loading = false
      if (stored && k && opts.saver?.load && opts.saver.authoritative) {
        // 宿主说远端 / 它自己的存取顺序为准（如商拍：内存 → 待同步 → 服务端 → 本机）：本机有存档也问一次，与本机不同就采纳
        const remote = colorFixSanitize(await Promise.resolve(opts.saver.load(k, { hasLocal: true })).catch(() => null))
        if (remote && key.value === k && !panelOpen.value) {
          const leg = legacyOf(layers.value)
          const base = layers.value.find(isBaseLayer)
          const mine = leg.exact ? leg.params : (base?.params ?? leg.params)
          if (!colorFixEquals(remote, mine)) {
            loading = true
            // 只换五参数：能折回旧形状的整套换；多层时只换整图底层，选区图层留本机
            if (leg.exact) loadFrom(layersFromLegacy(remote, leg.region), selectedLayerId.value)
            else loadFrom(layers.value.map((l) => (isBaseLayer(l) ? { ...l, params: { ...remote } } : l)), selectedLayerId.value)
            touched.value = true
            const after = legacyOf(layers.value)
            saveColorFix(k, after.params)
            saveRegion(k, after.region)
            saveLayers(k, layers.value, selectedLayerId.value, legacySignature(after.params, after.region))
            loading = false
          }
        }
      }
      if (!stored && k && opts.saver?.load) {
        const remote = colorFixSanitize(await Promise.resolve(opts.saver.load(k, { hasLocal: false })).catch(() => null))
        if (remote && key.value === k && !touched.value) {
          loading = true
          loadFrom(layersFromLegacy(remote, storedRegion ?? regionDefault()))
          touched.value = true
          loading = false
          saveColorFix(k, remote)
        }
      }
    },
    { immediate: true },
  )

  // 参数台里调参 / 改选区 / 改图层：标记校色过、记撤销、落存储
  watch(
    layers,
    () => {
      if (loading) return
      noteEdit()
      if (!panelOpen.value) return
      touched.value = true
      persist()
    },
    { deep: true },
  )
  // 只换了选中的图层：记一下（刷新后回到同一层），不算校色过
  watch(selectedLayerId, () => {
    if (!loading && touched.value && key.value) persist()
  })

  function open() {
    if (src.value) panelOpen.value = true
  }

  /** 进入全屏调色（一并打开参数台：全屏里调参要落存储） */
  function openFullscreen() {
    if (!src.value) return
    panelOpen.value = true
    fullscreen.value = true
  }
  /** 退出全屏调色：参数台保持打开（回到页面上浮着的那份），编辑不丢 */
  function closeFullscreen() {
    fullscreen.value = false
  }
  // 没图了（切到视频 / 关闭弹窗）：全屏一并退出
  watch(src, (v) => {
    if (!v) fullscreen.value = false
  })

  /** 收起参数台：调过才落存储（只开了面板没动参数不落默认值） */
  function close() {
    panelOpen.value = false
    flushBurst()
    persist()
  }

  /** 选中图层的参数恢复默认：底层回 defaults，选区图层回零 */
  function resetParams() {
    if (isPixelLayer(selectedLayer.value)) return
    params.value = { ...(isBaseLayer(selectedLayer.value) ? defaults : COLORFIX_ZERO) }
  }

  /**
   * 移除这条的校色：删掉本机存的参数、选区、图层与所有涂抹蒙版，状态回到原图（参数台 / 涂抹弹窗一并收起，不落存储）。
   * 远端 saver 存过的不动（没有删除口），下次切回本机没有时仍会按 saver.load 还原。
   */
  async function clear() {
    const k = key.value
    if (remoteTimer) clearTimeout(remoteTimer)
    remoteTimer = null
    remoteJob = null
    loading = true
    panelOpen.value = false
    painterOpen.value = false
    fullscreen.value = false
    pointOpen.value = false
    loadFrom(initialLayers())
    touched.value = false
    for (const id of [...masks.keys()]) patchMask(id, { paint: '', point: '', paintVolatile: false, pointVolatile: false })
    loading = false
    if (k) await clearStoredColorFix(k)
    else await deletePaintedMasksOf(memKey, { memoryOnly: true })
  }

  // ---------------- 向下合并 ----------------

  const merging = ref(false)
  const MERGE_TOO_LARGE = '图片太大，无法合并'
  const mergeTooLargeText = () => (opts.flattener ? `${MERGE_TOO_LARGE}，可改用「拼合为新版本」` : MERGE_TOO_LARGE)

  /** index 这一层向下合并不可用的原因（'' = 可以） */
  function mergeBlockedAt(index: number): string {
    if (merging.value) return '正在合并…'
    if (flattening.value) return '正在拼合…'
    if (!src.value) return '没有可校色的图片'
    const why = mergeDownBlocked(layers.value, index)
    if (why) return why
    // 到上层为止所有生效的层都要就绪（选区蒙版 / 像素数据），否则合出来的内容不对
    if (layers.value.slice(0, index + 1).some((l) => layerEffective(l) && pendingOf(l))) return '有图层的选区还没就绪'
    return ''
  }
  /** 选中图层向下合并不可用的原因（'' = 可以）；工具条 / 菜单据此置灰并给提示 */
  const mergeDownBlockedReason = computed(() => mergeBlockedAt(layers.value.findIndex((l) => l.id === selectedLayerId.value)))
  const canMergeDown = computed(() => !mergeDownBlockedReason.value)
  const selectedIsPixel = computed(() => isPixelLayer(selectedLayer.value))
  const selectedPixelVolatile = computed(() => !!pixelOf(selectedLayer.value)?.volatile)

  /**
   * 向下合并（见文件头）：选中层与它下面那层栅格化成一个像素层，占下面那层的位置并选中；成功返回 true，失败 / 被拒图层保持不变。
   * 下面那层是整图底层时合并进底层——底层变成整幅的像素层（仍叫「整图」、固定在最下）。一步可撤销。
   */
  async function mergeDown(id = selectedLayerId.value): Promise<boolean> {
    const i = layers.value.findIndex((l) => l.id === id)
    const why = mergeBlockedAt(i)
    if (why) {
      noteLayers(why)
      return false
    }
    flushBurst()
    merging.value = true
    const image = src.value
    const k = scopeKey.value
    const memOnly = memoryOnly.value
    const used = cloneLayers(layers.value.slice(0, i + 1))
    const lower = used[i - 1]!
    const upper = used[i]!
    const changed = () => image !== src.value || k !== scopeKey.value || !layersEqual(layers.value.slice(0, i + 1), used)
    const saved: string[] = []
    const discard = () => {
      for (const scope of saved) void deletePixel(scope)
    }
    try {
      const list: ColorFixRenderLayer[] = []
      for (const l of used) {
        if (!layerEffective(l)) continue
        list.push({ ...renderLayerOf(l, effectiveMaskOf(l)), cover: l.id === lower.id || l.id === upper.id })
      }
      const out = await colorFixMergeRender(image, list)
      if (changed()) {
        noteLayers('合并期间图层有变化，已取消，请重试')
        return false
      }
      const pid = newPixelId()
      const fullScope = pixelScope(k, scopeImg.value, pid, 'full')
      const fs = await savePixel(fullScope, out.full, { memoryOnly: memOnly })
      if (!fs.ok) {
        noteLayers(mergeTooLargeText(), 6000)
        return false
      }
      saved.push(fullScope)
      let previewUrl = fs.url
      if (out.preview) {
        const previewScope = pixelScope(k, scopeImg.value, pid, 'preview')
        const ps = await savePixel(previewScope, out.preview, { memoryOnly: memOnly })
        if (!ps.ok) {
          discard()
          noteLayers(mergeTooLargeText(), 6000)
          return false
        }
        saved.push(previewScope)
        previewUrl = ps.url
      }
      if (changed()) {
        discard()
        noteLayers('合并期间图层有变化，已取消，请重试')
        return false
      }
      const merged = makePixelLayer(
        isBaseLayer(lower) ? BASE_LAYER_ID : newLayerId(),
        isBaseLayer(lower) ? '整图' : nextPixelName(layers.value),
        { w: out.width, h: out.height, pid },
      )
      pixels.set(pid, { full: fs.url, preview: previewUrl, state: 'ok', volatile: !fs.persisted })
      pixelLoaded.set(pid, `${pid}|${k}|${image}`)
      structural(() => {
        const next = [...layers.value]
        next.splice(i - 1, 2, merged)
        layers.value = next
        selectedLayerId.value = merged.id
      })
      noteLayers(
        !fs.persisted && !memOnly
          ? `已合并为「${merged.name}」（可撤销）；图片较大或本机存储不可用，这一层只在本次浏览中保留`
          : `已合并为「${merged.name}」，合并前后图像一致（可撤销）`,
        6000,
      )
      return true
    } catch (err) {
      discard()
      if (err instanceof ColorFixMergeTooLargeError) noteLayers(mergeTooLargeText(), 6000)
      else if (err instanceof ColorFixMaskLoadError) noteLayers(`${err.message}，合并已取消`)
      else noteLayers('合并失败，图层保持不变，请重试')
      return false
    } finally {
      merging.value = false
    }
  }

  // ---------------- 拼合 ----------------

  const flattening = ref(false)
  /** 拼合不可用的原因（'' = 可以拼合）；宿主没提供拼合时恒为「不支持」 */
  const flattenBlocked = computed(() => {
    if (!opts.flattener) return '当前位置不支持拼合'
    if (!src.value) return '没有可校色的图片'
    if (!layers.value.some(layerEffective)) return '还没有任何调整'
    if (plan.value.some((p) => p.pending)) return '有图层的选区还没就绪'
    return ''
  })
  const canFlatten = computed(() => !!opts.flattener)

  /** 拼合（见文件头）：成功返回 true；失败图层保持不变 */
  async function flatten(): Promise<boolean> {
    if (flattening.value || merging.value || flattenBlocked.value || !opts.flattener) return false
    flushBurst()
    flattening.value = true
    const snap = cloneLayers(layers.value)
    const image = src.value
    flattenFromKey = key.value
    flattenAbandoned = false
    flattenNext = true
    try {
      const ok = await opts.flattener({
        sourceImage: image,
        layers: snap,
        bakeFile: (name = 'colorfix-flatten.png', maxSide = COLORFIX_EXPORT_MAX_SIDE) =>
          bakeToFile(/\.png$/i.test(name) ? name : `${name}.png`, maxSide),
      })
      if (!ok) {
        flattenNext = false
        return false
      }
      // 途中已翻到别的资产：新版本已存好，但不再改当前资产的状态与提示
      if (flattenAbandoned) return true
      noteLayers('已拼合为新版本：图层已清空，可在新版本上继续调色', 5000)
      // 宿主一般在返回前就切了图；没切（或换键还在路上）时 8s 后作废，免得之后某次换键误清图层
      if (flattenNext) {
        if (flattenTimer) clearTimeout(flattenTimer)
        flattenTimer = setTimeout(() => {
          flattenNext = false
          flattenTimer = null
        }, 8000)
      }
      return true
    } catch {
      flattenNext = false
      if (!flattenAbandoned) noteLayers('拼合失败，图层保持不变，请重试')
      return false
    } finally {
      flattening.value = false
    }
  }

  /** 给模板 / 子组件用的写入口（避免直接改传入对象上的 ref） */
  function setParams(p: ColorFixParams) {
    params.value = p
  }
  function setRegion(r: ColorFixRegion) {
    region.value = r
  }
  function setRecolor(r: ColorFixRecolor | null) {
    recolor.value = r
  }
  function setAdjust(a: ColorFixAdjust | null) {
    adjust.value = a
  }
  function setPainterOpen(v: boolean) {
    painterOpen.value = v
  }

  // ---------------- 替换颜色：自动源色（选中图层选区内的主色，色块显示用） ----------------

  const recolorAutoSource = ref<string | null>(null)
  let domTicket = 0
  watch(
    () => {
      const l = selectedLayer.value
      const want = !!l.recolor && l.recolor.source === null
      return [want, src.value, effectiveMaskOf(l), isBaseLayer(l), l.region.invert] as const
    },
    async ([want, image, mask, base, invert]) => {
      const my = ++domTicket
      if (!want || !image || (!base && !mask)) {
        recolorAutoSource.value = null
        return
      }
      const hex = await colorFixDominantColor(image, base ? null : mask, !base && invert)
      if (my === domTicket) recolorAutoSource.value = hex
    },
    { immediate: true },
  )

  // ---------------- 烘图 ----------------

  /** 校色开着：有图且（调过 / 参数台开着） */
  const active = computed(() => !!src.value && (touched.value || panelOpen.value))
  /** 是否可以给「校色对比」档（= active） */
  const compareAvailable = active

  /** 一层的渲染输入（像素层给它的像素地址，调整层给蒙版与调整） */
  function renderLayerOf(l: ColorFixLayer, mask: string): ColorFixRenderLayer {
    if (isPixelLayer(l)) {
      const px = pixelOf(l)
      return { params: { ...COLORFIX_ZERO }, mask: null, pixel: { full: px?.full ?? '', preview: px?.preview || px?.full || '' } }
    }
    return {
      params: { ...l.params },
      mask: mask || null,
      invert: mask ? l.region.invert : false,
      feather: mask ? l.region.feather : 0,
      recolor: recolorActive(l.recolor) ? { ...l.recolor } : null,
      adjust: adjustActive(l.adjust) ? cloneAdjust(l.adjust) : null,
    }
  }

  /** 生效的图层（可见且会改图），自下而上 */
  const plan = computed(() =>
    layers.value.filter(layerEffective).map((l) => ({ layer: l, mask: effectiveMaskOf(l), pending: pendingOf(l) })),
  )
  /** 有生效的选区图层蒙版还没就绪：导出拒绝（预览先跳过这些层） */
  const maskPending = computed(() => plan.value.some((p) => p.pending))
  /** 预览 / 导出的渲染输入（跳过未就绪的层） */
  const renderLayers = computed<ColorFixRenderLayer[]>(() =>
    plan.value.filter((p) => !p.pending).map(({ layer: l, mask }) => renderLayerOf(l, mask)),
  )
  /** 只有一层整图调整、没有替换颜色 / 更多调整：CSS filter 就能即时预览 */
  const filterOnly = computed(() => {
    const list = renderLayers.value
    return list.length === 1 && !list[0]!.mask && !list[0]!.recolor && !list[0]!.adjust && !list[0]!.pixel
  })

  const currentKey = computed(() => {
    if (!active.value || !renderLayers.value.length) return ''
    return `${src.value}${renderLayers.value
      .map((l) => {
        if (l.pixel) return `|PX:${l.pixel.full}`
        const p = l.params
        const rc = l.recolor ? `${l.recolor.source ?? 'a'}>${l.recolor.target}@${l.recolor.strength}` : ''
        const adj = adjustSignature(l.adjust)
        return `|${l.mask ?? ''}|${l.mask ? `${l.invert ? 'i' : ''}${l.feather}` : ''}|${p.hue}|${p.sat}|${p.light}|${p.bright}|${p.contrast}|${rc}${adj ? `|A${adj}` : ''}`
      })
      .join('#')}`
  })

  const baked = ref('')
  const bakedKey = ref('')
  const bakedSrc = ref('')
  const failed = ref(false)
  /** 失败原因是选区蒙版拿不到（提示「选区蒙版加载失败，未应用校色」） */
  const maskLoadFailed = ref(false)
  /** maskLoadFailed 时的提示语（选区蒙版 / 像素层各一句） */
  const loadFailedText = ref('')
  const baking = ref(false)
  let timers: ReturnType<typeof setTimeout>[] = []
  let ticket = 0

  function clearTimers() {
    timers.forEach(clearTimeout)
    timers = []
  }

  watch(
    currentKey,
    (k) => {
      clearTimers()
      ticket += 1
      if (!k || k === bakedKey.value) {
        baking.value = false
        return
      }
      failed.value = false
      maskLoadFailed.value = false
      baking.value = true
      const my = ticket
      const image = src.value
      const list = renderLayers.value.map((l) => ({ ...l }))
      const run = (side: number, final: boolean) => async () => {
        try {
          const out = await colorFixRenderLayers(image, list, side)
          if (my !== ticket) return
          baked.value = out
          bakedSrc.value = image
          if (final) bakedKey.value = k
        } catch (err) {
          if (my !== ticket) return
          // 蒙版加载失败：小图那一轮就定论（再跑大图也一样拿不到）
          if (err instanceof ColorFixMaskLoadError) {
            maskLoadFailed.value = true
            loadFailedText.value = err.message
          }
          if (final || err instanceof ColorFixMaskLoadError) failed.value = true
        } finally {
          if (my === ticket && final) baking.value = false
        }
      }
      if (!filterOnly.value) {
        timers.push(setTimeout(run(QUICK_SIDE, false), 60))
        timers.push(setTimeout(run(PREVIEW_SIDE, true), 260))
      } else {
        timers.push(setTimeout(run(PREVIEW_SIDE, true), 140))
      }
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    clearTimers()
    ticket += 1
    if (opts.saver?.save && typeof window !== 'undefined') {
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    flushRemote()
    if (burstTimer) clearTimeout(burstTimer)
    if (capTimer) clearTimeout(capTimer)
    if (flattenTimer) clearTimeout(flattenTimer)
  })

  /** 当前参数的烘图已就绪 */
  const ready = computed(() => !!currentKey.value && bakedKey.value === currentKey.value && !!baked.value)

  /**
   * 「按住看原图」：按住期间所有读 displaySrc / liveFilter / wholeFilter 的画面（舞台、对比、全屏）都显示未校色的原图，
   * 松开即恢复；不动任何参数。面板收起 / 换图 / 卸载时一并复位。
   */
  const peeking = ref(false)
  watch([panelOpen, currentKey, src], () => (peeking.value = false))
  if (typeof window !== 'undefined') {
    const stopPeek = () => (peeking.value = false)
    window.addEventListener('blur', stopPeek)
    onBeforeUnmount(() => window.removeEventListener('blur', stopPeek))
  }

  /** 该显示的图：校色开着时是烘好的图；烘好前整图 = 原图（配 previewStyle），有选区 = 上一张烘好的 */
  const displaySrc = computed(() => {
    const image = src.value || opts.src.value || ''
    if (!currentKey.value || peeking.value) return image
    if (ready.value) return baked.value
    if (!filterOnly.value && !failed.value && bakedSrc.value === image && baked.value) return baked.value
    return image
  })

  /** 挂在 displaySrc 上的 CSS filter：只在整图校色、显示的还是原图时有 */
  const liveFilter = computed<string | undefined>(() => {
    if (peeking.value || !currentKey.value || !filterOnly.value || displaySrc.value !== src.value) return undefined
    return colorFixFilter(renderLayers.value[0]!.params)
  })
  const previewStyle = computed(() => (liveFilter.value ? { filter: liveFilter.value } : undefined))

  /** 只靠 CSS filter 就能表达的整图校色（全屏放大时直接给原图挂它，原分辨率清晰）；其余 undefined */
  const wholeFilter = computed<string | undefined>(() =>
    currentKey.value && filterOnly.value && !peeking.value ? colorFixFilter(renderLayers.value[0]!.params) : undefined,
  )
  /** 烘好的预览图长边（全屏据此判断放大后是否需要局部高清） */
  const previewSide = PREVIEW_SIDE

  /**
   * 全屏放大后的局部高清：按当前图层渲原图 crop 区域（原图像素），scale ≤ 1 = 相对原图的缩放。
   * 返回 objectURL 与实际覆盖区域（原图像素，叠放按它摆）；参数还没烘好 / 选区未就绪 / 没校色返回 null。
   * 调用方拿 detailKey 判断结果是否还对得上当前参数。
   */
  async function renderDetail(
    crop: { x: number; y: number; w: number; h: number },
    scale = 1,
  ): Promise<ColorFixCropResult | null> {
    if (!currentKey.value || filterOnly.value || maskPending.value || !src.value) return null
    return colorFixRenderCrop(
      src.value,
      renderLayers.value.map((l) => ({ ...l })),
      crop,
      Math.min(1, Math.max(0.05, scale)),
    )
  }

  // ---------------- 导出 ----------------

  /** 导出真图（长边 ≤ maxSide 只缩不放、无损 PNG、保留透明）；未校色 / 选区未就绪时抛错（调用方退回原图） */
  function bakeToDataUrl(maxSide = COLORFIX_EXPORT_MAX_SIDE): Promise<string> {
    if (!active.value || !src.value) return Promise.reject(new Error('未开启校色'))
    if (maskPending.value) return Promise.reject(new Error('选区尚未就绪'))
    return colorFixRenderLayers(
      src.value,
      renderLayers.value.map((l) => ({ ...l })),
      maxSide,
    )
  }

  async function bakeToBlob(maxSide?: number): Promise<Blob> {
    return colorFixDataUrlToBlob(await bakeToDataUrl(maxSide))
  }

  async function bakeToFile(name = 'colorfix.png', maxSide?: number): Promise<File> {
    return new File([await bakeToBlob(maxSide)], name, { type: 'image/png' })
  }

  /**
   * 下载校色后的图（文件名自动补 .png）。返回 true = 下载的是校色后的图；false = 烘图失败 / 未校色，已退回下载原图
   * （调用方据此提示「校色效果未能写入」）。
   */
  async function downloadBaked(name: string): Promise<boolean> {
    try {
      const blob = await bakeToBlob()
      triggerDownload(blob, withPngExt(name))
      return true
    } catch {
      if (src.value) void downloadImage(src.value, withImageExt(name.replace(/\.png$/i, ''), src.value))
      return false
    }
  }

  /** 下载原图（校色前；文件名按原图地址补扩展名） */
  function downloadOriginal(name: string) {
    if (src.value) void downloadImage(src.value, withImageExt(name, src.value))
  }

  /** 列表上每层的状态（识别中 / 选区未就绪 / 识别失败），图层列表打标用 */
  function layerStatus(l: ColorFixLayer): 'ok' | 'busy' | 'pending' | 'error' {
    if (isBaseLayer(l) && !isPixelLayer(l)) return 'ok'
    if (isPixelLayer(l)) {
      const st = pixelOf(l)?.state
      return st === 'ok' ? 'ok' : st === 'missing' ? 'error' : 'pending'
    }
    const m = maskOf(l.id)
    if (l.region.mode === 'auto' && m.busy) return 'busy'
    if (l.region.mode === 'auto' && m.error) return 'error'
    return effectiveMaskOf(l) ? 'ok' : 'pending'
  }

  return {
    /** 底层「恢复默认」用的那组参数 */
    defaults,
    references,
    /** 参考图自动校色（宿主没给 = null，不出入口） */
    autoColor: opts.autoColor ?? null,
    applyPieceParams,
    layerMask,
    presetMaskFor,
    // 状态
    params,
    region,
    recolor,
    adjust,
    touched,
    panelOpen,
    painterOpen,
    pointOpen,
    fullscreen,
    active,
    compareAvailable,
    // 图层
    layers,
    selectedLayerId,
    selectedLayer,
    canAddLayer,
    capNotice,
    capHint,
    /** 在图层区显示一行提示（4s 后清空） */
    noteLayers,
    pasteLayers,
    /** 向下合并（选中层与下面那层栅格化成像素层，见文件头） */
    mergeDown,
    merging,
    canMergeDown,
    /** 选中图层向下合并不可用的原因（'' = 可以） */
    mergeDownBlockedReason,
    /** 选中的是像素层（参数台不出选区 / 调整项，只有一条说明） */
    selectedIsPixel,
    /** 选中的像素层只在内存里（刷新后丢） */
    selectedPixelVolatile,
    canFlatten,
    flattenBlocked,
    flattening,
    flatten,
    canUndoLayers,
    canRedoLayers,
    recolorAutoSource,
    layerStatus,
    selectLayer,
    addLayer,
    duplicateLayer,
    removeLayer,
    moveLayer,
    setLayerVisible,
    renameLayer,
    setLayerRecolor,
    undoLayers,
    redoLayers,
    // 选区（选中图层）
    regionModes,
    autoTargets,
    garmentParts,
    maskBusy,
    maskError,
    maskRetryable,
    maskSuggest,
    maskSlow,
    maskPending,
    effectiveMask,
    paintedMask,
    paintedVolatile,
    pointMask,
    pointVolatile,
    /** 点选不可用的原因（'' = 可用） */
    pointBlocked: pointSegmentBlocked,
    // 预览
    peeking,
    displaySrc,
    liveFilter,
    previewStyle,
    wholeFilter,
    previewSide,
    /** 当前渲染参数的签名（局部高清按它判断过期）；'' = 不需要渲染 */
    detailKey: currentKey,
    renderDetail,
    ready,
    baking,
    failed,
    /** failed 的原因是选区蒙版 / 像素层加载失败 */
    maskLoadFailed,
    loadFailedText,
    /** 当前原图（enabled 关时为 ''） */
    src,
    // 动作
    open,
    close,
    openFullscreen,
    closeFullscreen,
    retryMask,
    resetParams,
    clear,
    setParams,
    setRegion,
    setRecolor,
    setAdjust,
    setPainterOpen,
    openPainter,
    openPointSelect,
    setPointOpen,
    applyPointMask,
    applyPaintedMask,
    loadSelectionSession: loadSelectionSessionOf,
    clearPaintedMask,
    bakeToDataUrl,
    bakeToBlob,
    bakeToFile,
    downloadBaked,
    downloadOriginal,
  }
}

export type ResultColorFix = ReturnType<typeof useResultColorFix>
