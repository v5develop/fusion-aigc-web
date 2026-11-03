<script setup lang="ts">
import { ref, computed } from 'vue'
import { useMessage } from 'naive-ui'
import { upload } from '@/api/ossUpload.ts'
import { ACCEPT_IMAGE, ACCEPT_VIDEO } from '@/utils/utils'
import { onPickerKeydown, useFileDropPaste } from '@/composables/useFileDropPaste'
import AssetPickerModal from '@/views/studio/components/AssetPickerModal/index.vue'

interface IProps {
  type?: 'image' | 'video'
  limitNumber?: number
  limitDuration?: number // 视频时长限制（秒）
  limitSize?: number // 视频体积限制（MB）
  multiple?: boolean
  label?: string
}
const {
  type = 'image',
  limitNumber,
  limitDuration = 20,
  limitSize = 20,
  multiple = false,
  label,
} = defineProps<IProps>()
const fileList = defineModel<any[]>('fileList', { required: true })

const message = useMessage()
const uploadRef = ref<HTMLInputElement | null>(null)
const expand = ref(false)
const loading = ref(false)

const acceptType = computed(() => (type === 'video' ? ACCEPT_VIDEO : ACCEPT_IMAGE))

const getPreviewSrc = (item: any) => {
  if (type === 'video') return item.thumbnail
  return item
}

/** 追加前的统一检查（选文件 / 拖入 / 粘贴同一套） */
const canAppend = () => {
  if (loading.value) return false

  if (limitNumber && fileList.value.length >= limitNumber) {
    const unit = type === 'video' ? '个视频' : '张图片'
    message.warning(`最多上传${limitNumber}${unit}`)
    return false
  }
  return true
}

const beforeUpload = () => {
  if (!canAppend()) return
  uploadRef.value!.click()
}

const extractVideoThumbnail = (videoUrl: string): Promise<string> => {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.preload = 'metadata'
    video.src = videoUrl
    video.muted = true

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
          cleanup()
          resolve(canvas.toDataURL('image/png'))
        } else {
          cleanup()
          resolve('')
        }
      } catch {
        cleanup()
        resolve('')
      }
    }

    const handleLoaded = () => {
      video.currentTime = 0.5
    }

    const handleError = () => {
      cleanup()
      resolve('')
    }

    video.addEventListener('seeked', handleSeeked)
    video.addEventListener('loadedmetadata', handleLoaded)
    video.addEventListener('error', handleError)
    video.load()
  })
}

/** 本地文件或远端地址（资产库）都能读时长；读不出来返回 0，不拦 */
const getVideoDuration = (source: File | string): Promise<number> => {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    const isFile = typeof source !== 'string'
    video.preload = 'metadata'
    video.src = isFile ? URL.createObjectURL(source) : source
    video.onloadedmetadata = () => {
      if (isFile) URL.revokeObjectURL(video.src)
      resolve(video.duration)
    }
    video.onerror = () => {
      if (isFile) URL.revokeObjectURL(video.src)
      resolve(0)
    }
  })
}

const handleUpload = async (e: Event) => {
  const target = e.target as HTMLInputElement
  const files = target.files
  if (!files || files.length === 0) return
  await uploadFiles(Array.from(files))
}

/** 选文件 / 拖入 / 粘贴共用的校验 + 上传 */
const uploadFiles = async (fileArray: File[]) => {
  const mimePrefix = type === 'video' ? 'video/' : 'image/'
  const label = type === 'video' ? '视频' : '图片'

  // 校验不通过要顺手清空 input，否则用户再次选同一个文件不触发 change，看起来像点了没反应
  const reject = (tip: string) => {
    uploadRef.value!.value = ''
    message.warning(tip)
  }

  for (const file of fileArray) {
    if (!file.type.startsWith(mimePrefix)) {
      return reject(`${file.name} 不是有效的${label}`)
    }
  }

  if (type === 'video') {
    for (const file of fileArray) {
      // 先判体积（同步、零成本），再判时长（要异步读 video 元数据）
      if (file.size > limitSize * 1024 * 1024) {
        return reject(`视频大小不能超过${limitSize}MB`)
      }
      const duration = await getVideoDuration(file)
      if (duration > limitDuration) {
        return reject(`视频时长不能超过${limitDuration}秒`)
      }
    }
  }

  loading.value = true
  try {
    await appendUrls(await upload(fileArray))
  } catch {
    message.error(`${type === 'video' ? '视频' : '图片'}上传失败，请重试`)
  } finally {
    loading.value = false
    uploadRef.value!.value = ''
  }
}

/** 上传 / 资产库共用：按余量截取后入组（视频补封面） */
const appendUrls = async (urls: string[]) => {
  const remaining = limitNumber ? limitNumber - fileList.value.length : urls.length
  const validUrls = urls.slice(0, remaining)

  if (type === 'video') {
    for (const url of validUrls) {
      const thumbnail = await extractVideoThumbnail(url)
      fileList.value.push({ url, thumbnail })
    }
  } else {
    fileList.value.push(...validUrls)
  }
}

// ---------------- 从资产库添加 ----------------

const assetShow = ref(false)
const full = computed(() => !!limitNumber && fileList.value.length >= limitNumber)
const assetLimit = computed(() => Math.max(1, limitNumber ? limitNumber - fileList.value.length : 1))
const urlOf = (item: any): string => (type === 'video' ? item?.url : item)

const openAssets = () => {
  if (!canAppend()) return
  assetShow.value = true
}

/** 资产地址与上传同口径：去重、视频时长同一条上限与提示（体积在地址上拿不到，不拦），再按余量入组 */
const onAssetSelect = async (picked: string[]) => {
  const fresh = picked.filter((u) => /^https?:\/\//i.test(u) && !fileList.value.some((it) => urlOf(it) === u))
  if (!fresh.length) return
  loading.value = true
  try {
    if (type === 'video') {
      for (const url of fresh) {
        if ((await getVideoDuration(url)) > limitDuration) {
          return message.warning(`视频时长不能超过${limitDuration}秒`)
        }
      }
    }
    await appendUrls(fresh)
  } finally {
    loading.value = false
  }
}

const deleteImg = (index: number) => {
  fileList.value.splice(index, 1)
}

/** 拖入 / 粘贴进来的文件：先过数量检查，再走同一套校验和上传 */
const addFiles = (files: File[]) => {
  if (canAppend()) uploadFiles(files)
}

const rootRef = ref<HTMLElement | null>(null)
const { dragging } = useFileDropPaste(rootRef, {
  accept: () => type,
  multiple: () => multiple,
  max: () => (limitNumber ? limitNumber - fileList.value.length : undefined),
  disabled: loading,
  onFiles: addFiles,
})

// 输入框里粘贴的图片转交到这里（ChatInputBox）
defineExpose({ addFiles })
</script>

<template>
  <div ref="rootRef" class="upload-component rounded-lg" :class="dragging && 'sx-drop-ring'">
    <input
      ref="uploadRef"
      type="file"
      :accept="acceptType"
      :multiple="multiple"
      @change="handleUpload"
      style="display: none"
    />

    <div class="content">
      <div class="preview-cont" @mouseleave="expand = false">
        <div
          class="item"
          :style="{ '--transformX': expand ? 60 * i + 'px' : 0 }"
          v-for="(item, i) in fileList"
          :key="type === 'video' ? item.url : item"
        >
          <img class="img-item" :src="getPreviewSrc(item)" alt="" @mouseenter="expand = true" />

          <div class="delete-box" @click="deleteImg(i)">
            <i class="icon-ic_ds_return-2"></i>
          </div>
        </div>

        <div
          :style="{ '--transformX': expand ? 60 * fileList.length + 'px' : 0 }"
          class="item upload-btn sx-focus"
          :class="[fileList.length && !expand ? 'upload-btn-small' : '', { disabled: loading }]"
          role="button"
          tabindex="0"
          :aria-label="label || (type === 'video' ? '上传视频' : '上传图片')"
          @click="beforeUpload"
          @keydown="onPickerKeydown($event, beforeUpload)"
          v-loading="loading"
        >
          <i class="icon-ic_home_upload1"></i>
          <span class="label">{{ label }}</span>
        </div>
      </div>
    </div>

    <!-- 从资产库添加：叠片下方（上传区 80 高，下面留有 20 的空） -->
    <button
      type="button"
      class="absolute left-0 top-full mt-2px p-0 text-12px leading-18px whitespace-nowrap text-violet bg-transparent border-none cursor-pointer rounded-sm hover:underline disabled:(opacity-45 cursor-not-allowed) sx-focus"
      :aria-label="type === 'video' ? '从资产库添加视频' : '从资产库添加图片'"
      :disabled="loading || full"
      @click="openAssets"
    >
      从资产库添加
    </button>
    <AssetPickerModal v-model:show="assetShow" :media="type" :limit="assetLimit" @select="onAssetSelect" />
  </div>
</template>

<style scoped lang="less">
.upload-component {
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
  &:hover {
    z-index: 1;
  }
  > .content {
    width: 100%;
    height: 100%;
    display: flex;
    position: relative;
    > .preview-cont {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      position: absolute;
      left: 0;
      top: 0;
      > .item {
        width: 60px;
        height: 70px;
        position: absolute;
        left: var(--transformX);
        top: 0;
        transition: all 0.3s;
        .rotate-to-right();
        &:hover {
          .delete-box {
            opacity: 1;
          }
        }
        > .img-item {
          width: 100%;
          height: 100%;
          object-fit: cover;
          cursor: pointer;
          transition: all 0.2s;
        }

        > .delete-box {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          position: absolute;
          top: -8px;
          right: 0;
          background-color: #444444;
          color: white;
          font-size: 12px;
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.3s;
          > .icon-ic_ds_return-2 {
            font-size: 8px;
          }
        }
      }
      > .item:nth-child(even) {
        .rotate-to-left();
      }

      > .upload-btn {
        border: 1px solid #ffffff;
        box-shadow: 0 1px 6px 0 rgba(0, 0, 0, 0.03);
        background: linear-gradient(319deg, #fff6fb 2%, #ede6ff 97%);
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        justify-content: center;
        align-items: center;
        transform: rotate(-@rotate);
        > .icon-ic_home_upload1 {
          color: #8f8f8f;
        }
        > .label {
          font-size: 12px;
          white-space: nowrap;
          position: absolute;
          left: 50%;
          top: 65%;
          transform: translateX(-50%);
          transition: all 0.3s;
        }
      }
      > .upload-btn-small {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        transform: translateX(0) translateY(0) !important;
        position: absolute;
        left: 60%;
        top: 60%;
        > .label {
          opacity: 0;
        }
      }
      > .disabled {
        pointer-events: none;
      }
    }
  }
}

@rotate: 5deg;
.rotate-to-left() {
  transform: rotate(@rotate);
  &:hover {
    transform: rotate(@rotate) translateY(-5px) scale(1.1);
  }
}
.rotate-to-right() {
  transform: rotate(-@rotate);
  &:hover {
    transform: rotate(-@rotate) translateY(-5px) scale(1.1);
  }
}
</style>
