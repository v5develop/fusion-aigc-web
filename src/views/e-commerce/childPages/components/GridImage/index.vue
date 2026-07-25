<script lang="ts">
export interface IProps {
  imgList: string[]
  showColorPicker?: boolean
  presets?: string[] // 颜色场景弹框的 20 个预制背景图 URL
  scrollCallBack?: () => void
  ratio?: string // 单元格宽:高，如 '3:4'；默认 '1:1' 正方形
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
} = defineProps<IProps>()

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
    class="grid-container"
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

    <div
      class="item"
      :class="imageUrl === item ? 'active' : ''"
      :style="{ paddingBottom: dims.paddingBottom }"
      v-for="item in imgList"
      :key="item"
      @click="selectImg(item)"
    >
      <!-- 展示走缩略图消噪；选中/去重/提交仍用原始 item -->
      <img class="img" :src="ossThumbnail(item, dims.cellW, dims.cellH)" alt="" />
    </div>
  </div>
</template>

<style scoped lang="less">
@import '@/assets/variables.less';
.grid-container {
  max-height: 400px;
  overflow: auto;
  .scrollbar(@width: 8px, @trackColor: #fff, @thumbColor: rgba(0, 0, 0, 0.1), @thumbWidth: 4px, @hoverColor: rgba(0, 0, 0, 0.35));
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  > .item {
    // 用 padding-bottom 百分比撑出目标比例，不依赖 aspect-ratio
    // （旧内核不支持、部分 Chromium 在非整数缩放下行高传播有 bug，会导致图片叠加）
    // 具体比例由内联 style 动态设置（默认 1:1 → 100%）
    position: relative;
    height: 0;
    background: #f5f6f8;
    border-radius: 8px;
    border: 2px solid transparent;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.1s;
    &:hover {
      border-color: var(--main-color);
    }
    &.active {
      border-color: var(--main-color);
    }
    > .img {
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  }
}
</style>
