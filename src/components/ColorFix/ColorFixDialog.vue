<script setup lang="ts">
/**
 * 单张生成图的「校色」弹窗（./ColorFixStage.vue 的弹窗形态，画面同用 ./ColorFixView.vue）：大图 + 「校色调整」胶囊 +
 * 参数台（局部选区 / 涂抹）+ 「校色对比」，底栏 移除校色 / 下载校色图 / 调用方自己的动作（插槽 actions，拿到 bakeFile
 * 烘出 PNG 再上传）。
 *
 *   <ColorFixDialog v-model:show="open" :src="url" :color-key="`agent:${taskId}:${i}`" file-name="生成图"
 *     @closed="refresh">
 *     <template #actions="{ bakeFile }"><button class="sx-btn" @click="useIt(await bakeFile())">引用编辑</button></template>
 *   </ColorFixDialog>
 *
 * 要点：
 * - 参数 / 选区按 colorKey 落 localStorage（useResultColorFix）；弹窗关着时 src 置空（不在后台烘图），
 *   关闭时先 cf.close() 落存储再发 closed；打开（或 src 换了）自动展开参数台；
 * - 「移除校色」= cf.clear()：清掉这条的参数 / 选区 / 涂抹蒙版，回到原图；
 * - src 必须是当前观看者有权下载的那张（免费档 = 带水印的交付图），烘出来的 PNG 会被下载 / 上传；
 * - 用 NModal（不是 MediaLightbox）：灯箱 z-index 4000 会盖住涂抹弹窗与消息提示。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import ColorFixView from './ColorFixView.vue'
import { useResultColorFix, type ResultColorFix } from './useResultColorFix.ts'
import { withPngExt } from './files.ts'
import { COLORFIX_MASK_LOAD_FAILED, colorFixFailureText } from '@/utils/colorfix.ts'

const props = withDefaults(
  defineProps<{
    /** 原图地址（当前观看者有权下载的那张） */
    src: string
    /** 持久化键（如 agent:<taskId>:<index>） */
    colorKey: string
    title?: string
    /** 下载文件名（不含扩展名，自动补扩展名） */
    fileName?: string
    /** 现成蒙版（可选，见 useResultColorFix maskUrl） */
    maskUrl?: string
  }>(),
  { title: '图片校色', fileName: '校色图', maskUrl: '' },
)

const show = defineModel<boolean>('show', { required: true })
const emit = defineEmits<{ closed: [key: string] }>()

defineSlots<{
  /** 舞台上方（如多图来源切换） */
  sources?: () => unknown
  /** 底栏右侧的调用方动作；bakeFile 失败 / 未校色时已提示并返回 null */
  actions?: (p: { cf: ResultColorFix; bakeFile: (name?: string, maxSide?: number) => Promise<File | null> }) => unknown
}>()

const message = useMessage()

const cf = useResultColorFix({
  key: computed(() => props.colorKey),
  src: computed(() => (show.value ? props.src : '')),
  maskUrl: computed(() => props.maskUrl),
})

const mode = ref<'result' | 'compare'>('result')
const downloading = ref(false)

// 打开 / 换图：自动展开参数台（等状态机按新 key 复位完再开）
watch(
  () => [show.value, props.src] as const,
  async ([open]) => {
    mode.value = 'result'
    if (!open) return
    await nextTick()
    cf.open()
  },
  { immediate: true },
)

function close() {
  show.value = false
}

// 不管谁关的（× / 遮罩 / Esc / 调用方置 false）：先收起参数台落存储（key 此时仍有效），再通知调用方
watch(show, (open) => {
  if (open) return
  cf.close()
  emit('closed', props.colorKey)
})

function onUpdateShow(v: boolean) {
  if (!v) close()
}

const status = computed(() => {
  if (!cf.active.value) return '未校色：点「校色调整」开始'
  if (cf.maskPending.value) return cf.maskBusy.value ? '正在识别选区…' : '选区还没准备好，当前显示原图'
  if (cf.failed.value && cf.maskLoadFailed.value) return `${COLORFIX_MASK_LOAD_FAILED}，导出将是原图`
  if (cf.failed.value) return '校色效果未能生成（图片不允许读取像素），导出将是原图'
  if (cf.baking.value) return '校色生成中…'
  return cf.touched.value ? '已校色' : '预览默认校色（调整参数后保存）'
})

async function download() {
  if (downloading.value) return
  downloading.value = true
  try {
    const wasActive = cf.active.value
    const ok = await cf.downloadBaked(props.fileName)
    if (!ok) {
      const reason = cf.maskLoadFailed.value ? COLORFIX_MASK_LOAD_FAILED : '校色效果未能写入'
      message.warning(wasActive ? `${reason}，已下载原图` : '还没有校色，已下载原图')
    }
  } finally {
    downloading.value = false
  }
}

async function bakeFile(name?: string, maxSide?: number): Promise<File | null> {
  if (!cf.active.value) {
    message.info('还没有校色，先调整参数')
    return null
  }
  if (cf.maskPending.value) {
    message.info('选区还没准备好，稍后再试')
    return null
  }
  try {
    return await cf.bakeToFile(withPngExt(name || props.fileName), maxSide)
  } catch (err) {
    message.warning(colorFixFailureText(err, '校色效果未能写入（图片不允许读取像素）'))
    return null
  }
}

async function removeFix() {
  if (!props.colorKey) return
  await cf.clear()
  mode.value = 'result'
  message.success('已移除校色')
}
</script>

<template>
  <n-modal :show="show" transform-origin="center" @update:show="onUpdateShow">
    <section
      class="w-[min(980px,calc(100vw-32px))] max-h-[calc(100vh-32px)] overflow-y-auto box-border p-16px rounded-14px bg-white shadow-[0_18px_40px_-16px_rgba(30,41,59,0.32)] flex flex-col gap-12px"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
    >
      <header class="flex items-center gap-8px">
        <b class="flex-1 min-w-0 truncate text-14px font-600 leading-20px text-ink">{{ title }}</b>
        <span class="text-12px leading-18px text-muted" role="status" aria-live="polite">{{ status }}</span>
        <button
          type="button"
          class="relative grid w-32px h-32px flex-none place-items-center p-0 rounded-8px border-none bg-transparent text-muted cursor-pointer hover:(bg-surface3 text-ink) sx-focus"
          aria-label="关闭"
          title="关闭"
          @click="close"
        >
          <svg class="w-16px h-16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <slot name="sources" />

      <div
        class="relative h-[min(62vh,640px)] min-h-280px overflow-hidden rounded-12px border border-solid border-line bg-[conic-gradient(#f3f4f6_25%,#fff_0_50%,#f3f4f6_0_75%,#fff_0)] bg-[length:16px_16px]"
      >
        <ColorFixView
          v-model:mode="mode"
          :cf="cf"
          :labels="['校色前', '校色后']"
          compare-pills
          @download-before="cf.downloadOriginal(`${fileName}-校色前`)"
          @download-after="download"
        />
      </div>

      <footer class="flex flex-wrap items-center gap-8px">
        <button v-if="cf.touched.value" type="button" class="sx-btn-ghost" @click="removeFix">移除校色</button>
        <span class="flex-1" />
        <button type="button" class="sx-btn" :disabled="downloading || !src" :aria-busy="downloading" @click="download">
          {{ downloading ? '准备下载…' : '下载校色图' }}
        </button>
        <slot name="actions" :cf="cf" :bake-file="bakeFile" />
      </footer>
    </section>
  </n-modal>
</template>
