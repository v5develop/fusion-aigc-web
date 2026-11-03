<script lang="ts">
export interface IVideoItem {
  url: string
  thumbnail?: string
  name?: string
}
</script>

<script setup lang="ts">
import { upload } from '@/api/ossUpload.ts'
import { ACCEPT_VIDEO } from '@/utils/utils'
import { useDialog, useMessage } from 'naive-ui'
import { computed, defineAsyncComponent, ref, watch, onMounted } from 'vue'
import { useFileDropPaste } from '@/composables/useFileDropPaste'
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

const message = useMessage()
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
  replaceIndex.value = index
  uploadRef.value!.multiple = false
  uploadRef.value!.click()
}

// 预览
const previewUrl = ref('')
const previewShow = ref(false)
const openPreview = (index: number) => {
  previewUrl.value = localVideoList.value[index]?.url ?? ''
  previewShow.value = true
}

// 资产库：index = -1 表示追加，否则替换该条
const assetShow = ref(false)
const assetIndex = ref(-1)
const assetLimit = computed(() =>
  assetIndex.value >= 0 ? 1 : Math.max(1, (limitNumber ?? 1) - localVideoList.value.length),
)
const openAsset = (index: number) => {
  if (loading.value) return
  if (index < 0 && localVideoList.value.length >= (limitNumber ?? 1)) {
    return message.warning(`最多上传${limitNumber ?? 1}个视频`)
  }
  assetIndex.value = index
  assetShow.value = true
}
const onAssetSelect = async (urls: string[]) => {
  if (!urls.length) return
  const target = assetIndex.value
  loading.value = true
  try {
    if (target >= 0) {
      const [item] = await toItems(urls.slice(0, 1))
      if (item) setAt(target, item)
      return
    }
    const fresh = urls.filter((u) => !localVideoList.value.some((v) => v.url === u))
    const remaining = (limitNumber ?? 1) - localVideoList.value.length
    localVideoList.value.push(...(await toItems(fresh.slice(0, Math.max(0, remaining)))))
    videoList.value = [...localVideoList.value]
  } finally {
    loading.value = false
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

  // 替换某一条：不受数量限制
  if (replacing !== null) {
    loading.value = true
    try {
      const urls = await upload(fileArray.slice(0, 1))
      const [item] = await toItems(urls.slice(0, 1))
      if (item) setAt(replacing, item)
    } catch {
      message.error('视频上传失败，请重试')
    } finally {
      loading.value = false
      if (uploadRef.value) uploadRef.value.value = ''
    }
    return
  }

  // 检查数量限制
  const remaining = (limitNumber ?? 1) - localVideoList.value.length
  if (remaining <= 0) {
    return message.warning(`最多上传${limitNumber}个视频`)
  }

  loading.value = true

  try {
    const urls = await upload(fileArray)
    const newVideos: IVideoItem[] = []

    for (const url of urls.slice(0, remaining)) {
      const thumbnail = await extractVideoThumbnail(url)
      newVideos.push({
        url,
        thumbnail,
        name: getFileName(url),
      })
    }

    localVideoList.value.push(...newVideos)
    videoList.value = [...localVideoList.value]
  } catch {
    message.error('视频上传失败，请重试')
  } finally {
    loading.value = false
    if (uploadRef.value) {
      uploadRef.value.value = ''
    }
  }
}

const beforeUpload = () => {
  // 上次「替换」若取消了选文件，这里清掉，避免普通上传被当成替换
  replaceIndex.value = null
  if (uploadRef.value) uploadRef.value.multiple = multiple
  uploadRef.value?.click()
}

// 拖入 / 粘贴：与选文件走同一套校验、数量限制和上传
const dropRef = ref<HTMLElement | null>(null)
const { dragging } = useFileDropPaste(dropRef, {
  accept: 'video',
  multiple: () => multiple,
  max: () => Math.max(1, (limitNumber ?? 1) - localVideoList.value.length),
  disabled: loading,
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
const DELETE_BTN =
  'w-16px h-16px p-0 flex-shrink-0 rounded-full flex items-center justify-center cursor-pointer ' +
  'bg-ink hover:bg-black/70 transition-colors duration-fast ease-sx motion-reduce:transition-none sx-focus'
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
      <template
        v-if="(multiple && localVideoList.length < (limitNumber ?? 1)) || (!multiple && localVideoList.length === 0)"
      >
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
              :disabled="loading || isBadgeDisabled(entryAssetBadge, -1)"
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
        v-if="localVideoList.length > 0"
      >
        <div
          class="group relative flex items-center gap-12px px-12px py-8px rounded-lg bg-violet-soft border border-solid border-violet-line"
          v-for="(item, i) in localVideoList"
          :key="item.url"
        >
          <!-- #tile：已传视频；作用域 { item, index, remove, replace, preview } -->
          <slot
            name="tile"
            :item="item"
            :index="i"
            :remove="() => removeAt(i)"
            :replace="() => openReplace(i)"
            :preview="() => openPreview(i)"
          >
            <div
              class="relative flex-shrink-0 rounded-lg overflow-hidden"
              :style="{ width: `${tileSize}px`, height: `${thumbHeight}px` }"
            >
              <img :src="item.thumbnail" :alt="item.name" class="block w-full h-full object-cover" />
            </div>
            <span class="flex-1 text-14px text-ink truncate">{{ item.name }}</span>
            <button v-if="!hasBadges" type="button" :class="DELETE_BTN" aria-label="删除视频" @click="deleteVideo(i)">
              <i class="icon-ic_ds_return-2 text-white text-8px" aria-hidden="true"></i>
            </button>
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

    <!-- 角标「预览」 -->
    <n-modal v-if="hasBadges" v-model:show="previewShow">
      <video :src="previewUrl" controls autoplay class="block max-w-[80vw] max-h-[80vh] rounded-lg bg-black"></video>
    </n-modal>

    <AssetPickerModal
      v-if="entryAssetBadge"
      v-model:show="assetShow"
      media="video"
      :limit="assetLimit"
      @select="onAssetSelect"
    />
  </div>
</template>
