<script setup lang="ts">
import { computed, inject, ref, watch, type Ref } from 'vue'
import { CHECK_PATH } from '../../constants.ts'
import MediaFallback from '@/components/MediaFallback/index.vue'
import { withWatermark } from '@/utils/oss'

const { data } = defineProps<{
  data: {
    id: number
    resultUrl: string
    status: 0 | 1 | 2 | 3
    mediaType: 'image' | 'video'
    /** 视频封面。由后端异步抽帧生成后回填，尚未回填时可能缺省或等于 resultUrl（见 videoPoster） */
    coverUrl?: string
    /** 封面缩略图（Java 服务端派生，只增字段）：与 coverUrl 不同时才是真缩略图 */
    coverThumbnailUrl?: string | null
  }
}>()

/** 预览 / 下载用的原图（带展示水印） */
const originalSrc = computed(() => withWatermark(data.resultUrl))
/** 缩略图加载失败就退回原图（只退一次；换了资产重置） */
const thumbFailed = ref(false)
/**
 * 卡片展示用：后端给了真缩略图（≠ coverUrl，私有桶签名封面服务端缩放后重签）就用它，
 * 否则保持原来的展示（原图 + 展示水印）。点开预览始终是原图。
 */
const cardSrc = computed(() => {
  const t = data.coverThumbnailUrl
  return t && t !== data.coverUrl && !thumbFailed.value ? t : originalSrc.value
})
function onImageError() {
  if (cardSrc.value !== originalSrc.value) thumbFailed.value = true
}

/**
 * 视频 poster。
 *
 * coverUrl 等于 resultUrl 时必须当作「没有封面」：素材建库时该字段就是按 resultUrl 赋的
 * （对图片正确——图自己就是封面；对视频则是把 mp4 地址当成了封面），真封面要等后端
 * 异步抽帧后回填。不排掉这个值的话，浏览器会拿 mp4 当图片加载，poster 位置直接裂图，
 * 比不设 poster 还糟。
 */
const videoPoster = computed(() => (data.coverUrl && data.coverUrl !== data.resultUrl ? data.coverUrl : undefined))

// 视频加载失败：以占位图替换。data 变化（虚拟列表复用同一实例）时重置失败态
const videoError = ref(false)
watch(
  () => data.resultUrl,
  () => {
    videoError.value = false
    thumbFailed.value = false
  },
)

// 管理模式开关 + 已选资产 id 集合（删除按 id、下载按 resultUrl，故选择以 id 为准）
const manageMode = inject<Ref<boolean> | undefined>('assetManageMode', undefined)
const selectedIds = inject<Ref<Set<number>> | undefined>('assetSelectedIds', undefined)

// 切换单张素材选中
const toggleImage = () => {
  if (selectedIds?.value.has(data.id)) {
    selectedIds?.value.delete(data.id)
  } else {
    selectedIds?.value.add(data.id)
  }
}

// 判断单张素材是否选中
const isImgChecked = () => selectedIds?.value.has(data.id)
</script>

<template>
  <div class="card" :class="{ cursor: manageMode }">
    <template v-if="data.resultUrl">
      <n-image
        v-if="data.mediaType === 'image'"
        :src="cardSrc"
        :preview-src="originalSrc"
        alt=""
        width="100%"
        height="100%"
        object-fit="cover"
        @error="onImageError"
      >
        <template #error>
          <!-- 加载失败：网络原因 -->
          <MediaFallback type="image" reason="loadFailed" />
        </template>
      </n-image>
      <template v-else>
        <!-- poster：素材的 coverUrl。视频素材建库时该字段曾被赋成视频地址本身，
             现由后端封面任务回填为真封面；尚未回填时不设 poster，退回浏览器首帧 -->
        <video
          v-if="!videoError"
          class="video"
          :src="data.resultUrl"
          :poster="videoPoster"
          preload="metadata"
          controls
          @error="videoError = true"
        ></video>
        <!-- 加载失败：网络原因 -->
        <MediaFallback v-else type="video" reason="loadFailed" />
      </template>
    </template>
    <div
      v-else
      class="status-box"
      :class="{
        pending: data.status === 0,
        processing: data.status === 1,
        failed: data.status === 3,
      }"
    >
      <template v-if="data.status === 0">
        <!--        <i class="icon-ic_ds_clock"></i>-->
        <span>排队中</span>
      </template>
      <template v-else-if="data.status === 1">
        <!--        <i class="icon-ic_ds_loading"></i>-->
        <span>处理中</span>
      </template>
      <template v-else-if="data.status === 3">
        <!--        <i class="icon-ic_ds_error"></i>-->
        <span>生成失败</span>
      </template>
    </div>

    <span
      v-if="manageMode"
      class="icon"
      role="checkbox"
      tabindex="0"
      :aria-checked="!!isImgChecked()"
      aria-label="选择这张图片"
      @click="toggleImage"
      @keydown.enter.prevent="toggleImage"
      @keydown.space.prevent="toggleImage"
    >
      <svg viewBox="0 0 16 16" width="22" height="22">
        <template v-if="isImgChecked()">
          <circle cx="8" cy="8" r="8" fill="#202020" />
          <path :d="CHECK_PATH" fill="#FFFFFF" />
        </template>
        <circle v-else cx="8" cy="8" r="7.33" fill="#FFFFFF" stroke="#D8D8D8" stroke-width="1.33" />
      </svg>
    </span>
  </div>
</template>

<style scoped lang="less">
.card {
  position: relative;
  .video {
    width: 100%;
    height: 100%;
  }
  :deep(.n-image) {
    width: 100%;
    height: 100%;
  }
  &.cursor {
    cursor: pointer;
  }

  > .status-box {
    width: 100%;
    height: 100%;
    min-width: 150px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border-radius: 8px;

    &.pending {
      background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
      color: var(--xq-ink-2);
      i {
        font-size: 32px;
      }
      span {
        font-size: 14px;
      }
    }

    &.processing {
      background: linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%);
      color: var(--xq-ink);
      i {
        font-size: 32px;
        animation: spin 1s linear infinite;
      }
      span {
        font-size: 14px;
      }
    }

    &.failed {
      background: linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%);
      color: #d32f2f;
      i {
        font-size: 32px;
      }
      span {
        font-size: 14px;
      }
    }
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
  > .icon {
    position: absolute;
    top: 4px;
    right: 14px;
    display: inline-flex;
    padding: 6px; // 视觉 22，命中 34
    border-radius: 50%;
    cursor: pointer;
    &:focus-visible {
      outline: 2px solid #7c5cff;
      outline-offset: -2px;
    }
    > svg {
      display: block;
    }
  }
}
</style>
