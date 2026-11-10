import { computed, getCurrentScope, onScopeDispose, reactive, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { upload } from '@/api/ossUpload.ts'
import { toApiError } from '@/api/index.ts'
import type { UploadSpec } from './schemas'

/**
 * 商拍换装的服装图状态（原型 AiDigitalModel 2026-10-29 改版）：单品 → 每件 6 个固定角度格 / 一套合影。
 *
 * <p>单品、角度、一套 / 分别只是界面的整理方式：契约 AIModelTryonRequest 只收一张 cloth_image_url，
 * 写回服装图槽位的是原型 clothUrl() 同一口径——一套合影取那张合影，分别上传取所选单品里排第一张的图。
 * 单品 / 角度 / 面料 / 长度 / 袖长不在契约里，不进请求体。
 */

export interface OutfitItem {
  key: string
  label: string
}

export const OUTFIT: OutfitItem[] = [
  { key: 'top', label: '上衣' },
  { key: 'bottom', label: '下装' },
  { key: 'dress', label: '连衣裙' },
  { key: 'outer', label: '外套' },
  { key: 'shoes', label: '鞋子' },
  { key: 'accessory', label: '配饰' },
  { key: 'bra', label: '文胸' },
  { key: 'panties', label: '内裤' },
]
const OUTFIT_MAP: Record<string, OutfitItem> = Object.fromEntries(OUTFIT.map((item) => [item.key, item]))
export const outfitLabel = (key: string) => OUTFIT_MAP[key]?.label ?? key

/**
 * 互斥单品对，选一个就取消另一个（原型口径，与 studio/constants.ts OUTFIT_CONFLICTS、Go itemExclusive 同一份）：
 * 连衣裙 ↔ 上衣/下装、文胸 ↔ 上衣/连衣裙、内裤 ↔ 下装/连衣裙
 */
export const OUTFIT_CONFLICT_PAIRS = [
  ['dress', 'top'],
  ['dress', 'bottom'],
  ['bra', 'top'],
  ['bra', 'dress'],
  ['panties', 'bottom'],
  ['panties', 'dress'],
] as const
const CONFLICT: Record<string, string[]> = {}
for (const [a, b] of OUTFIT_CONFLICT_PAIRS) {
  ;(CONFLICT[a] = CONFLICT[a] ?? []).push(b)
  ;(CONFLICT[b] = CONFLICT[b] ?? []).push(a)
}

/** 弹窗说明句：按互斥对的左项归组 →「连衣裙与上衣 / 下装互斥，文胸与上衣 / 连衣裙互斥，内裤与下装 / 连衣裙互斥」 */
export const OUTFIT_CONFLICT_TEXT = (() => {
  const groups = new Map<string, string[]>()
  for (const [a, b] of OUTFIT_CONFLICT_PAIRS) groups.set(a, [...(groups.get(a) ?? []), b])
  return [...groups].map(([a, list]) => `${outfitLabel(a)}与${list.map(outfitLabel).join(' / ')}互斥`).join('，')
})()

/** 弹窗里 6 个固定角度格：上传前就告诉用户这一格放什么角度 */
export const ANGLES = ['正面', '背面', '侧面', '细节', '平铺', '其他'] as const
export const MAX_ITEMS = 3
export const MAX_PHOTOS = 6
/** 服装图合计上限：3 件共用这 9 个名额 */
export const MAX_GARMENT = 9

export interface GarmentPhoto {
  id: number
  url: string
  /** 单品 key */
  role: string
  angle: string
}

/** 可选的上传通道：不给走 api/ossUpload.ts（默认）；返回成功的地址，失败的由通道自己提示、不抛 */
export interface ToolImageUploadOptions {
  upload?: (files: File[]) => Promise<string[]>
}

/** 与 ToolUploadSlot 同一套上传前校验（格式按 accept、体积按 maxBytes），提示也同一句 */
export function useToolImageUpload(spec: () => UploadSpec, options: ToolImageUploadOptions = {}) {
  const message = useMessage()
  const uploading = ref(false)
  /**
   * 代号：清空 / 换掉 / 卸载时 +1（invalidate），还在路上的上传回来发现代号变了就整批丢弃，
   * 不把旧结果追加进已经清空或换过的格子里
   */
  let generation = 0
  function invalidate() {
    generation += 1
    uploading.value = false
  }
  if (getCurrentScope()) onScopeDispose(invalidate)
  const exts = () =>
    spec()
      .accept.split(',')
      .map((s) => s.trim().toLowerCase())
  const extText = () =>
    exts()
      .map((e) => e.replace('.', '').toUpperCase())
      .join(' / ')
  const sizeText = () => `${spec().maxBytes / 1024 / 1024}M`

  function validate(file: File) {
    const name = file.name.toLowerCase()
    if (!exts().some((ext) => name.endsWith(ext))) return `「${file.name}」格式不支持，仅支持 ${extText()}`
    if (file.size > spec().maxBytes) return `「${file.name}」超过 ${sizeText()}，请压缩后再上传`
    return null
  }

  /** 资产库选回的 URL：路径带扩展名时按 accept 拦（与 ToolUploadSlot.addAssetUrls 同口径） */
  function acceptUrl(u: string) {
    const path = (u.split(/[?#]/)[0] ?? '').toLowerCase()
    const name = path.slice(path.lastIndexOf('/') + 1)
    if (!name.includes('.') || exts().some((ext) => name.endsWith(ext))) return true
    message.error(`「${name}」格式不支持，仅支持 ${extText()}`)
    return false
  }

  async function uploadFiles(files: File[]): Promise<string[]> {
    const valid: File[] = []
    for (const f of files) {
      const err = validate(f)
      if (err) message.error(err)
      else valid.push(f)
    }
    if (!valid.length) return []
    const mine = ++generation
    uploading.value = true
    try {
      const urls = await (options.upload ?? upload)(valid)
      return mine === generation ? urls : []
    } catch (err) {
      if (mine !== generation) return []
      // 业务失败请求层已 toast，这里只补传输层 / 对象存储的失败提示
      const apiErr = toApiError(err)
      if (!apiErr || apiErr.code === -1) message.error('上传失败，请检查网络后重试')
      return []
    } finally {
      if (mine === generation) uploading.value = false
    }
  }

  return { uploading, uploadFiles, acceptUrl, invalidate }
}

/** 回填用的整份状态（角度用中文 ANGLES；role 为单品 key） */
export interface TryonGarmentState {
  selected: string[]
  mode: 'separate' | 'together'
  photos: { url: string; role: string; angle: string }[]
  look: string
}

export function useTryonGarment(spec: () => UploadSpec, options: ToolImageUploadOptions = {}) {
  const message = useMessage()
  const uploader = useToolImageUpload(spec, options)

  const selected = ref<string[]>([])
  const mode = ref<'separate' | 'together'>('separate')
  const photos = ref<GarmentPhoto[]>([])
  const look = ref('')
  let seq = 0

  /**
   * 服装图合计上限：默认 MAX_GARMENT（9）；页面可按模型收紧（商拍工作室 = min(9, 模型参考图上限 − 1)），
   * 经 ToolTryonMaterials 的 maxGarments 写进来（setMaxGarments），roomOf / 拖入 / 资产库都按它拦
   */
  const capOverride = ref<number | null>(null)
  const maxGarments = computed(() => {
    const n = capOverride.value
    return typeof n === 'number' && Number.isFinite(n) ? Math.max(1, Math.min(MAX_GARMENT, Math.floor(n))) : MAX_GARMENT
  })
  function setMaxGarments(n: number | null | undefined) {
    capOverride.value = typeof n === 'number' ? n : null
  }
  const isTogether = computed(() => selected.value.length >= 2 && mode.value === 'together')
  const photosOf = (key: string) => photos.value.filter((p) => p.role === key)
  /** 参与本次的服装图：一套合影 = 那一张；分别上传 = 所选单品的图（没选上的单品图留着，只是不参与） */
  const allPhotos = computed<string[]>(() =>
    isTogether.value
      ? look.value
        ? [look.value]
        : []
      : selected.value.flatMap((key) => photosOf(key).map((p) => p.url)),
  )
  const photoAt = (key: string, angle: string) => photosOf(key).find((p) => p.angle === angle)

  watch(selected, (list) => {
    if (list.length < 2 && mode.value === 'together') mode.value = 'separate'
  })

  function toggleItem(key: string) {
    const at = selected.value.indexOf(key)
    if (at >= 0) {
      selected.value = selected.value.filter((k) => k !== key)
      // 图不删：只是这次不参与，选回来还在
      message.info(`已移除 ${outfitLabel(key)}，图还留着`)
      return
    }
    const clash = (CONFLICT[key] ?? []).filter((k) => selected.value.includes(k))
    if (selected.value.length - clash.length >= MAX_ITEMS) {
      message.warning(`最多 ${MAX_ITEMS} 件`)
      return
    }
    selected.value = [...selected.value.filter((k) => !clash.includes(k)), key]
    if (clash.length) message.info(`已取消冲突的 ${clash.map(outfitLabel).join('、')}`)
  }

  function switchMode(next: 'separate' | 'together') {
    mode.value = next
    if (next === 'separate' && look.value) message.info('合影图已收起，切回「一套合影」会还原')
  }

  /** 这一件还能放几张：每件上限与合计上限取小，到顶给原型同一句 */
  function roomOf(key: string) {
    const totalRoom = maxGarments.value - allPhotos.value.length
    if (totalRoom <= 0) {
      message.warning(`服装图最多 ${maxGarments.value} 张`)
      return 0
    }
    const room = Math.min(MAX_PHOTOS - photosOf(key).length, totalRoom)
    if (room <= 0) message.warning(`每件最多 ${MAX_PHOTOS} 张`)
    return Math.max(0, room)
  }

  /** 往某一件里放地址：给了角度就占那一格，其余顺次补空角度，都占满落「其他」 */
  function place(key: string, urls: string[], angle?: string) {
    const used = new Set(photosOf(key).map((p) => p.angle))
    const added = urls.map((url, index) => {
      let next: string
      if (index === 0 && angle && !used.has(angle)) next = angle
      else next = ANGLES.find((a) => !used.has(a)) ?? '其他'
      used.add(next)
      return { id: ++seq, url, role: key, angle: next }
    })
    photos.value = [...photos.value, ...added]
  }

  async function addFiles(key: string, files: File[], angle?: string) {
    if (!files.length || uploader.uploading.value) return
    const room = roomOf(key)
    if (room <= 0) return
    const urls = await uploader.uploadFiles(files.slice(0, room))
    if (urls.length) place(key, urls, angle)
  }

  function addUrls(key: string, picked: string[]) {
    const have = new Set(photos.value.map((p) => p.url))
    const fresh = picked.filter((u) => /^https?:\/\//i.test(u) && !have.has(u))
    if (fresh.length < picked.length) message.warning('已跳过重复或不可用的图片')
    const room = roomOf(key)
    if (room <= 0) return
    const valid = fresh.slice(0, room).filter(uploader.acceptUrl)
    if (valid.length) place(key, valid)
  }

  async function setLook(files: File[]) {
    if (!files.length || uploader.uploading.value) return
    const urls = await uploader.uploadFiles(files.slice(0, 1))
    if (urls[0]) look.value = urls[0]
  }

  function removePhoto(id: number) {
    photos.value = photos.value.filter((p) => p.id !== id)
  }

  function removeLook() {
    look.value = ''
  }

  /** 清空服装图（入口右上角删除）：单品选择留着，图全清 */
  function clear() {
    uploader.invalidate()
    photos.value = []
    look.value = ''
  }

  /** 表单重置 / 回填：单品、模式、图一起清 */
  function reset() {
    clear()
    selected.value = []
    mode.value = 'separate'
  }

  /** 整份回填（重新编辑）：不做上传、不弹提示；单品按原顺序、最多 3 件；角度撞了顺次补空角度，都占满落「其他」（同 place） */
  function restore(state: TryonGarmentState) {
    uploader.invalidate()
    selected.value = state.selected.filter((key) => !!OUTFIT_MAP[key]).slice(0, MAX_ITEMS)
    mode.value = state.mode === 'together' && selected.value.length >= 2 ? 'together' : 'separate'
    const next: GarmentPhoto[] = []
    for (const p of state.photos) {
      if (!p.url || !OUTFIT_MAP[p.role] || next.some((q) => q.url === p.url)) continue
      const used = new Set(next.filter((q) => q.role === p.role).map((q) => q.angle))
      const angle =
        (ANGLES as readonly string[]).includes(p.angle) && !used.has(p.angle)
          ? p.angle
          : (ANGLES.find((a) => !used.has(a)) ?? '其他')
      next.push({ id: ++seq, url: p.url, role: p.role, angle })
    }
    photos.value = next
    look.value = state.look
  }

  /** 把服装图拖进入口：先选单品；落到第一件没满的单品 */
  function dropOnEntry(files: File[]) {
    if (!selected.value.length) {
      message.warning('先选单品，再拖服装图')
      return
    }
    if (allPhotos.value.length >= maxGarments.value) {
      message.warning(`服装图最多 ${maxGarments.value} 张`)
      return
    }
    const target = selected.value.find((key) => photosOf(key).length < MAX_PHOTOS) ?? selected.value[0]!
    void addFiles(target, files)
  }

  /** 资产库入口要往哪一件放：没选单品 / 到顶时给原型同一句，返回 null */
  function assetTarget(): { key: string; room: number } | null {
    if (!selected.value.length) {
      message.warning('先选单品，再挑对应的服装图')
      return null
    }
    if (allPhotos.value.length >= maxGarments.value) {
      message.warning(`服装图最多 ${maxGarments.value} 张`)
      return null
    }
    const key = selected.value.find((item) => photosOf(item).length < MAX_PHOTOS) ?? selected.value[0]!
    if (photosOf(key).length >= MAX_PHOTOS) {
      message.warning(`每件最多 ${MAX_PHOTOS} 张`)
      return null
    }
    return { key, room: Math.min(MAX_PHOTOS - photosOf(key).length, maxGarments.value - allPhotos.value.length) }
  }

  return reactive({
    uploading: uploader.uploading,
    selected,
    mode,
    look,
    isTogether,
    allPhotos,
    maxGarments,
    setMaxGarments,
    photosOf,
    photoAt,
    toggleItem,
    switchMode,
    addFiles,
    addUrls,
    setLook,
    removePhoto,
    removeLook,
    clear,
    reset,
    restore,
    dropOnEntry,
    assetTarget,
  })
}

export type TryonGarment = ReturnType<typeof useTryonGarment>
