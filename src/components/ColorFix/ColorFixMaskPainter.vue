<script setup lang="ts">
/**
 * 局部调色 · 手动涂抹选区弹窗：复用 tools/MaskPainter（笔刷 / 缩放 / 平移 / 撤销 / 清空，笔迹按原图像素坐标保存），
 * 「应用选区」导出与原图同尺寸的黑底白笔 PNG（白 = 要调整），交给 useResultColorFix.applyPaintedMask；
 * 软边由面板「边缘柔化」在烘图时处理。每次打开都是一张新画布（重新涂抹会替换上一份选区）。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import MaskPainter from '@/views/tools/MaskPainter.vue'
import { capMaskBlob } from './maskStore.ts'

const { src } = defineProps<{ src: string }>()
const show = defineModel<boolean>('show', { required: true })
const emit = defineEmits<{ apply: [mask: Blob] }>()

const painter = ref<InstanceType<typeof MaskPainter> | null>(null)
const hasStroke = ref(false)
const exporting = ref(false)

/**
 * 捕获阶段拦下 ⌘/Ctrl+Z、Backspace、Delete：⌘Z 直接撤销笔迹，其余只吞掉，免得宿主页面（画布）在 window 上
 * 把它们当成撤销画布 / 删除节点。MaskPainter 自己的 window 监听在冒泡阶段，这里拦下后不会重复撤销。
 */
function onKeyCapture(e: KeyboardEvent) {
  if (!show.value) return
  const t = e.target as HTMLElement | null
  if (t && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range'))) return
  const isUndo = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z'
  if (!isUndo && e.key !== 'Backspace' && e.key !== 'Delete') return
  e.preventDefault()
  e.stopPropagation()
  if (isUndo && hasStroke.value) painter.value?.undo()
}
onMounted(() => window.addEventListener('keydown', onKeyCapture, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyCapture, true))

async function apply() {
  if (!painter.value || exporting.value) return
  exporting.value = true
  try {
    const file = await painter.value.exportMask()
    // 长边封顶 2048（烘图时按原图尺寸平滑放大）：4096² 的蒙版存本机太占地方
    if (file) emit('apply', await capMaskBlob(file))
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <n-modal v-model:show="show" transform-origin="center" :mask-closable="false">
    <section
      class="w-[min(720px,calc(100vw-32px))] max-h-[calc(100vh-48px)] overflow-y-auto box-border p-18px rounded-13px bg-white shadow-[0_18px_40px_-16px_rgba(30,41,59,0.32)] flex flex-col gap-12px"
      role="dialog"
      aria-label="涂抹调色选区"
    >
      <header class="flex items-center gap-8px">
        <b class="flex-1 text-14px font-600 leading-20px text-ink">涂抹调色选区</b>
        <button type="button" class="sx-btn" @click="show = false">取消</button>
        <button type="button" class="sx-btn-primary" :disabled="!hasStroke || exporting" @click="apply">应用选区</button>
      </header>
      <p class="m-0 text-12px leading-18px text-muted">
        在图上涂抹要调色的区域（涂红处会被调整，其余像素不动）；放大后可切「移动」拖动画面，涂错了用「撤销」或「清空」。
        应用后可在参数台里反选、调边缘柔化。
      </p>
      <MaskPainter v-if="show && src" ref="painter" :src="src" @change="hasStroke = $event" />
    </section>
  </n-modal>
</template>
