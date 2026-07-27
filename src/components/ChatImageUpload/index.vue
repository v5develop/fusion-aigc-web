<script setup lang="ts">
import { ref, computed } from 'vue'
import { useMessage } from 'naive-ui'
import { upload } from '@/api/ossUpload.ts'
import { ACCEPT_IMAGE, ACCEPT_VIDEO } from '@/utils/utils'

interface IProps {
  type?: 'image' | 'video'
  limitNumber?: number
  limitDuration?: number // 视频时长限制（秒）
  multiple?: boolean
  label?: string
}
const { type = 'image', limitNumber, limitDuration = 10, multiple = false, label } = defineProps<IProps>()
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

const beforeUpload = () => {
  if (loading.value) return

  if (limitNumber && fileList.value.length >= limitNumber) {
    const unit = type === 'video' ? '个视频' : '张图片'
    return message.warning(`最多上传${limitNumber}${unit}`)
  }
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

const getVideoDuration = (file: File): Promise<number> => {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.src = URL.createObjectURL(file)
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src)
      resolve(video.duration)
    }
    video.onerror = () => {
      URL.revokeObjectURL(video.src)
      resolve(0)
    }
  })
}

const handleUpload = async (e: Event) => {
  const target = e.target as HTMLInputElement
  const files = target.files
  if (!files || files.length === 0) return

  const fileArray = Array.from(files)
  const mimePrefix = type === 'video' ? 'video/' : 'image/'
  const label = type === 'video' ? '视频' : '图片'

  for (const file of fileArray) {
    if (!file.type.startsWith(mimePrefix)) {
      return message.warning(`${file.name} 不是有效的${label}`)
    }
  }

  if (type === 'video') {
    for (const file of fileArray) {
      const duration = await getVideoDuration(file)
      if (duration > limitDuration) {
        return message.warning(`视频时长不能超过${limitDuration}秒`)
      }
    }
  }

  loading.value = true
  try {
    const urls = await upload(fileArray)
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
  } catch {
    message.error(`${type === 'video' ? '视频' : '图片'}上传失败，请重试`)
  } finally {
    loading.value = false
    uploadRef.value!.value = ''
  }
}

const deleteImg = (index: number) => {
  fileList.value.splice(index, 1)
}
</script>

<template>
  <div class="upload-component">
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
          class="item upload-btn"
          :class="[fileList.length && !expand ? 'upload-btn-small' : '', { disabled: loading }]"
          @click="beforeUpload"
          v-loading="loading"
        >
          <i class="icon-ic_home_upload1"></i>
          <span class="label">{{ label }}</span>
        </div>
      </div>
    </div>
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
