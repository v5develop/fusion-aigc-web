<script lang="ts">
export interface IProps {
  imgList: string[]
  showColorPicker?: boolean
  presets?: string[] // 颜色场景弹框的 20 个预制背景图 URL
  scrollCallBack?: () => void
  ratio?: string // 单元格宽:高，如 '3:4'；默认 '1:1' 正方形
  loading?: boolean // 加载中：避免请求返回前误显示空状态
}
</script>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useMessage } from 'naive-ui'
import ColorPicker from './ColorPicker/index.vue'
import { upload } from '@/api/ossUpload.ts'
import { ossThumbnail } from '@/utils/oss.ts'

// 网格为 3 列，面板内单元格约 240px；取 260 略大保证清晰，DPR 由 ossThumbnail 内部换算
const CELL = 260

const {
  imgList,
  showColorPicker = false,
  presets = [],
  scrollCallBack,
  ratio = '1:1',
  loading = false,
} = defineProps<IProps>()

// 非取色器网格且无数据 → 进入占位容器（加载中/空态共用同一默认高度）
const isPlaceholder = computed(() => !showColorPicker && imgList.length === 0)

// 由 ratio(宽:高) 推导单元格高宽比与缩略图目标宽高；非法值兜底正方形
const dims = computed(() => {
  const [rw, rh] = ratio.split(':').map(Number)
  const w = rw && rw > 0 ? rw : 1
  const h = rh && rh > 0 ? rh : 1
  return {
    paddingBottom: `${(h / w) * 100}%`,
    cellW: CELL,
    cellH: Math.round((CELL * h) / w),
  }
})
const imageUrl = defineModel<string>('imageUrl')

const message = useMessage()
// scene：颜色场景（预制图/自选色）选中；image：普通背景图选中。二者互斥
const type = ref<'scene' | 'image'>()
// 颜色场景触发块的展示（预制图 URL 或自选色 hex）
const display = ref('')
// 自选色生成+上传中
const colorLoading = ref(false)

const selectImg = (item: string) => {
  imageUrl.value = item
  type.value = 'image'
}

// 选预制背景图：图片 URL 直接作背景，无需生成/上传
const onSelectPreset = (url: string) => {
  imageUrl.value = url
  display.value = url
  type.value = 'scene'
}

// 自选色：生成纯色 PNG → 上传 OSS → 用返回 URL 作背景
const onSelectCustom = async (hex: string) => {
  display.value = hex // 触发块即时反映所选色
  colorLoading.value = true
  try {
    const file = await colorToPngFile(hex)
    const urls = await upload([file])
    if (urls?.[0]) {
      imageUrl.value = urls[0]
      type.value = 'scene'
    }
  } catch {
    message.error('生成背景失败，请重试')
  } finally {
    colorLoading.value = false
  }
}

// 纯色转 1024×1024 PNG File（纯色缩放无损，尺寸够用）
const colorToPngFile = (hex: string) =>
  new Promise<File>((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 1024
    const ctx = canvas.getContext('2d')
    if (!ctx) return reject(new Error('no canvas context'))
    ctx.fillStyle = hex
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('toBlob failed'))
      resolve(new File([blob], `bg-color-${hex.replace('#', '')}.png`, { type: 'image/png' }))
    }, 'image/png')
  })
</script>

<template>
  <div
    class="grid grid-cols-3 gap-8px max-h-400px overflow-auto [scrollbar-width:thin]"
    v-observer-scroll="{
      callback: scrollCallBack,
    }"
  >
    <ColorPicker
      v-if="showColorPicker"
      :presets="presets"
      :selected="type === 'scene'"
      :loading="colorLoading"
      :display="display"
      @select-preset="onSelectPreset"
      @select-custom="onSelectCustom"
    />

    <!-- 无数据（加载中/空态）：占位容器，保持默认高度（150）不塌陷（取色器网格除外）；
         loading 时留空，加载动画由父级 v-loading 遮罩展示 -->
    <div
      v-if="isPlaceholder"
      class="col-span-full flex flex-col items-center justify-center gap-6px min-h-150px p-18px box-border rounded-lg text-center"
      :class="loading ? '' : 'border border-dashed border-line-strong'"
    >
      <!-- 空态（原型 .sx-empty / C-22）：图标 40 + 标题 13/600 + 说明 11 -->
      <template v-if="!loading">
        <svg
          class="w-40px h-40px text-placeholder"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="m20.5 15.5-4.6-4.6a1.2 1.2 0 0 0-1.7 0L6 19.5" />
        </svg>
        <div class="sx-empty-title">素材还在补充中</div>
        <div class="sx-empty-desc">平台会持续上新这类素材，稍后再来看看</div>
      </template>
    </div>

    <template v-else>
      <!-- 用 padding-bottom 百分比撑出目标比例，不依赖 aspect-ratio
           （旧内核不支持、部分 Chromium 在非整数缩放下行高传播有 bug，会导致图片叠加） -->
      <div
        v-for="item in imgList"
        :key="item"
        role="button"
        tabindex="0"
        :aria-pressed="imageUrl === item"
        aria-label="选择这张素材"
        class="relative h-0 overflow-hidden rounded-lg bg-surface3 border border-solid cursor-pointer transition-[border-color,box-shadow] duration-fast ease-sx motion-reduce:transition-none outline-none focus-visible:(border-violet shadow-focus)"
        :class="
          imageUrl === item
            ? 'border-violet shadow-[0_0_0_1px_#875f9a]'
            : 'border-raised-line hover:(border-raised-hover shadow-raised)'
        "
        :style="{ paddingBottom: dims.paddingBottom }"
        @click="selectImg(item)"
        @keydown.enter.prevent="selectImg(item)"
        @keydown.space.prevent="selectImg(item)"
      >
        <!-- 展示走缩略图消噪；选中/去重/提交仍用原始 item -->
        <img
          class="absolute inset-0 w-full h-full object-cover"
          :src="ossThumbnail(item, dims.cellW, dims.cellH)"
          alt=""
        />
      </div>
    </template>
  </div>
</template>
