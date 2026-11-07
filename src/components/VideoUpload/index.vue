<script lang="ts">
export interface IVideoItem {
  url: string
  thumbnail?: string
  name?: string
}
</script>

<script setup lang="ts">
import { upload } from '@/api/ossUpload.ts'
import IconButton from '@/components/IconButton/index.vue'
import { ACCEPT_VIDEO } from '@/utils/utils'
import { useDialog, useMessage } from 'naive-ui'
import { computed, defineAsyncComponent, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import MediaLightbox from '@/components/MediaLightbox/index.vue'
import { useFileDropPaste } from '@/composables/useFileDropPaste'
import { mapWithConcurrency, useUploadBusyReporter } from '@/components/uploadBusy'
import {
  UPLOAD_ENTRY_ASSET_LABEL,
  badgeClass,
  isBadgeDisabled,
  parseAspectRatio,
  resolveUploadBadges,
  type ResolvedUploadBadge,
  type UploadBadgeInput,
  type UploadBadgeVisibility,
} from '../ImageUpload/uploadBadges.ts'

// 资产库选择弹窗按需加载：只有开了 fromAsset 角标的页面才会用到
const AssetPickerModal = defineAsyncComponent(() => import('@/views/studio/components/AssetPickerModal/index.vue'))

interface IProps {
  limitNumber?: number // 限制上传个数
  btnName?: string // 按钮名称
  multiple?: boolean
  bottomTips?: boolean

  // ---- 以下为可选配置；不传时外观与行为和原来完全一致 ----
  /** 视频缩略图宽（px），默认 48 */
  tileSize?: number
  /** 缩略图宽高比，如 "16 / 9"、0.5625；默认 1（正方形） */
  tileAspectRatio?: string | number
  /** 上传按钮文字；不传 = btnName */
  placeholderLabel?: string
  /** 每行几条视频；默认 1（竖排，原样） */
  maxPerRow?: number
  /** 视频行角标（replace / delete / preview / fromAsset 或自定义）；默认不开，沿用原来的行尾删除小圆钮 */
  badgeActions?: UploadBadgeInput[]
  /** 角标显隐：hover（悬停 / 聚焦时出现，默认）| always（常显）；单个角标可再覆盖 */
  badgeVisibility?: UploadBadgeVisibility
  /** 还没有视频时，在按钮下方显示的一行提示；默认不显示 */
  emptyText?: string
  /** 删除前二次确认；true 用默认文案，传字符串作确认文案；默认不确认（原样） */
  confirmDelete?: boolean | string
  /** 上传按钮旁出「从资产库添加」文字入口（只开入口，不开视频行角标，删除钮等外观不变）；默认不开 */
  fromAsset?: boolean
}
const {
  limitNumber,
  multiple = false,
  bottomTips,
  btnName = '上传视频',
  tileSize = 48,
  tileAspectRatio,
  placeholderLabel,
  maxPerRow = 1,
  badgeActions,
  badgeVisibility = 'hover',
  emptyText,
  confirmDelete = false,
  fromAsset = false,
} = defineProps<IProps>()

const emit = defineEmits<{
  /** 角标被点击（内置动作照常执行；自定义 key 只发这个事件） */
  'badge-click': [key: string, index: number]
}>()
const videoList = defineModel<IVideoItem[]>('videoList', { required: true })
/** 是否有上传在进行（含替换 / 资产库取封面）；父级可 v-model:uploading 拦提交 */
const uploadingModel = defineModel<boolean>('uploading', { default: false })
/** 是否留有上传失败的格子；父级可 v-model:failed 拦提交 */
const failedModel = defineModel<boolean>('failed', { default: false })

// 本地状态，用于实时更新UI
const localVideoList = ref<IVideoItem[]>([])

// 同步外部 videoList 到本地状态
watch(
  () => videoList.value,
  (newVal) => {
    if (newVal && newVal.length > 0) {
      localVideoList.value = [...newVal]
    } else {
      localVideoList.value = []
    }
  },
  { immediate: true },
)

const loading = ref(false)

// ---------------- 逐条上传状态（原型 MlReferenceSlots：上传中 / 上传失败叠在格子里，失败可重试） ----------------
interface PendingUpload {
  id: number
  file: File
  status: 'uploading' | 'failed'
}
let pendingSeq = 0
const pending = ref<PendingUpload[]>([])
/**
 * 正在替换的那一条：记旧地址而不是下标——替换期间用户可能删掉别的视频，
 * 完成时按旧地址重新定位，找不到就丢弃结果，绝不覆盖到别的视频上。
 */
const replacingUrl = ref<string | null>(null)
const replacingAt = computed(() => {
  if (replacingUrl.value === null) return null
  const i = localVideoList.value.findIndex((v) => v.url === replacingUrl.value)
  return i >= 0 ? i : null
})
const uploadingCount = computed(() => pending.value.filter((p) => p.status === 'uploading').length)
const failedCount = computed(() => pending.value.filter((p) => p.status === 'failed').length)
// 原 loading 语义：有上传在进行时禁用拖入 / 资产库入口
const busy = computed(() => loading.value || replacingUrl.value !== null || uploadingCount.value > 0)
const limit = computed(() => limitNumber ?? 1)
/*
 * 失败格的计数口径（两处刻意不同）：
 * - occupied（已传 + 上传中 + 失败）：只用于「还能再加几个」的容量判断与提示（选文件截断、拖入 / 粘贴 max、资产库余量），
 *   因为失败格随时可能重试成功，不算进去会超限；
 * - shown（已传 + 上传中，不含失败）：只决定上传按钮是否隐藏——失败格不该把入口藏掉，
 *   点了按钮若余量被失败格占满，会提示先移除失败的视频。
 */
const occupied = computed(() => localVideoList.value.length + pending.value.length)
const shown = computed(() => localVideoList.value.length + uploadingCount.value)
const dropPending = (id: number) => {
  const idx = pending.value.findIndex((p) => p.id === id)
  if (idx >= 0) pending.value.splice(idx, 1)
}
const dismissFailed = () => pending.value.filter((p) => p.status === 'failed').forEach((p) => dropPending(p.id))

// 卸载后上传回调一律不再写 videoList（页面已离开，回写会落到别的表单状态上）
let unmounted = false
onBeforeUnmount(() => (unmounted = true))

// 父级把列表清空（如提交后重置表单）：失败格一并收掉；上传中的不动，传完照常入组
watch(
  () => [videoList.value, videoList.value?.length ?? 0] as const,
  ([list, len], [prevList, prevLen]) => {
    if (len === 0 && (list !== prevList || prevLen > 0)) dismissFailed()
  },
)

// 忙碌状态：v-model:uploading / v-model:failed + 外壳登记（uploadBusy.ts）
watch(busy, (v) => (uploadingModel.value = v), { immediate: true })
watch(failedCount, (n) => (failedModel.value = n > 0), { immediate: true })
useUploadBusyReporter('video', () => ({ uploading: busy.value, failed: failedCount.value > 0 }))

const message = useMessage()
const warnFull = () =>
  message.warning(
    failedCount.value && shown.value < limit.value
      ? `最多上传${limit.value}个视频，请先重试或移除上传失败的视频`
      : `最多上传${limit.value}个视频`,
  )
const dialog = useDialog()
const uploadRef = ref<HTMLInputElement | null>(null)

const deleteVideo = (index: number) => {
  localVideoList.value.splice(index, 1)
  // 同步到父组件
  videoList.value = [...localVideoList.value]
}

// 从视频URL获取缩略图
const extractVideoThumbnail = async (videoUrl: string): Promise<string> => {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.preload = 'metadata'
    video.src = videoUrl
    video.muted = true // 静音以避免自动播放策略限制

    const cleanup = () => {
      video.removeEventListener('seeked', handleSeeked)
      video.removeEventListener('error', handleError)
      video.removeEventListener('loadedmetadata', handleLoaded)
    }

    const handleSeeked = () => {
      try {
        const canvas = document.createElement('canvas')
        const width = video.videoWidth || 48
        const height = video.videoHeight || 48
        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(video, 0, 0, width, height)
          const thumbnail = canvas.toDataURL('image/png')
          cleanup()
          resolve(thumbnail)
        } else {
          cleanup()
          resolve(getDefaultThumbnail())
        }
      } catch {
        cleanup()
        resolve(getDefaultThumbnail())
      }
    }

    const handleLoaded = () => {
      video.currentTime = 0.5 // 设置时间后等待 seeked 事件
    }

    const handleError = () => {
      cleanup()
      resolve(getDefaultThumbnail())
    }

    video.addEventListener('seeked', handleSeeked)
    video.addEventListener('loadedmetadata', handleLoaded)
    video.addEventListener('error', handleError)
    video.load()
  })
}

// 获取默认缩略图
const getDefaultThumbnail = (): string => {
  // 创建一个简单的视频图标作为默认缩略图
  const canvas = document.createElement('canvas')
  canvas.width = 48
  canvas.height = 48
  const ctx = canvas.getContext('2d')
  if (ctx) {
    // 灰色背景（sunken #eff1f3）
    ctx.fillStyle = '#eff1f3'
    ctx.fillRect(0, 0, 48, 48)
    // 播放按钮形状（muted #5f6673）
    ctx.fillStyle = '#5f6673'
    ctx.beginPath()
    ctx.moveTo(16, 12)
    ctx.lineTo(36, 24)
    ctx.lineTo(16, 36)
    ctx.closePath()
    ctx.fill()
  }
  return canvas.toDataURL('image/png')
}

// 获取文件名
const getFileName = (url: string): string => {
  const parts = url.split('/')
  const fileName = parts[parts.length - 1]
  return fileName?.split('?')[0] || 'video.mp4'
}

// ---------------- 可选配置 ----------------
const triggerLabel = computed(() => placeholderLabel ?? btnName)
const thumbHeight = computed(() => Math.round(tileSize / parseAspectRatio(tileAspectRatio)))
// 每行多条时改成等分网格；默认 1 保持原来的竖排
const listClass = computed(() => (maxPerRow > 1 ? 'grid' : 'flex flex-col'))
const listStyle = computed(() =>
  maxPerRow > 1 ? { gridTemplateColumns: `repeat(${maxPerRow}, minmax(0, 1fr))` } : undefined,
)
const badges = computed(() => resolveUploadBadges(badgeActions, 'video', badgeVisibility))
const hasBadges = computed(() => badges.value.length > 0)
const entryAssetBadge = computed(
  () =>
    badges.value.find((b) => b.key === 'fromAsset') ??
    (fromAsset ? resolveUploadBadges(['fromAsset'], 'video', badgeVisibility)[0] : undefined),
)

const toItems = async (urls: string[]): Promise<IVideoItem[]> => {
  const items: IVideoItem[] = []
  for (const url of urls) {
    items.push({ url, thumbnail: await extractVideoThumbnail(url), name: getFileName(url) })
  }
  return items
}

/** 删除（角标入口）：调用方开了 confirmDelete 才二次确认 */
const removeAt = (index: number) => {
  if (!confirmDelete) return deleteVideo(index)
  dialog.warning({
    title: '移除视频',
    content: typeof confirmDelete === 'string' ? confirmDelete : '确定移除这个视频吗？',
    positiveText: '移除',
    negativeText: '取消',
    onPositiveClick: () => deleteVideo(index),
  })
}

const setAt = (index: number, item: IVideoItem) => {
  localVideoList.value.splice(index, 1, item)
  videoList.value = [...localVideoList.value]
}

// 替换：复用同一个 input，单选
const replaceIndex = ref<number | null>(null)
const openReplace = (index: number) => {
  if (replacingUrl.value !== null) return
  replaceIndex.value = index
  uploadRef.value!.multiple = false
  uploadRef.value!.click()
}

// 预览：全屏灯箱，带上本组件全部视频（←/→ 切换、下载）
const previewShow = ref(false)
const previewIndex = ref(0)
const previewItems = computed(() =>
  localVideoList.value.map((v) => ({ url: v.url, type: 'video' as const, name: v.name })),
)
const openPreview = (index: number) => {
  previewIndex.value = index
  previewShow.value = true
}

// 资产库：index = -1 表示追加，否则替换该条
const assetShow = ref(false)
const assetIndex = ref(-1)
const assetLimit = computed(() =>
  assetIndex.value >= 0 ? 1 : Math.max(1, (limitNumber ?? 1) - occupied.value),
)
const openAsset = (index: number) => {
  if (busy.value) return
  if (index < 0 && occupied.value >= limit.value) return warnFull()
  assetIndex.value = index
  assetShow.value = true
}
const onAssetSelect = async (urls: string[]) => {
  if (!urls.length) return
  const target = assetIndex.value
  loading.value = true
  try {
    if (target >= 0) {
      const oldUrl = localVideoList.value[target]?.url
      const [item] = await toItems(urls.slice(0, 1))
      if (unmounted || !item) return
      const idx = localVideoList.value.findIndex((v) => v.url === oldUrl)
      if (idx >= 0) setAt(idx, item)
      return
    }
    const fresh = urls.filter((u) => !localVideoList.value.some((v) => v.url === u))
    const items = await toItems(fresh.slice(0, Math.max(0, limit.value - occupied.value)))
    if (unmounted) return
    localVideoList.value.push(...items)
    videoList.value = [...localVideoList.value]
  } finally {
    if (!unmounted) loading.value = false
  }
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

  const replacing = replaceIndex.value
  replaceIndex.value = null
  target.multiple = multiple
  await uploadFiles(Array.from(files), replacing)
}

/** 选文件 / 拖入 / 粘贴共用的校验 + 上传；replacing 为要替换的那一条 */
const uploadFiles = async (fileArray: File[], replacing: number | null) => {
  // 校验是否为视频类型
  for (const file of fileArray) {
    if (!file.type.startsWith('video/')) {
      return message.warning(`${file.name} 不是有效的视频文件`)
    }
  }

  // 替换某一条：不受数量限制；遮罩叠在该行，失败保留原视频。完成时按旧地址重新定位，原视频已不在就丢弃
  if (replacing !== null) {
    const oldUrl = localVideoList.value[replacing]?.url
    if (oldUrl == null) return
    replacingUrl.value = oldUrl
    try {
      const urls = await upload(fileArray.slice(0, 1))
      const [item] = await toItems(urls.slice(0, 1))
      if (unmounted || !item) return
      const idx = localVideoList.value.findIndex((v) => v.url === oldUrl)
      if (idx >= 0) setAt(idx, item)
    } catch {
      if (!unmounted) message.error('视频上传失败，请重试')
    } finally {
      if (!unmounted) {
        replacingUrl.value = null
        if (uploadRef.value) uploadRef.value.value = ''
      }
    }
    return
  }

  // 检查数量限制（失败格也占余量，见 occupied 注释）
  const remaining = limit.value - occupied.value
  if (remaining <= 0) {
    if (uploadRef.value) uploadRef.value.value = ''
    return warnFull()
  }

  const batch = fileArray.slice(0, remaining).map((file) => ({ id: ++pendingSeq, file, status: 'uploading' as const }))
  pending.value.push(...batch)
  if (uploadRef.value) uploadRef.value.value = ''

  // 逐条上传（最多 3 条并行），全部结束后按原顺序一次性入组；失败的留在格子里可重试
  const items = await mapWithConcurrency(batch, 3, (b) => uploadOne(b.file))
  if (unmounted) return
  const ok: IVideoItem[] = []
  batch.forEach((b, i) => {
    const item = items[i]
    if (item) {
      ok.push(item)
      dropPending(b.id)
    } else {
      const cur = pending.value.find((p) => p.id === b.id)
      if (cur) cur.status = 'failed'
    }
  })
  if (ok.length) {
    localVideoList.value.push(...ok)
    videoList.value = [...localVideoList.value]
  }
}

/** 单条上传 + 取封面；失败返回 null */
const uploadOne = async (file: File): Promise<IVideoItem | null> => {
  try {
    const urls = await upload([file])
    const [item] = await toItems(urls.slice(0, 1))
    return item ?? null
  } catch {
    return null
  }
}

/** 失败行「重试」 */
const retryPending = async (id: number) => {
  const target = pending.value.find((p) => p.id === id)
  if (!target || target.status === 'uploading') return
  target.status = 'uploading'
  const item = await uploadOne(target.file)
  if (unmounted) return
  const cur = pending.value.find((p) => p.id === id)
  if (!cur) return
  if (!item) {
    cur.status = 'failed'
    return
  }
  dropPending(id)
  localVideoList.value.push(item)
  videoList.value = [...localVideoList.value]
}

const beforeUpload = () => {
  // 上次「替换」若取消了选文件，这里清掉，避免普通上传被当成替换
  replaceIndex.value = null
  if (uploadRef.value) uploadRef.value.multiple = multiple
  // 余量被失败格占满：先提示，免得选完文件才被拒
  if (occupied.value >= limit.value) return warnFull()
  uploadRef.value?.click()
}

// 拖入 / 粘贴：与选文件走同一套校验、数量限制和上传
const dropRef = ref<HTMLElement | null>(null)
const { dragging } = useFileDropPaste(dropRef, {
  accept: 'video',
  multiple: () => multiple,
  max: () => Math.max(1, limit.value - occupied.value),
  disabled: busy,
  onFiles: (files) => {
    replaceIndex.value = null
    uploadFiles(files, null)
  },
})

// 初始化时为已有的视频生成缩略图
onMounted(async () => {
  if (videoList.value && videoList.value.length > 0) {
    for (const video of videoList.value) {
      if (!video.thumbnail) {
        video.thumbnail = await extractVideoThumbnail(video.url)
      }
    }
    localVideoList.value = [...videoList.value]
  }
})

// 样式（规范 §5.9 上传槽、§4.1 按钮、§4.2 动效）：1px 控件描边 + 白→#f9fafb，r8；hover 描边 violet-line、底 →#fbf7fd
const ZONE =
  'relative flex flex-col items-center pb-16px overflow-hidden rounded-lg border border-solid border-control sx-grad-upload ' +
  'transition-colors duration-mid ease-sx hover:(border-violet-line to-#fbf7fd) motion-reduce:transition-none'
const LIMIT_TIPS =
  'absolute top-0 right-0 w-130px h-24px flex items-center justify-center text-12px rounded-[0_8px] bg-violet-soft text-violet-ink'
const UPLOAD_BTN =
  'sx-btn !h-40px min-w-130px !px-16px !gap-8px !text-14px [font-family:inherit] ' +
  'transition-[border-color,color,box-shadow] duration-fast ease-sx motion-reduce:transition-none'
// 视频行（一格）：r12；缩略图内圆角跟随
const ROW =
  'group relative flex items-center gap-12px px-12px py-8px rounded-12px bg-violet-soft border border-solid border-violet-line'
// 上传中 / 失败遮罩（原型 .ml-role__status：rgba(31,35,41,.35) + 白字 14/600）
const STATUS_MASK =
  'absolute inset-0 z-10 flex items-center justify-center gap-8px rounded-[inherit] bg-[rgba(31,35,41,0.35)] text-white text-14px font-600'
const SPINNER =
  'block w-16px h-16px rounded-full border-2 border-solid border-white/40 border-t-white animate-spin motion-reduce:animate-none'
// 重试 / 移除：视觉 28 高，after 外扩到 ≥32 命中（§10 可点区域）
const MASK_BTN =
  'relative h-28px px-12px rounded-full border-none bg-white/92 text-ink text-12px font-500 leading-none cursor-pointer ' +
  'hover:bg-white sx-focus after:(content-empty absolute -inset-2px rounded-full) [@media(pointer:coarse)]:after:-inset-6px'
</script>

<template>
  <div class="relative" v-loading="loading">
    <div ref="dropRef" :class="[ZONE, dragging && 'sx-drop']">
      <div v-if="limitNumber" :class="LIMIT_TIPS">支持多视频(最多{{ limitNumber }}个)</div>

      <input
        ref="uploadRef"
        type="file"
        :accept="ACCEPT_VIDEO"
        :multiple="multiple"
        id="video-upload"
        @change="handleUpload"
        class="hidden"
      />
      <!-- 按钮显隐只看已传 + 上传中（失败格不藏入口，见 shown 注释） -->
      <template v-if="(multiple && shown < limit) || (!multiple && shown === 0)">
        <!-- #empty：上传入口；作用域 { open, openAsset, count, limit } -->
        <slot
          name="empty"
          :open="beforeUpload"
          :open-asset="() => openAsset(-1)"
          :count="localVideoList.length"
          :limit="limitNumber"
        >
          <!-- flex 包一层：按钮作 flex 项，不产生行盒，尺寸与原来直接放按钮时一致 -->
          <div class="relative flex items-center gap-8px mt-32px">
            <button type="button" :class="UPLOAD_BTN" @click="beforeUpload">
              <i class="icon-ic_ds_CloudUpload1 text-20px" aria-hidden="true"></i>
              <span>{{ triggerLabel }}</span>
            </button>
            <!-- 开了 fromAsset 才有：与上传按钮同一行的文字入口 -->
            <button
              v-if="entryAssetBadge"
              type="button"
              class="sx-btn-ghost !h-40px !px-12px !text-14px text-violet"
              :aria-label="UPLOAD_ENTRY_ASSET_LABEL.video"
              :title="UPLOAD_ENTRY_ASSET_LABEL.tooltip"
              :disabled="busy || isBadgeDisabled(entryAssetBadge, -1)"
              @click.stop="onBadge(entryAssetBadge, -1)"
            >
              {{ UPLOAD_ENTRY_ASSET_LABEL.tooltip }}
            </button>
          </div>
        </slot>
        <p v-if="emptyText && localVideoList.length === 0" class="m-0 mt-8px text-12px leading-18px text-placeholder">
          {{ emptyText }}
        </p>
      </template>

      <!-- 视频上传后展示区域 -->
      <div
        class="mt-16px w-full gap-8px px-12px"
        :class="listClass"
        :style="listStyle"
        v-if="occupied > 0"
      >
        <div :class="ROW" v-for="(item, i) in localVideoList" :key="item.url">
          <!-- #tile：已传视频；作用域 { item, index, remove, replace, preview } -->
          <slot
            name="tile"
            :item="item"
            :index="i"
            :remove="() => removeAt(i)"
            :replace="() => openReplace(i)"
            :preview="() => openPreview(i)"
          >
            <button
              type="button"
              class="relative flex-shrink-0 p-0 border-none bg-transparent rounded-lg overflow-hidden cursor-zoom-in sx-focus"
              :style="{ width: `${tileSize}px`, height: `${thumbHeight}px` }"
              :aria-label="`预览视频 ${item.name ?? ''}`"
              @click="openPreview(i)"
            >
              <img :src="item.thumbnail" :alt="item.name" class="block w-full h-full object-cover" />
            </button>
            <span class="flex-1 text-14px text-ink truncate">{{ item.name }}</span>
            <IconButton v-if="!hasBadges" label="删除视频" size="sm" variant="danger" @click="deleteVideo(i)">
              <i class="icon-ic_ds_return-2" aria-hidden="true"></i>
            </IconButton>
          </slot>

          <!-- 角标（badgeActions）：原型 .sx-medbtn，位置 / 显隐见 ImageUpload/uploadBadges.ts -->
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

          <!-- 替换中：遮罩叠在该行 -->
          <div v-if="replacingAt === i" :class="STATUS_MASK" role="status">
            <span :class="SPINNER" aria-hidden="true"></span>
            <span>上传中</span>
          </div>
        </div>

        <!-- 上传中 / 上传失败：占同一格，失败可重试或移除 -->
        <div v-for="p in pending" :key="`pending-${p.id}`" :class="ROW">
          <div
            class="flex-shrink-0 rounded-lg bg-white/70 grid place-items-center text-placeholder"
            :style="{ width: `${tileSize}px`, height: `${thumbHeight}px` }"
          >
            <i class="icon-ic_ds_CloudUpload1 text-18px" aria-hidden="true"></i>
          </div>
          <span class="flex-1 text-14px text-ink truncate">{{ p.file.name }}</span>
          <div v-if="p.status === 'uploading'" :class="STATUS_MASK" role="status">
            <span :class="SPINNER" aria-hidden="true"></span>
            <span>上传中</span>
          </div>
          <div v-else :class="STATUS_MASK" role="alert">
            <span>上传失败</span>
            <button type="button" :class="MASK_BTN" :aria-label="`重试上传 ${p.file.name}`" @click.stop="retryPending(p.id)">
              重试
            </button>
            <button type="button" :class="MASK_BTN" aria-label="移除上传失败的视频" @click.stop="dropPending(p.id)">
              移除
            </button>
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
          请上传清晰且能够尽量展示商品全貌的视频
        </div>
      </slot>
    </div>

    <!-- 预览（缩略图点击 / 角标 preview / #tile 的 preview()）：全屏灯箱，带全部视频 -->
    <MediaLightbox v-model:show="previewShow" v-model:index="previewIndex" :items="previewItems" />

    <AssetPickerModal
      v-if="entryAssetBadge"
      v-model:show="assetShow"
      media="video"
      :limit="assetLimit"
      @select="onAssetSelect"
    />
  </div>
</template>
