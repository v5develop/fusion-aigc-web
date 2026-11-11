<script setup lang="ts">
import { upload } from '@/api/oss-upload.ts'
import { ACCEPT_IMAGE } from '@/utils/utils'
import { useDialog, useMessage } from 'naive-ui'
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import MediaLightbox from '@/components/MediaLightbox/index.vue'
import { DROP_PASTE_HINT, ZONE_FULL_TEXT, useFileDropPaste } from '@/composables/useFileDropPaste'
import { mapWithConcurrency, useUploadBusyReporter } from '@/components/upload-busy'
import {
  UPLOAD_ENTRY_ASSET_LABEL,
  badgeClass,
  isBadgeDisabled,
  parseAspectRatio,
  resolveUploadBadges,
  type ResolvedUploadBadge,
  type UploadBadgeInput,
  type UploadBadgeVisibility,
} from './upload-badges.ts'

// 资产库选择弹窗按需加载：只有开了 fromAsset 角标的页面才会用到
const AssetPickerModal = defineAsyncComponent(() => import('@/views/studio/components/AssetPickerModal/index.vue'))

interface IProps {
  type?: 'card' // 上传控件样式
  limitNumber?: number // 限制上传张数
  exampleImages?: string[] // 示例图
  btnName?: string // 按钮名称
  multiple?: boolean
  topRightTips?: boolean // 把topRightTips=false和limitNumber=1，就能提示只能上传一张
  bottomTips?: boolean
  tryImages?: any[] // 试一试图片
  field?: string // imgList为对象数组时，取图片地址的key，默认image
  /**
   * 自定义返回处理：传了就不再写 imgList，由调用方自己入组。
   * - 一批选文件结束后调用一次，参数是这批里**上传成功**的地址（失败的留在格子里，不在参数里）；
   * - 失败格「重试」成功后会**再调用一次，参数只有重试成功的那一个地址**——调用方必须按「追加」处理，
   *   不要当成整组替换，也不要对已处理过的地址重复做校验 / 计费类副作用；
   * - 设了 limitNumber 时，选中的文件先按剩余容量截断再上传，所以累计调用的地址数不会超过余量；
   * - 「替换」与资产库替换不走这里（直接改 imgList 对应项）。
   */
  customResultHandle?: (value: string[]) => void
  customBeforeUpload?: () => boolean // 文件上传之前的回调，返回 false 会取消本次上传

  // ---- 以下为可选配置；不传时外观与行为和原来完全一致 ----
  /** 缩略图宽（px），默认 58 */
  tileSize?: number
  /** 缩略图宽高比，如 "3 / 4"、0.75；默认 1（正方形） */
  tileAspectRatio?: string | number
  /** 上传按钮文字；不传 = btnName */
  placeholderLabel?: string
  /** 每行最多几张缩略图；不传 = 按宽度自动换行（原样） */
  maxPerRow?: number
  /** 缩略图角标（replace / delete / preview / fromAsset 或自定义）；默认不开，沿用原来的黑色删除小圆钮 */
  badgeActions?: UploadBadgeInput[]
  /** 角标显隐：hover（悬停 / 聚焦时出现，默认）| always（常显）；单个角标可再覆盖 */
  badgeVisibility?: UploadBadgeVisibility
  /** 还没有图片时，在按钮下方显示的一行提示；默认不显示 */
  emptyText?: string
  /** 删除前二次确认；true 用默认文案，传字符串作确认文案；默认不确认（原样） */
  confirmDelete?: boolean | string
  /** 上传按钮旁出「从资产库添加」文字入口（只开入口，不开缩略图角标，删除钮等外观不变）；默认不开 */
  fromAsset?: boolean
  /** 页面上有多个上传区、又没悬停在任何一个上时，粘贴（Ctrl/⌘+V）交给它；一页最多标一个 */
  pastePrimary?: boolean
}
const {
  type = 'default',
  limitNumber,
  exampleImages,
  multiple = false,
  topRightTips = true,
  bottomTips,
  btnName = '上传产品图',
  field = 'image',
  customResultHandle,
  customBeforeUpload = () => true,
  tileSize = 58,
  tileAspectRatio,
  placeholderLabel,
  maxPerRow,
  badgeActions,
  badgeVisibility = 'hover',
  emptyText,
  confirmDelete = false,
  fromAsset = false,
  pastePrimary = false,
} = defineProps<IProps>()

const emit = defineEmits<{
  /** 角标被点击（内置动作照常执行；自定义 key 只发这个事件） */
  'badge-click': [key: string, index: number]
}>()
const imgList = defineModel<any[]>('imgList', {
  default: () => [],
})
/** 是否有上传在进行（含替换）；父级可 v-model:uploading 拦提交 */
const uploadingModel = defineModel<boolean>('uploading', { default: false })
/** 是否留有上传失败的格子；父级可 v-model:failed 拦提交 */
const failedModel = defineModel<boolean>('failed', { default: false })

const message = useMessage()
const dialog = useDialog()
const uploadRef = ref<HTMLInputElement | null>(null)

// ---------------- 逐张上传状态（原型 MlReferenceSlots：上传中 / 上传失败叠在格子里，失败可重试） ----------------
interface PendingUpload {
  id: number
  file: File
  /** 本地预览（objectURL），上传中 / 失败时垫在遮罩下 */
  preview: string
  status: 'uploading' | 'failed'
}
let pendingSeq = 0
const pending = ref<PendingUpload[]>([])
/**
 * 正在替换的那一张：记旧地址而不是下标——替换期间用户可能删掉 / 父级重排别的图，
 * 完成时按旧地址重新定位，找不到就丢弃结果，绝不覆盖到别的图上。
 */
const replacingUrl = ref<string | null>(null)
const uploadingCount = computed(() => pending.value.filter((p) => p.status === 'uploading').length)
const failedCount = computed(() => pending.value.filter((p) => p.status === 'failed').length)
// 原 loading 语义：有上传在进行时禁用拖入 / 资产库入口
const loading = computed(() => replacingUrl.value !== null || uploadingCount.value > 0)

// 卸载后上传回调一律不再动 imgList / customResultHandle（页面已离开，回写会落到别的表单状态上）
let unmounted = false

const dropPending = (id: number) => {
  const idx = pending.value.findIndex((p) => p.id === id)
  if (idx < 0) return
  URL.revokeObjectURL(pending.value[idx]!.preview)
  pending.value.splice(idx, 1)
}
onBeforeUnmount(() => {
  unmounted = true
  pending.value.forEach((p) => URL.revokeObjectURL(p.preview))
})

/*
 * 失败格的计数口径（两处刻意不同）：
 * - occupied（已传 + 上传中 + 失败）：只用于「还能再加几张」的容量判断与提示（选文件截断、拖入 / 粘贴 max、资产库余量），
 *   因为失败格随时可能重试成功，不算进去会超限；
 * - limitReached（已传 + 上传中，不含失败）：只决定上传按钮是否隐藏——失败格不该把入口藏掉，
 *   点了按钮若余量被失败格占满，会提示先移除失败的图片。
 */
const occupied = computed(() => imgList.value.length + pending.value.length)
const limitReached = computed(() => !!limitNumber && imgList.value.length + uploadingCount.value >= limitNumber)

/** 容量已满时的提示：余量被失败格占着就说清楚怎么腾 */
const warnFull = () =>
  message.warning(
    failedCount.value && imgList.value.length + uploadingCount.value < (limitNumber ?? 1)
      ? `最多上传${limitNumber ?? 1}张图片，请先重试或移除上传失败的图片`
      : `最多上传${limitNumber ?? 1}张图片`,
  )

// 父级把列表清空（如提交后重置表单）：失败格一并收掉；上传中的不动，传完照常入组
watch(
  () => [imgList.value, imgList.value.length] as const,
  ([list, len], [prevList, prevLen]) => {
    if (len === 0 && (list !== prevList || prevLen > 0)) dismissFailed()
  },
)

// 忙碌状态：v-model:uploading / v-model:failed + 外壳登记（uploadBusy.ts）
watch(loading, (v) => (uploadingModel.value = v), { immediate: true })
watch(failedCount, (n) => (failedModel.value = n > 0), { immediate: true })
useUploadBusyReporter('image', () => ({ uploading: loading.value, failed: failedCount.value > 0 }))

// 只能传 1 张时，让按钮与图片共用一个固定高度的槽位。
// 否则上传瞬间按钮消失(-72)、图片出现(+58)，净 -14，整个上传框会跳一下。
const singleSlot = computed(() => limitNumber === 1)

const deleteImg = (index: number) => {
  imgList.value.splice(index, 1)
}

// ---------------- 可选配置 ----------------
const triggerLabel = computed(() => placeholderLabel ?? btnName)
const tileHeight = computed(() => Math.round(tileSize / parseAspectRatio(tileAspectRatio)))
// 每行张数：缩略图之间 gap 4
const rowStyle = computed(() =>
  maxPerRow ? { maxWidth: `${maxPerRow * tileSize + (maxPerRow - 1) * 4}px` } : undefined,
)
const badges = computed(() => resolveUploadBadges(badgeActions, 'image', badgeVisibility))
const hasBadges = computed(() => badges.value.length > 0)
const entryAssetBadge = computed(
  () =>
    badges.value.find((b) => b.key === 'fromAsset') ??
    (fromAsset ? resolveUploadBadges(['fromAsset'], 'image', badgeVisibility)[0] : undefined),
)

const urlOf = (item: any): string => item?.[field] ?? item
// 格子遮罩字号：原型 14/600；默认 58 的小格放不下「上传失败 + 重试」，退到 12
const statusFont = computed(() => (Math.min(tileSize, tileHeight.value) >= 80 ? '14px' : '12px'))

/** 删除（角标入口）：调用方开了 confirmDelete 才二次确认 */
const removeAt = (index: number) => {
  if (!confirmDelete) return deleteImg(index)
  dialog.warning({
    title: '移除图片',
    content: typeof confirmDelete === 'string' ? confirmDelete : '确定移除这张图片吗？',
    positiveText: '移除',
    negativeText: '取消',
    onPositiveClick: () => deleteImg(index),
  })
}

/** 替换第 index 张：对象项只改图片地址字段，其余字段保留 */
const setAt = (index: number, url: string) => {
  const old = imgList.value[index]
  imgList.value.splice(index, 1, old && typeof old === 'object' ? { ...old, [field]: url } : url)
}
/** 正在替换的格子下标（按旧地址实时定位，原图被删则为 null） */
const replacingAt = computed(() => {
  if (replacingUrl.value === null) return null
  const i = imgList.value.findIndex((it) => urlOf(it) === replacingUrl.value)
  return i >= 0 ? i : null
})

// 替换：复用同一个 input，单选；同一时间只替换一张
const replaceIndex = ref<number | null>(null)
const openReplace = (index: number) => {
  if (replacingUrl.value !== null || !customBeforeUpload?.()) return
  replaceIndex.value = index
  uploadRef.value!.multiple = false
  uploadRef.value!.click()
}

// 预览：全屏灯箱，带上本组件全部图片（←/→ 切换、缩放、下载）
const previewShow = ref(false)
const previewIndex = ref(0)
const previewItems = computed(() => imgList.value.map((it) => ({ url: urlOf(it), type: 'image' as const })))
const openPreview = (index: number) => {
  previewIndex.value = index
  previewShow.value = true
}

// 资产库：index = -1 表示追加，否则替换该张
const assetShow = ref(false)
const assetIndex = ref(-1)
const assetLimit = computed(() => (assetIndex.value >= 0 ? 1 : Math.max(1, (limitNumber ?? 1) - occupied.value)))
const openAsset = (index: number) => {
  if (loading.value || !customBeforeUpload?.()) return
  if (index < 0 && limitNumber && occupied.value >= limitNumber) return warnFull()
  assetIndex.value = index
  assetShow.value = true
}
const onAssetSelect = (urls: string[]) => {
  if (!urls.length) return
  if (assetIndex.value >= 0) return setAt(assetIndex.value, urls[0]!)
  if (customResultHandle) return customResultHandle(urls)
  const fresh = urls.filter((u) => !imgList.value.some((it) => urlOf(it) === u))
  imgList.value.push(...fresh.slice(0, (limitNumber ?? 1) - occupied.value))
}

const onBadge = (badge: ResolvedUploadBadge, index: number) => {
  if (isBadgeDisabled(badge, index)) return
  emit('badge-click', badge.key, index)
  if (badge.onClick) return badge.onClick(index)
  if (badge.key === 'delete') removeAt(index)
  else if (badge.key === 'replace') openReplace(index)
  else if (badge.key === 'preview') openPreview(index)
  else if (badge.key === 'fromAsset') openAsset(index)
}

const handleUpload = async (e: Event) => {
  const target = e.target as HTMLInputElement
  const files = target.files
  if (!files || files.length === 0) return
  uploadFiles(Array.from(files))
}

/** 成功地址入组：与原来一次性 push / customResultHandle 同口径 */
const commitUrls = (urls: string[]) => {
  if (unmounted || !urls.length) return
  if (customResultHandle) return customResultHandle(urls)
  imgList.value.push(...urls.slice(0, Math.max(0, (limitNumber ?? 1) - imgList.value.length)))
}

const resetInput = () => {
  if (!uploadRef.value) return
  uploadRef.value.value = ''
  uploadRef.value.multiple = multiple
}

/** 单张上传（失败返回 null，由格子遮罩提示，不再只弹 toast） */
const uploadOne = (file: File) =>
  upload([file])
    .then((urls) => urls[0] ?? null)
    .catch(() => null)

/** 选文件 / 拖入 / 粘贴共用的校验 + 上传 */
const uploadFiles = (fileArray: File[]) => {
  // 校验是否为图片类型
  for (const file of fileArray) {
    if (!file.type.startsWith('image/')) {
      replaceIndex.value = null
      uploadRef.value!.multiple = multiple
      return message.warning(`${file.name} 不是有效的图片`)
    }
  }
  const replacing = replaceIndex.value
  replaceIndex.value = null

  // 替换：遮罩叠在该格上；失败保留原图。完成时按旧地址重新定位，原图已不在就丢弃
  if (replacing !== null) {
    const oldUrl = urlOf(imgList.value[replacing])
    if (oldUrl == null) return resetInput()
    replacingUrl.value = oldUrl
    uploadOne(fileArray[0]!)
      .then((url) => {
        if (unmounted) return
        if (!url) return message.error('图片上传失败，请重试')
        const idx = imgList.value.findIndex((it) => urlOf(it) === oldUrl)
        if (idx >= 0) setAt(idx, url)
      })
      .finally(() => {
        if (unmounted) return
        replacingUrl.value = null
        resetInput()
      })
    return
  }

  // 追加：设了 limitNumber 一律按余量截断（含 customResultHandle）；
  // 没设时沿用原口径——自定义处理收全部，否则只收 1 张
  const capacity = limitNumber ?? (customResultHandle ? Infinity : 1)
  const files = fileArray.slice(0, Math.max(0, capacity - occupied.value))
  if (!files.length) return resetInput()
  const batch = files.map((file) => ({
    id: ++pendingSeq,
    file,
    preview: URL.createObjectURL(file),
    status: 'uploading' as const,
  }))
  pending.value.push(...batch)
  resetInput()

  // 最多 3 张并行；全部结束后一次性入组（customResultHandle 调用方按一次拿全部地址的约定）
  mapWithConcurrency(batch, 3, (b) => uploadOne(b.file)).then((urls) => {
    if (unmounted) return
    const ok: string[] = []
    batch.forEach((b, i) => {
      const url = urls[i]
      if (url) {
        ok.push(url)
        dropPending(b.id)
      } else {
        const item = pending.value.find((p) => p.id === b.id)
        if (item) item.status = 'failed'
      }
    })
    commitUrls(ok)
  })
}

/** 失败格「重试」 */
const retryPending = (id: number) => {
  const item = pending.value.find((p) => p.id === id)
  if (!item || item.status === 'uploading') return
  item.status = 'uploading'
  uploadOne(item.file).then((url) => {
    if (unmounted) return
    const cur = pending.value.find((p) => p.id === id)
    if (!cur) return
    if (!url) {
      cur.status = 'failed'
      return
    }
    dropPending(id)
    commitUrls([url])
  })
}
const retryAllFailed = () => pending.value.filter((p) => p.status === 'failed').forEach((p) => retryPending(p.id))
const dismissFailed = () => pending.value.filter((p) => p.status === 'failed').forEach((p) => dropPending(p.id))

/** 追加前的统一检查（选文件 / 拖入 / 粘贴同一套） */
const canAppend = () => {
  if (!customBeforeUpload?.()) return false
  // 上次「替换」若取消了选文件，这里清掉，避免普通上传被当成替换
  replaceIndex.value = null
  uploadRef.value!.multiple = multiple

  if (limitNumber && occupied.value >= limitNumber) {
    warnFull()
    return false
  }
  return true
}

const beforeUpload = () => {
  if (!canAppend()) return
  uploadRef.value!.click()
}

// 拖入 / 粘贴：与选文件走同一套检查和上传
const dropRef = ref<HTMLElement | null>(null)
const { dragging } = useFileDropPaste(dropRef, {
  accept: 'image',
  multiple: () => multiple,
  max: () => (limitNumber ? limitNumber - occupied.value : undefined),
  disabled: loading,
  disabledMessage: '图片还在上传，请稍候',
  fullMessage: () => (failedCount.value ? `${ZONE_FULL_TEXT}，请先重试或移除上传失败的图片` : undefined),
  pastePrimary: () => pastePrimary,
  onFiles: (files) => {
    if (canAppend()) uploadFiles(files)
  },
})

const tryClick = (url: string) => {
  if (imgList.value.includes(url)) return

  if (limitNumber && occupied.value >= limitNumber) return warnFull()

  imgList.value.push(url)
}

// 样式（规范 §5.9 上传槽、§4.1 按钮、§4.2 动效）：1px 控件描边 + 白→#f9fafb，r8；hover 描边 violet-line、底 →#fbf7fd
const ZONE =
  'relative flex flex-col items-center pb-16px overflow-hidden rounded-lg border border-solid border-control sx-grad-upload ' +
  'transition-colors duration-mid ease-sx hover:(border-violet-line to-upload-hover-bottom) motion-reduce:transition-none'
// 右上角「支持多图」角标：柔紫底 + 紫字，左下圆角与槽位 r8 一致
const LIMIT_TIPS =
  'absolute top-0 right-0 w-124px h-24px flex items-center justify-center text-12px rounded-[0_8px] bg-violet-soft text-violet-ink'
// 上传按钮：默认按钮材质（§4.1 .sx-btn），保持原 40 高、最小宽 130
const UPLOAD_BTN =
  'sx-btn !h-40px min-w-130px !px-16px !gap-8px !text-14px [font-family:inherit] ' +
  'transition-[border-color,color,box-shadow] duration-fast ease-sx motion-reduce:transition-none'
// 删除小圆钮
const DELETE_BTN =
  'absolute top-4px right-4px w-20px h-20px p-0 rounded-full flex items-center justify-center cursor-pointer ' +
  'bg-ink hover:opacity-90 sx-focus after:(content-empty absolute -inset-6px rounded-full) [@media(pointer:coarse)]:after:-inset-12px'
// card 型触发块：与上传槽同材质；格子档位 r12（内部缩略 r11）
const CARD_TRIGGER =
  'w-full h-full p-0 flex flex-col items-center justify-center gap-4px cursor-pointer rounded-12px [font-family:inherit] ' +
  'border border-solid border-control sx-grad-upload hover:(border-violet-line to-upload-hover-bottom) active:scale-[0.98] ' +
  'transition-[border-color,transform] duration-mid ease-sx motion-reduce:transition-none sx-focus'
// 失败格的移除钮：压在格子右上角外沿，不和居中的「上传失败 / 重试」抢位（小格 58 放不下三样）
const PENDING_REMOVE_BTN =
  'absolute -top-6px -right-6px z-20 w-20px h-20px p-0 rounded-full flex items-center justify-center cursor-pointer border border-solid border-white ' +
  'bg-ink hover:opacity-90 sx-focus after:(content-empty absolute -inset-6px rounded-full) [@media(pointer:coarse)]:after:-inset-12px'
// 缩略格：r12 外框 + 1px 描边，图片内圆角 11（跟随格子）
const TILE_FRAME = 'relative w-full h-full overflow-hidden rounded-12px border border-solid border-line bg-surface3'
const TILE_IMG = 'block w-full h-full object-cover rounded-11px cursor-zoom-in'
// 上传中 / 失败遮罩（原型 .ml-role__status：rgba(31,35,41,.35) + 白字 600）
const STATUS_MASK =
  'absolute inset-0 z-10 flex flex-col items-center justify-center gap-2px rounded-[inherit] bg-[rgba(31,35,41,0.35)] text-white font-600 text-center'
const SPINNER =
  'block w-16px h-16px rounded-full border-2 border-solid border-white/40 border-t-white animate-spin motion-reduce:animate-none'
// 重试：视觉 24 高，after 外扩到 ≥32 命中（§10 可点区域）
const RETRY_BTN =
  'relative h-24px px-10px rounded-full border-none bg-white/92 text-ink text-12px font-500 leading-none cursor-pointer ' +
  'hover:bg-white sx-focus after:(content-empty absolute -inset-4px rounded-full) [@media(pointer:coarse)]:after:-inset-8px'
</script>

<template>
  <input
    ref="uploadRef"
    type="file"
    :accept="ACCEPT_IMAGE"
    :multiple="multiple"
    id="file-upload"
    @change="handleUpload"
    class="hidden"
  />

  <div v-if="type === 'default'" class="relative">
    <div ref="dropRef" :class="[ZONE, dragging && 'sx-drop']">
      <div v-if="limitNumber && topRightTips" :class="LIMIT_TIPS">支持多图(最多{{ limitNumber }}张)</div>

      <!-- 只能传 1 张时：按钮与图片共用一个固定 58px（一张图高）的槽位，上传/删除不改变整体高度，
           图片正好落在按钮原来的位置。否则按钮消失(-72) 与图片出现(+58) 不抵消，会跳 -14。
           槽位内顶部对齐：按钮保持原本 32px 的上边距位置，上下留白 32 / 34 基本对称 -->
      <div class="w-full flex flex-col items-center" :class="singleSlot ? 'mt-32px h-58px' : ''">
        <template v-if="!limitReached">
          <!-- #empty：上传入口；作用域 { open, openAsset, count, limit } -->
          <slot
            name="empty"
            :open="beforeUpload"
            :open-asset="() => openAsset(-1)"
            :count="imgList.length"
            :limit="limitNumber"
          >
            <!-- flex 包一层：按钮作 flex 项，不产生行盒，尺寸与原来直接放按钮时一致 -->
            <div class="relative flex items-center gap-8px" :class="singleSlot ? 'mt-0' : 'mt-32px'">
              <button type="button" :class="UPLOAD_BTN" :title="DROP_PASTE_HINT" @click="beforeUpload">
                <i class="icon-ic_ds_CloudUpload1 text-20px" aria-hidden="true"></i>
                <span>{{ triggerLabel }}</span>
              </button>
              <!-- 开了 fromAsset 才有：与上传按钮同一行的文字入口 -->
              <button
                v-if="entryAssetBadge"
                type="button"
                class="sx-btn-ghost !h-40px !px-12px !text-14px text-violet"
                :aria-label="UPLOAD_ENTRY_ASSET_LABEL.image"
                :title="UPLOAD_ENTRY_ASSET_LABEL.tooltip"
                :disabled="loading || isBadgeDisabled(entryAssetBadge, -1)"
                @click.stop="onBadge(entryAssetBadge, -1)"
              >
                {{ UPLOAD_ENTRY_ASSET_LABEL.tooltip }}
              </button>
            </div>
          </slot>
          <p v-if="emptyText && imgList.length === 0" class="m-0 mt-8px text-12px leading-18px text-placeholder">
            {{ emptyText }}
          </p>
        </template>

        <div v-if="exampleImages" class="h-44px mt-8px flex items-center gap-4px text-placeholder">
          <span>示例</span>
          <template v-for="item in exampleImages" :key="item">
            <n-popover trigger="hover">
              <template #trigger>
                <img class="h-44px rounded-sm" :src="item" alt="" />
              </template>
              <img :src="item" alt="" />
            </n-popover>
          </template>
        </div>

        <div
          class="flex flex-wrap items-center justify-center gap-4px"
          :class="singleSlot ? 'mt-0' : 'mt-8px'"
          :style="rowStyle"
        >
          <div
            class="group relative cursor-pointer"
            :style="{ width: `${tileSize}px`, height: `${tileHeight}px` }"
            v-for="(item, i) in imgList"
            :key="item"
          >
            <!-- #tile：已传图片；作用域 { item, index, url, remove, replace, preview } -->
            <slot
              name="tile"
              :item="item"
              :index="i"
              :url="urlOf(item)"
              :remove="() => removeAt(i)"
              :replace="() => openReplace(i)"
              :preview="() => openPreview(i)"
            >
              <div :class="TILE_FRAME">
                <img :src="urlOf(item)" alt="" :class="TILE_IMG" @click="openPreview(i)" />
              </div>

              <button v-if="!hasBadges" type="button" :class="DELETE_BTN" aria-label="删除图片" @click="deleteImg(i)">
                <i class="icon-ic_ds_return-2 text-white text-12px" aria-hidden="true"></i>
              </button>
            </slot>

            <!-- 角标（badgeActions）：原型 .sx-medbtn，位置 / 显隐见 uploadBadges.ts -->
            <button
              v-for="b in badges"
              :key="b.key"
              type="button"
              :class="badgeClass(b)"
              :aria-label="b.label"
              :title="b.tooltip"
              :disabled="isBadgeDisabled(b, i)"
              @click.stop="onBadge(b, i)"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path :d="b.path" />
              </svg>
            </button>

            <!-- 替换中：遮罩叠在该格 -->
            <div v-if="replacingAt === i" :class="STATUS_MASK" role="status" :style="{ fontSize: statusFont }">
              <span :class="SPINNER" aria-hidden="true"></span>
              <span>上传中</span>
            </div>
          </div>

          <!-- 上传中 / 上传失败：占同一个格子，失败可重试或移除 -->
          <div
            v-for="p in pending"
            :key="`pending-${p.id}`"
            class="relative"
            :style="{ width: `${tileSize}px`, height: `${tileHeight}px` }"
          >
            <div :class="TILE_FRAME">
              <img :src="p.preview" alt="" class="block w-full h-full object-cover rounded-11px" />
            </div>
            <div v-if="p.status === 'uploading'" :class="STATUS_MASK" role="status" :style="{ fontSize: statusFont }">
              <span :class="SPINNER" aria-hidden="true"></span>
              <span>上传中</span>
            </div>
            <div v-else :class="STATUS_MASK" role="alert" :style="{ fontSize: statusFont }">
              <span class="leading-16px">上传失败</span>
              <button
                type="button"
                :class="RETRY_BTN"
                :aria-label="`重试上传 ${p.file.name}`"
                @click.stop="retryPending(p.id)"
              >
                重试
              </button>
              <button
                type="button"
                :class="PENDING_REMOVE_BTN"
                aria-label="移除上传失败的图片"
                @click.stop="dropPending(p.id)"
              >
                <i class="icon-ic_ds_return-2 text-white text-12px" aria-hidden="true"></i>
              </button>
            </div>
          </div>
        </div>
      </div>

      <slot></slot>

      <!-- #footer：上传槽底部条；不传 = 原来的 bottomTips 提示条 -->
      <slot name="footer">
        <div
          v-if="bottomTips"
          class="w-full h-36px mt-auto relative -bottom-16px flex items-center px-12px text-12px bg-warning-soft text-warning"
        >
          请上传清晰且能够尽量展示商品全貌的图片
        </div>
      </slot>
    </div>

    <!-- 试一试：收窄左右内边距（8px）给 7 张试用图腾出宽度 -->
    <div v-if="tryImages" class="mt-12px px-8px h-44px rounded-lg bg-surface3 flex items-center">
      <span class="text-12px text-placeholder pr-4px flex-shrink-0">试一试</span>
      <!-- 按内容收缩而非占满剩余宽度：排不下时压缩到可用宽度并横向滚动；隐藏滚动条，靠滚轮/触控板横滑 -->
      <div
        class="flex-[0_1_auto] min-w-0 h-[90%] flex items-center gap-4px overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <template v-for="item in tryImages" :key="item">
          <n-popover trigger="hover">
            <template #trigger>
              <img
                class="h-full aspect-square rounded-lg object-cover cursor-pointer"
                :src="item"
                alt=""
                @click="tryClick(item)"
              />
            </template>
            <img :src="item" alt="" />
          </n-popover>
        </template>
      </div>
    </div>
  </div>

  <div
    v-else-if="type === 'card'"
    ref="dropRef"
    class="relative w-full h-full rounded-12px"
    :class="dragging && $slots.empty && 'sx-drop-ring'"
  >
    <slot
      name="empty"
      :open="beforeUpload"
      :open-asset="() => openAsset(-1)"
      :count="imgList.length"
      :limit="limitNumber"
    >
      <div class="relative w-full h-full">
        <button type="button" :class="[CARD_TRIGGER, dragging && 'sx-drop']" @click="beforeUpload">
          <i class="icon-ic_ds_CloudUpload1 text-20px text-ink-2" aria-hidden="true"></i>
          <span class="text-14px leading-20px text-ink-2">{{ triggerLabel }}</span>
          <!-- 空卡写明「待上传」（原型 .ml-role__empty-text 12/16 placeholder，与上方间距 4）；传了 emptyText 用调用方文案 -->
          <span v-if="imgList.length === 0" class="text-12px leading-16px text-placeholder">
            {{ emptyText || '待上传' }}
          </span>
        </button>
        <!-- 卡片本身就是一格：云钮放右下角内缩 4（原型 ProductPipeSlots .ptile__icon） -->
        <button
          v-if="entryAssetBadge"
          type="button"
          class="absolute right-8px bottom-8px px-4px text-12px leading-18px text-violet bg-transparent border-none cursor-pointer rounded-sm hover:underline disabled:(opacity-45 cursor-not-allowed) sx-focus"
          :aria-label="UPLOAD_ENTRY_ASSET_LABEL.image"
          :title="UPLOAD_ENTRY_ASSET_LABEL.tooltip"
          :disabled="loading || isBadgeDisabled(entryAssetBadge, -1)"
          @click.stop="onBadge(entryAssetBadge, -1)"
        >
          {{ UPLOAD_ENTRY_ASSET_LABEL.tooltip }}
        </button>
      </div>
    </slot>

    <!-- 卡片整格的上传状态：上传中优先，其次失败（重试 / 关闭） -->
    <div v-if="uploadingCount" :class="STATUS_MASK" class="text-14px" role="status">
      <span :class="SPINNER" aria-hidden="true"></span>
      <span>上传中{{ uploadingCount > 1 ? `（${uploadingCount}）` : '' }}</span>
    </div>
    <div v-else-if="failedCount" :class="STATUS_MASK" class="text-14px gap-8px" role="alert">
      <span>上传失败{{ failedCount > 1 ? `（${failedCount}）` : '' }}</span>
      <button type="button" :class="RETRY_BTN" @click.stop="retryAllFailed">重试</button>
      <button type="button" :class="DELETE_BTN" aria-label="关闭上传失败提示" @click.stop="dismissFailed">
        <i class="icon-ic_ds_return-2 text-white text-12px" aria-hidden="true"></i>
      </button>
    </div>
  </div>

  <!-- 放大查看（缩略图点击 / 角标 preview / #tile 的 preview()）：全屏灯箱，带全部图片 -->
  <MediaLightbox v-model:show="previewShow" v-model:index="previewIndex" :items="previewItems" />

  <AssetPickerModal v-if="entryAssetBadge" v-model:show="assetShow" :limit="assetLimit" @select="onAssetSelect" />
</template>
