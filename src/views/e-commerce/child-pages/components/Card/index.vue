<script setup lang="ts">
import { computed, inject, ref, watch, type Ref } from 'vue'
import { downloadImage } from '@/utils/download'
import { withWatermark } from '@/utils/oss'
import { isTimeout, isVideoUrl } from '@/utils/utils'
import MediaFallback from '@/components/MediaFallback/index.vue'
import GenerateLoading from '@/components/GenerateLoading/index.vue'
import { ColorFixItem, ColorFixPill } from '@/components/ColorFix'

const {
  data,
  cfKey = '',
  index = 0,
  name = '',
} = defineProps<{
  data: { resultUrl: string; status: 0 | 1 | 2 | 3; blocked?: boolean; errorMsg?: string; statusView?: any }
  /** 校色持久化键 ecom:<taskUid>:<index>（RecordList 给） */
  cfKey?: string
  /** 本组第几张（0 起） */
  index?: number
  /** 下载文件名（不带扩展名） */
  name?: string
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

// 下载当前单张图片（未接校色时的兜底；接了校色走 ColorFixItem.download：校色开着下校色后的 PNG）
const onDownload = () => downloadImage(data.resultUrl, name || undefined)

// 校色：只对成功、未违规的图片结果开（模型出图常偏色）。展示仍是带水印的展示图，校色开着时换成校色预览。
// 校色来源 = data.resultUrl：与上面 onDownload 同一个地址（观看者有权下载的那张，免费档由后端在 resultUrl 里把关），
// 不用 withWatermark 展示变体（下载口径是 resultUrl，拿展示变体烘会让「下载校色后」与普通下载不一致）
const colorFixOn = computed(() => mediaType.value === 'image' && !!data.resultUrl && data.status === 2 && !data.blocked)
</script>

<template>
  <!-- 圆角由容器裁切（缩略图 r6），图片、视频、占位态统一生效 -->
  <div class="group relative overflow-hidden rounded-md bg-surface3" :class="{ 'cursor-pointer': selectImgUrls }">
    <ColorFixItem
      v-slot="fx"
      :cf-key="cfKey"
      :src="data.resultUrl"
      :index="index"
      :name="name"
      :enabled="colorFixOn && !!cfKey"
    >
      <!-- 违规优先：白卡占位 -->
      <MediaFallback v-if="data.blocked" :type="mediaType" reason="blocked" />
      <template v-else-if="data.resultUrl">
        <n-image
          v-if="mediaType === 'image'"
          class="block w-full h-full"
          :src="fx.active ? fx.displaySrc : withWatermark(data.resultUrl)"
          :img-props="fx.active ? { crossorigin: fx.cors, style: fx.previewStyle, onError: fx.onImgError } : undefined"
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

      <!-- 选择：视觉 24，命中区由 sx-hit 补足；悬停才出现，触屏 / 键盘聚焦始终可见 -->
      <IconButton
        v-if="selectImgUrls && !data.blocked"
        class="!absolute top-6px right-6px"
        size="sm"
        variant="overlay"
        reveal
        :pressed="isImgChecked()"
        label="选择这张图片"
        @click="toggleImage"
      >
        <i :class="isImgChecked() ? 'icon-ic_ds_check_sel' : 'icon-ic_ds_check_nor'" />
      </IconButton>

      <!-- 单个下载仅图片有；视频只保留结果头部的「下载」，避免遮挡播放控件。触屏常显 -->
      <IconButton
        v-if="mediaType === 'image' && data.resultUrl && data.status === 2 && !data.blocked"
        class="!absolute right-6px bottom-6px"
        variant="overlay"
        reveal
        :label="fx.active ? '下载这张图片（校色后）' : '下载这张图片'"
        @click.stop="colorFixOn && cfKey ? fx.download() : onDownload()"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" />
        </svg>
      </IconButton>

      <!-- 校色入口：左上毛玻璃胶囊，悬停出现、触屏 / 键盘聚焦常显；校色过的常显「已校色」。点开 = 结果列上方的校色舞台 -->
      <ColorFixPill
        v-if="colorFixOn && cfKey"
        class="absolute top-6px left-6px z-1"
        :class="fx.touched || fx.focused ? '' : 'sx-reveal'"
        :label="fx.touched ? '已校色' : '校色调整'"
        :pressed="fx.focused"
        @click.stop="fx.openFix()"
      />
      <!-- 正在舞台上调的这张：内描边标出 -->
      <span
        v-if="fx.focused"
        class="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_2px_#875f9a]"
        aria-hidden="true"
      />
    </ColorFixItem>
  </div>
</template>
