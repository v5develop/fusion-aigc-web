<script setup lang="ts">
import { computed, inject, ref, watch, type Ref } from 'vue'
import { downloadImage } from '@/utils/download'
import { withWatermark } from '@/utils/oss'
import { isTimeout, isVideoUrl } from '@/utils/utils'
import MediaFallback from '@/components/MediaFallback/index.vue'
import GenerateLoading from '@/components/GenerateLoading/index.vue'

const { data } = defineProps<{
  data: { resultUrl: string; status: 0 | 1 | 2 | 3; blocked?: boolean; errorMsg?: string; statusView?: any }
}>()

const selectImgUrls = inject<Ref<Set<string>> | undefined>('selectImgUrls', undefined)

// 素材类型：URL 后缀优先；失败态没有 resultUrl，退回页面下发的组类型（视频页 provide 'video'）
const groupMediaType = inject<'image' | 'video'>('recordMediaType', 'image')
const mediaType = computed<'image' | 'video'>(() => (isVideoUrl(data.resultUrl) ? 'video' : groupMediaType))

// 视频加载失败：以占位图替换。data 变化（同一实例复用）时重置失败态
const videoError = ref(false)
watch(
  () => data.resultUrl,
  () => (videoError.value = false),
)

// 切换单张图片选中
const toggleImage = () => {
  if (selectImgUrls?.value.has(data.resultUrl)) {
    selectImgUrls?.value.delete(data.resultUrl)
  } else {
    selectImgUrls?.value.add(data.resultUrl)
  }
}

// 判断单张图片是否选中
const isImgChecked = () => selectImgUrls?.value.has(data.resultUrl)

// 下载当前单张图片
const onDownload = () => downloadImage(data.resultUrl)
</script>

<template>
  <!-- 圆角由容器裁切（缩略图 r6），图片、视频、占位态统一生效 -->
  <div class="group relative overflow-hidden rounded-md bg-surface3" :class="{ 'cursor-pointer': selectImgUrls }">
    <!-- 违规优先：白卡占位 -->
    <MediaFallback v-if="data.blocked" :type="mediaType" reason="blocked" />
    <template v-else-if="data.resultUrl">
      <n-image
        v-if="mediaType === 'image'"
        class="block w-full h-full"
        :src="withWatermark(data.resultUrl)"
        alt="生成结果"
        width="100%"
        height="100%"
        object-fit="cover"
      >
        <template #error>
          <!-- 成功图但加载失败：网络原因 -->
          <MediaFallback type="image" reason="loadFailed" />
        </template>
      </n-image>
      <!-- 容器固定 16:9（见 RecordList），contain 即「高度撑满、宽度自适应」：横视频满铺，竖视频左右留白居中 -->
      <video
        v-else-if="!videoError"
        class="block w-full h-full object-contain bg-sunken"
        :src="data.resultUrl"
        controls
        controlsList="nodownload"
        disablepictureinpicture
        @error="videoError = true"
      ></video>
      <!-- 成功视频但加载失败：网络原因 -->
      <MediaFallback v-else type="video" reason="loadFailed" />
    </template>
    <!-- 生成失败：超时/一般失败占位 -->
    <MediaFallback
      v-else-if="data.status === 3"
      :type="mediaType"
      :reason="isTimeout(data) ? 'timeout' : 'generateFailed'"
    />
    <!-- 生成中（排队中 0 / 处理中 1）：AI 生成加载动画 -->
    <GenerateLoading v-else />

    <button
      v-if="selectImgUrls && !data.blocked"
      type="button"
      class="absolute top-6px right-6px grid place-items-center p-0 border-none bg-transparent text-20px text-white cursor-pointer rounded-sm opacity-0 transition-opacity duration-mid [text-shadow:0_1px_2px_rgba(0,0,0,0.3)] group-hover:opacity-100 focus-visible:opacity-100 sx-focus"
      :aria-pressed="isImgChecked()"
      aria-label="选择这张图片"
      @click="toggleImage"
    >
      <i :class="isImgChecked() ? 'icon-ic_ds_check_sel' : 'icon-ic_ds_check_nor'" aria-hidden="true" />
    </button>

    <!-- 单个下载仅图片有、只在悬停 / 聚焦时出现（结果卡不放常驻浮层）；视频只保留结果头部的「下载」，避免遮挡播放控件 -->
    <button
      v-if="mediaType === 'image' && data.resultUrl && data.status === 2 && !data.blocked"
      type="button"
      class="sx-btn absolute right-6px bottom-6px !w-24px !h-24px !p-0 opacity-0 transition-opacity duration-mid group-hover:opacity-100 focus-visible:opacity-100"
      aria-label="下载这张图片"
      @click.stop="onDownload"
    >
      <svg
        class="w-12px h-12px"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" />
      </svg>
    </button>
  </div>
</template>
