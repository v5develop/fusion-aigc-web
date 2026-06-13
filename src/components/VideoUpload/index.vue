<script setup lang="ts">
import { upload } from '@/api/ossUpload.ts'
import { useMessage } from 'naive-ui'
import { ref, watch, onMounted } from 'vue'

interface IVideoItem {
  url: string
  thumbnail?: string
  name: string
}

interface IProps {
  limitNumber?: number // 限制上传个数
  btnName?: string // 按钮名称
  multiple?: boolean
  bottomTips?: boolean
}
const { limitNumber, multiple = false, bottomTips, btnName = '上传视频' } = defineProps<IProps>()
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
    // 灰色背景
    ctx.fillStyle = '#e0e0e0'
    ctx.fillRect(0, 0, 48, 48)
    // 播放按钮形状
    ctx.fillStyle = '#666'
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

const handleUpload = async (e: Event) => {
  const target = e.target as HTMLInputElement
  const files = target.files
  if (!files || files.length === 0) return

  // 校验是否为视频类型
  const fileArray = Array.from(files)
  for (const file of fileArray) {
    if (!file.type.startsWith('video/')) {
      return message.warning(`${file.name} 不是有效的视频文件`)
    }
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
  uploadRef.value?.click()
}

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
</script>

<template>
  <div class="video-upload" v-loading="loading">
    <div class="main">
      <div v-if="limitNumber" class="limit-tips">支持多视频(最多{{ limitNumber }}个)</div>

      <input
        ref="uploadRef"
        type="file"
        accept="video/*"
        :multiple="multiple"
        id="video-upload"
        @change="handleUpload"
        style="display: none"
      />
      <div
        v-if="(multiple && localVideoList.length < (limitNumber ?? 1)) || (!multiple && localVideoList.length === 0)"
        class="upload-btn"
        @click="beforeUpload"
      >
        <i class="icon-ic_ds_CloudUpload1"></i>
        <span>{{ btnName }}</span>
      </div>

      <!-- 视频上传后展示区域 -->
      <div class="upload-video-list" v-if="localVideoList.length > 0">
        <div class="video-item" v-for="(item, i) in localVideoList" :key="item.url">
          <div class="video-thumbnail">
            <img :src="item.thumbnail" :alt="item.name" class="thumb-img" />
          </div>
          <span class="video-name">{{ item.name }}</span>
          <div class="delete-btn" @click="deleteVideo(i)">
            <i class="icon-ic_ds_return-2"></i>
          </div>
        </div>
      </div>

      <slot></slot>

      <div v-if="bottomTips" class="bottom-tips">请上传清晰且能够尽量展示商品全貌的视频</div>
    </div>
  </div>
</template>

<style scoped lang="less">
.video-upload {
  position: relative;

  > .main {
    padding-bottom: 16px;
    border-radius: 12px;
    box-sizing: border-box;
    border: 1px solid #f0f0f0;
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    overflow: hidden;

    > .limit-tips {
      width: 130px;
      height: 24px;
      font-size: 12px;
      position: absolute;
      top: 0;
      right: 0;
      border-radius: 0 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(101deg, #e8e4ff 0%, #ffdada 100%);
    }

    > .upload-btn {
      min-width: 130px;
      height: 40px;
      margin-top: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 16px;
      gap: 8px;
      cursor: pointer;
      background: #f5f6f8;

      &:hover {
        background: #f0f0f0;
      }

      > i {
        font-size: 20px;
      }
    }

    > .upload-video-list {
      margin-top: 16px;
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 0 12px;

      > .video-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 12px;
        background: #f5f0ff;
        border-radius: 12px;
        position: relative;
        border: 1px solid var(--main-color);

        > .video-thumbnail {
          width: 48px;
          height: 48px;
          border-radius: 8px;
          overflow: hidden;
          position: relative;
          flex-shrink: 0;

          > .thumb-img {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }
        }

        > .video-name {
          flex: 1;
          font-size: 14px;
          color: #333;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        > .delete-btn {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #333333;
          cursor: pointer;
          flex-shrink: 0;

          &:hover {
            background: rgba(0, 0, 0, 0.7);
          }

          > .icon-ic_ds_return-2 {
            color: white;
            font-size: 8px;
          }
        }
      }
    }

    > .bottom-tips {
      width: 100%;
      height: 36px;
      margin-top: auto;
      font-size: 12px;
      background: #fff4e6;
      color: #ff9500;
      display: flex;
      align-items: center;
      padding: 0 12px;
      position: relative;
      bottom: -16px;
    }
  }
}
</style>
