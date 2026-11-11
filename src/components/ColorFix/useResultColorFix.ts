/**
 * 结果图校色的页面无关状态机（见 ./index.ts 顶部的接入说明）。
 *
 * <p>职责：五参数 + 选区（整图 / 自动识别 / 手动涂抹，反选、柔化）按结果键持久化；参数 / 选区变化后停手烘真像素
 * （utils/colorfix colorFixImage，按 原图 + 蒙版 + 参数 缓存）；导出（下载 / 存资产）按长边 ≤4096 只缩不放、无损 PNG、
 * 保留透明通道。
 *
 * <p>预览：
 * <ul>
 *   <li>整图：烘好前原图挂 CSS filter（previewStyle），与烘出来的结果一致，拖动跟手；</li>
 *   <li>有选区：CSS filter 只能整图生效，改为画布小图预览——停手 60ms 先烘长边 720 的小图，再 260ms 烘 1600 的预览图；
 *       新图出来前沿用上一张烘好的（同一张原图时）。</li>
 * </ul>
 * 选了「自动识别 / 手动涂抹」但蒙版还没就绪（识别中 / 还没涂）：不做任何校色（显示原图），面板给提示；导出同理返回原图。
 *
 * <p>「校色开着」（active）= 可用 && 有图 && 有效（调过参数 / 本条存过参数）或参数台开着——与工具页 v1 语义一致：
 * 只点开参数台没动参数，不落存储，下次切回仍算没校色。
 */
import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import {
  ColorFixMaskLoadError,
  COLORFIX_DEFAULT,
  COLORFIX_EXPORT_MAX_SIDE,
  colorFixDataUrlToBlob,
  colorFixFilter,
  colorFixImage,
  colorFixSanitize,
  loadColorFix,
  saveColorFix,
  type ColorFixParams,
} from '@/utils/colorfix.ts'
import { downloadImage } from '@/utils/download'
import {
  COLORFIX_GARMENT_PARTS,
  COLORFIX_REGION_DEFAULT,
  type ColorFixAutoTarget,
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
  type ColorFixSegmenter,
  type ColorFixSegmentSuggestion,
} from './segment.ts'
import {
  deletePaintedMask,
  loadPaintedMask,
  loadRegion,
  onPaintedMaskChange,
  saveRegion,
  savePaintedMask,
} from './mask-store.ts'
import { clearStoredColorFix } from './stored.ts'
import { pointSegmentBlocked } from './point-support.ts'
import { triggerDownload, withImageExt, withPngExt } from './files.ts'

export { triggerDownload }

/** 远端保存（可选）：本机 localStorage 照写，另外停手 500ms 调 save；load 在切到这个键时调一次（本机没有时才采用） */
export interface ColorFixRemoteSaver {
  load?(key: string): Promise<ColorFixParams | null> | ColorFixParams | null
  save?(key: string, params: ColorFixParams, region: ColorFixRegion): Promise<unknown> | void
}

export interface ResultColorFixOptions {
  /** 持久化键（任务号 / 结果号）；空 = 不持久化（参数随会话） */
  key: Ref<string | undefined | null>
  /** 当前要校色的原图地址；空 = 没有可校色的图 */
  src: Ref<string | undefined | null>
  /** 现成的蒙版（如商拍任务的 mask_url）：作为 {@link maskTarget} 这个目标的「自动识别」结果，免一次识别请求 */
  maskUrl?: Ref<string | undefined | null>
  /** maskUrl 代表哪个识别目标，默认 garment */
  maskTarget?: ColorFixAutoTarget
  /**
   * 现成的逐件服装蒙版（如商拍任务的 mask_parts）：maskUrl 是它们的合并；空数组 = maskUrl 是全部服装。
   * 是数组（哪怕空）即说明服务端支持服装细分部位；undefined = 不知道（老网关）
   */
  maskParts?: Ref<ColorFixPresetPart[] | undefined | null>
  /** 总开关（如只对图片结果开）；不传 = 开 */
  enabled?: Ref<boolean>
  /** 「恢复默认」/ 初始参数 */
  defaults?: ColorFixParams
  /** 没存过选区时的初始选区（如商拍有 mask_url 时传 { mode: 'auto', target: 'garment' }）；默认整图 */
  defaultRegion?: Partial<ColorFixRegion>
  /** 提供哪些选区方式；默认三种都给（自动识别在接口 404 / segmenter=null 时自动隐藏） */
  regionModes?: ColorFixRegionMode[]
  /** 自动识别函数；null = 不提供自动识别（有 maskUrl 时仍可用那一个目标） */
  segmenter?: ColorFixSegmenter | null
  /** 远端保存（可选） */
  saver?: ColorFixRemoteSaver
}

const PREVIEW_SIDE = 1600
const QUICK_SIDE = 720
/** 自动识别等这么久还没出来：换成「首次识别较慢」的提示 */
const MASK_SLOW_MS = 15_000

export function useResultColorFix(opts: ResultColorFixOptions) {
  const defaults = opts.defaults ?? COLORFIX_DEFAULT
  const regionDefault = (): ColorFixRegion => ({ ...COLORFIX_REGION_DEFAULT, ...opts.defaultRegion })
  const enabled = computed(() => opts.enabled?.value ?? true)
  const src = computed(() => (enabled.value && opts.src.value) || '')
  const key = computed(() => opts.key.value || '')

  const params = ref<ColorFixParams>({ ...defaults })
  const region = ref<ColorFixRegion>(regionDefault())
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
  /** 当前选区实际生效的部位（服务端不支持 / 非服装为空 = 全部服装） */
  const activeParts = computed(() => colorFixRequestParts(region.value.target, region.value.parts))
  const regionModes = computed<ColorFixRegionMode[]>(() =>
    (opts.regionModes ?? ['whole', 'auto', 'paint', 'point']).filter(
      (m) => m !== 'auto' || autoTargets.value.length > 0,
    ),
  )

  const autoMask = ref('')
  const maskBusy = ref(false)
  const maskError = ref('')
  /** 识别失败可以手动重试（超时 / 6001 服务不可用 / 太频繁等；4001 没识别到不给） */
  const maskRetryable = ref(false)
  /** 识别失败时建议的替代方式（4001 没识别到：换人物 / 点选 / 手动涂抹） */
  const maskSuggest = ref<ColorFixSegmentSuggestion[]>([])
  /** 识别已等了 {@link MASK_SLOW_MS} 以上（首次识别慢，面板换成「约需 1 分钟」的提示） */
  const maskSlow = ref(false)
  /** 手动重试计数：变了就重新识别（失败的不进缓存，会真正重发） */
  const maskRetryTick = ref(0)
  const paintedMask = ref('')
  /** 涂抹蒙版只留在内存（太大 / IndexedDB 不可用），刷新后会丢 */
  const paintedVolatile = ref(false)

  /** 涂抹蒙版的作用域：结果键 + 原图（同一记录多张候选各有各的涂抹）；没有键时只按原图（只在内存） */
  const paintScope = computed(() => (src.value ? `${key.value}::${src.value}` : ''))

  /** 当前生效的蒙版地址；整图 / 蒙版未就绪为 '' */
  const effectiveMask = computed(() => {
    const m = region.value.mode
    if (m === 'auto') return autoMask.value
    if (m === 'paint') return paintedMask.value
    if (m === 'point') return pointMask.value
    return ''
  })
  /** 选了局部选区但蒙版还没就绪 */
  const maskPending = computed(() => region.value.mode !== 'whole' && !effectiveMask.value)

  // 选区方式不再可用（如接口 404）时回到整图
  watch(regionModes, (modes) => {
    if (!modes.includes(region.value.mode)) region.value = { ...region.value, mode: 'whole' }
  })

  let segTicket = 0
  let segAbort: AbortController | null = null
  let slowTimer: ReturnType<typeof setTimeout> | null = null
  function stopSegment() {
    segAbort?.abort()
    segAbort = null
    if (slowTimer) clearTimeout(slowTimer)
    slowTimer = null
    maskSlow.value = false
  }
  watch(
    () =>
      [
        region.value.mode,
        region.value.target,
        src.value,
        presetMask.value,
        activeParts.value.join(','),
        presetParts.value,
        maskRetryTick.value,
      ] as const,
    async ([mode, target, image, preset]) => {
      const my = ++segTicket
      // 换目标 / 换图 / 切走 / 关闭（src 置空）：放弃上一轮识别（网关超时的退避重发一并停掉）。
      // 上一轮的 abort 推迟到这一轮登记之后：同一份识别（键没变，如部位数组换了引用）接着等，不从头重来
      const prevAbort = segAbort
      segAbort = null
      stopSegment()
      maskError.value = ''
      maskRetryable.value = false
      maskSuggest.value = []
      if (mode !== 'auto' || !image) {
        prevAbort?.abort()
        maskBusy.value = false
        return
      }
      const parts = activeParts.value
      const presetHit = target === maskTarget ? colorFixPresetFor(parts, preset, presetParts.value) : ''
      if (presetHit) {
        prevAbort?.abort()
        autoMask.value = presetHit
        maskBusy.value = false
        return
      }
      autoMask.value = ''
      if (!segmenter || !colorFixSegmentSupported.value) {
        prevAbort?.abort()
        maskError.value = '当前环境不支持自动识别，请改用手动涂抹'
        return
      }
      maskBusy.value = true
      const ctrl = new AbortController()
      segAbort = ctrl
      slowTimer = setTimeout(() => {
        if (my === segTicket) maskSlow.value = true
      }, MASK_SLOW_MS)
      try {
        const call = segmenter(image, target, parts, { signal: ctrl.signal })
        prevAbort?.abort()
        const url = await call
        if (my === segTicket) autoMask.value = url
      } catch (err) {
        if (my === segTicket && !ctrl.signal.aborted) {
          const f = colorFixSegmentFailure(err, target)
          if (f) {
            maskError.value = f.message
            maskRetryable.value = f.retryable && colorFixSegmentSupported.value
            maskSuggest.value = f.suggest ?? []
          }
        }
      } finally {
        prevAbort?.abort()
        if (my === segTicket) {
          maskBusy.value = false
          if (slowTimer) clearTimeout(slowTimer)
          slowTimer = null
          maskSlow.value = false
          if (segAbort === ctrl) segAbort = null
        }
      }
    },
    { immediate: true },
  )
  onBeforeUnmount(() => {
    segTicket += 1
    stopSegment()
  })

  /** 识别失败后手动重试 */
  function retryMask() {
    if (region.value.mode === 'auto' && !maskBusy.value) maskRetryTick.value += 1
  }

  let paintTicket = 0
  watch(
    paintScope,
    async (scope) => {
      const my = ++paintTicket
      paintedMask.value = ''
      paintedVolatile.value = false
      if (!scope) return
      const url = await loadPaintedMask(scope)
      if (my === paintTicket) paintedMask.value = url
    },
    { immediate: true },
  )

  /** 手动涂抹完成：存蒙版（IndexedDB / 内存）并切到「手动涂抹」 */
  async function applyPaintedMask(blob: Blob) {
    const scope = paintScope.value
    if (!scope) return
    const { url, persisted } = key.value
      ? await savePaintedMask(scope, blob)
      : { url: URL.createObjectURL(blob), persisted: false }
    if (scope !== paintScope.value) return
    paintedMask.value = url
    paintedVolatile.value = !persisted
    region.value = { ...region.value, mode: 'paint' }
    painterOpen.value = false
  }

  async function clearPaintedMask() {
    const scope = paintScope.value
    paintedMask.value = ''
    if (scope) await deletePaintedMask(scope)
  }

  function openPainter() {
    if (src.value) painterOpen.value = true
  }

  // 点选蒙版：与涂抹同一个 maskStore（IndexedDB / 内存），作用域 `<key>::point::<原图>`——
  // 仍以 `<key>::` 开头，clearStoredColorFix / deletePaintedMasksOf 一并清掉
  const pointMask = ref('')
  const pointVolatile = ref(false)
  const pointScope = computed(() => (src.value ? `${key.value}::point::${src.value}` : ''))
  let pointTicket = 0
  watch(
    pointScope,
    async (scope) => {
      const my = ++pointTicket
      pointMask.value = ''
      pointVolatile.value = false
      if (!scope) return
      const url = await loadPaintedMask(scope)
      if (my === pointTicket) pointMask.value = url
    },
    { immediate: true },
  )

  /** 点选完成：存蒙版并切到「点选」 */
  async function applyPointMask(blob: Blob) {
    const scope = pointScope.value
    if (!scope) return
    const { url, persisted } = key.value
      ? await savePaintedMask(scope, blob)
      : { url: URL.createObjectURL(blob), persisted: false }
    if (scope !== pointScope.value) return
    pointMask.value = url
    pointVolatile.value = !persisted
    region.value = { ...region.value, mode: 'point' }
    pointOpen.value = false
  }

  /** 打开点选（浏览器不支持时不开） */
  function openPointSelect() {
    if (src.value && !pointSegmentBlocked.value) pointOpen.value = true
  }
  function setPointOpen(v: boolean) {
    pointOpen.value = v
  }

  // 别处替换 / 删除 / 淘汰了同一作用域的蒙版（旧 objectURL 会被回收）：重新读一次，不清空现有值、不动 volatile 标记
  const stopMaskSync = onPaintedMaskChange((scope) => {
    if (scope === paintScope.value) {
      const my = ++paintTicket
      void loadPaintedMask(scope).then((url) => {
        if (my === paintTicket) paintedMask.value = url
      })
    }
    if (scope === pointScope.value) {
      const my = ++pointTicket
      void loadPaintedMask(scope).then((url) => {
        if (my === pointTicket) pointMask.value = url
      })
    }
  })
  onBeforeUnmount(stopMaskSync)

  // 原图换了（切记录 / 切候选）：点选 / 涂抹弹窗是对着旧图画的，直接关掉，免得把旧图的选区存到新图名下
  watch(src, (next, prev) => {
    if (next === prev) return
    painterOpen.value = false
    pointOpen.value = false
  })

  // ---------------- 参数持久化 ----------------

  let remoteTimer: ReturnType<typeof setTimeout> | null = null
  function persist() {
    const k = key.value
    if (!k || !touched.value) return
    saveColorFix(k, params.value)
    saveRegion(k, region.value)
    if (opts.saver?.save) {
      if (remoteTimer) clearTimeout(remoteTimer)
      const p = { ...params.value }
      const r = { ...region.value }
      remoteTimer = setTimeout(() => {
        remoteTimer = null
        void Promise.resolve(opts.saver?.save?.(k, p, r)).catch(() => {})
      }, 500)
    }
  }

  let loading = false
  watch(
    key,
    async (k) => {
      loading = true
      const stored = k ? loadColorFix(k) : null
      params.value = stored ? { ...stored } : { ...defaults }
      region.value = (k ? loadRegion(k) : null) ?? regionDefault()
      touched.value = !!stored
      panelOpen.value = false
      painterOpen.value = false
      pointOpen.value = false
      fullscreen.value = false
      loading = false
      if (!stored && k && opts.saver?.load) {
        const remote = colorFixSanitize(await Promise.resolve(opts.saver.load(k)).catch(() => null))
        if (remote && key.value === k && !touched.value) {
          loading = true
          params.value = remote
          touched.value = true
          loading = false
          saveColorFix(k, remote)
        }
      }
    },
    { immediate: true },
  )

  // 参数台里调参 / 改选区：标记校色过并落存储
  watch(
    [params, region],
    () => {
      if (loading || !panelOpen.value) return
      touched.value = true
      persist()
    },
    { deep: true },
  )

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
    persist()
  }

  function resetParams() {
    params.value = { ...defaults }
  }

  /**
   * 移除这条的校色：删掉本机存的参数、选区与所有涂抹蒙版，状态回到原图（参数台 / 涂抹弹窗一并收起，不落存储）。
   * 远端 saver 存过的不动（没有删除口），下次切回本机没有时仍会按 saver.load 还原。
   */
  async function clear() {
    const k = key.value
    if (remoteTimer) clearTimeout(remoteTimer)
    remoteTimer = null
    loading = true
    panelOpen.value = false
    painterOpen.value = false
    fullscreen.value = false
    params.value = { ...defaults }
    region.value = regionDefault()
    touched.value = false
    paintedMask.value = ''
    paintedVolatile.value = false
    pointOpen.value = false
    pointMask.value = ''
    pointVolatile.value = false
    loading = false
    const scope = paintScope.value
    const pScope = pointScope.value
    if (k) await clearStoredColorFix(k)
    else {
      if (scope) await deletePaintedMask(scope)
      if (pScope) await deletePaintedMask(pScope)
    }
  }

  /** 给模板 / 子组件用的写入口（避免直接改传入对象上的 ref） */
  function setParams(p: ColorFixParams) {
    params.value = p
  }
  function setRegion(r: ColorFixRegion) {
    region.value = r
  }
  function setPainterOpen(v: boolean) {
    painterOpen.value = v
  }

  // ---------------- 烘图 ----------------

  /** 校色开着：有图且（调过 / 参数台开着） */
  const active = computed(() => !!src.value && (touched.value || panelOpen.value))
  /** 是否可以给「校色对比」档（= active） */
  const compareAvailable = active

  const maskOpts = computed(() => ({ invert: region.value.invert, feather: region.value.feather }))
  const currentKey = computed(() => {
    if (!active.value || maskPending.value) return ''
    const p = params.value
    const r = region.value
    const m = effectiveMask.value
    return `${src.value}|${m}|${m ? `${r.invert ? 'i' : ''}${r.feather}` : ''}|${p.hue}|${p.sat}|${p.light}|${p.bright}|${p.contrast}`
  })

  const baked = ref('')
  const bakedKey = ref('')
  const bakedSrc = ref('')
  const failed = ref(false)
  /** 失败原因是选区蒙版拿不到（提示「选区蒙版加载失败，未应用校色」） */
  const maskLoadFailed = ref(false)
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
      const p = { ...params.value }
      const mask = effectiveMask.value || null
      const mo = { ...maskOpts.value }
      const run = (side: number, final: boolean) => async () => {
        try {
          const out = await colorFixImage(image, p, mask, side, mo)
          if (my !== ticket) return
          baked.value = out
          bakedSrc.value = image
          if (final) bakedKey.value = k
        } catch (err) {
          if (my !== ticket) return
          // 蒙版加载失败：小图那一轮就定论（再跑大图也一样拿不到）
          if (err instanceof ColorFixMaskLoadError) maskLoadFailed.value = true
          if (final || err instanceof ColorFixMaskLoadError) failed.value = true
        } finally {
          if (my === ticket && final) baking.value = false
        }
      }
      if (mask) {
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
    if (remoteTimer) clearTimeout(remoteTimer)
  })

  /** 当前参数的烘图已就绪 */
  const ready = computed(() => !!currentKey.value && bakedKey.value === currentKey.value && !!baked.value)

  /** 该显示的图：校色开着时是烘好的图；烘好前整图 = 原图（配 previewStyle），有选区 = 上一张烘好的 */
  const displaySrc = computed(() => {
    const image = src.value || opts.src.value || ''
    if (!currentKey.value) return image
    if (ready.value) return baked.value
    if (effectiveMask.value && !failed.value && bakedSrc.value === image && baked.value) return baked.value
    return image
  })

  /** 挂在 displaySrc 上的 CSS filter：只在整图校色、显示的还是原图时有 */
  const liveFilter = computed<string | undefined>(() => {
    if (!currentKey.value || effectiveMask.value || displaySrc.value !== src.value) return undefined
    return colorFixFilter(params.value)
  })
  const previewStyle = computed(() => (liveFilter.value ? { filter: liveFilter.value } : undefined))

  // ---------------- 导出 ----------------

  /** 导出真图（长边 ≤ maxSide 只缩不放、无损 PNG、保留透明）；未校色 / 选区未就绪时抛错（调用方退回原图） */
  function bakeToDataUrl(maxSide = COLORFIX_EXPORT_MAX_SIDE): Promise<string> {
    if (!active.value || !src.value) return Promise.reject(new Error('未开启校色'))
    if (maskPending.value) return Promise.reject(new Error('选区尚未就绪'))
    return colorFixImage(src.value, { ...params.value }, effectiveMask.value || null, maxSide, { ...maskOpts.value })
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

  return {
    // 状态
    params,
    region,
    touched,
    panelOpen,
    painterOpen,
    pointOpen,
    fullscreen,
    active,
    compareAvailable,
    // 选区
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
    displaySrc,
    liveFilter,
    previewStyle,
    ready,
    baking,
    failed,
    /** failed 的原因是选区蒙版加载失败 */
    maskLoadFailed,
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
    setPainterOpen,
    openPainter,
    openPointSelect,
    setPointOpen,
    applyPointMask,
    applyPaintedMask,
    clearPaintedMask,
    bakeToDataUrl,
    bakeToBlob,
    bakeToFile,
    downloadBaked,
    downloadOriginal,
  }
}

export type ResultColorFix = ReturnType<typeof useResultColorFix>
