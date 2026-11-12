<script setup lang="ts">
/**
 * 姿态复刻 · 人物图 / 姿势图两块入口（对齐线上原型 /tools/ai-posture-fission 的 .pm-slots）。
 *
 * <p>- 人物图：单张 60×100 白边浮片；有图时点击 = 更换；悬停出 240 宽单图预览（不挡点击）。
 * - 姿势图：最多 9 张叠片，每张露 6px；悬停摊开（步长 63，放不下按余量压缩，最密 8）；
 *   下方面板左缘压切口（左块 60 + 间距 16）、右缘到卡右缘，3 列 3:4 缩略图带序号角标和逐张删除。
 * - 两块中间的切口细线、右上清空钮、右下 -12/-12 云钮（资产库）同原型。
 * 上传仍走 useStudioUploader（goUploadImage 直传），资产库走 studio 的 AssetPickerModal。
 * 增删通过 v-model 与 remove / clear 事件交给页面（页面同步删逐张说明）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { ACCEPT_IMAGE } from '@/utils/utils.ts'
import { useFileDropPaste } from '@/composables/useFileDropPaste'
import AssetPickerModal from '../components/AssetPickerModal/index.vue'
import StudioMedBtn from '../components/StudioImageUpload/StudioMedBtn.vue'
import { useStudioUploader } from '../components/StudioImageUpload/useStudioUploader.ts'
import { MIN_SHORT_SIDE } from '../image-size.ts'

const {
  max = 9,
  disabled = false,
  part = 'all',
} = defineProps<{
  /** 姿势图上限 */
  max?: number
  disabled?: boolean
  /**
   * all = 人物图 + 姿势图同排（原版式）；source / poses = 只画其中一块（页面分成「1 人物与服装」「2 姿势参考」两节时用，
   * 计数与操作钮由节自己写，这里不再画块下的小标题）
   */
  part?: 'all' | 'source' | 'poses'
}>()

const emit = defineEmits<{
  /** 姿势图逐张删除（页面连带删这张的动作补充） */
  removePose: [url: string]
  /** 清空全部姿势图 */
  clearPoses: []
}>()

const source = defineModel<string[]>('source', { required: true })
const poses = defineModel<string[]>('poses', { required: true })

const message = useMessage()
const sourceUp = useStudioUploader({ minShortSide: MIN_SHORT_SIDE })
const poseUp = useStudioUploader({
  minShortSide: MIN_SHORT_SIDE,
  onOverflow: ({ room, max: cap }) => message.info(`只放了前 ${room} 张，最多 ${cap} 张`),
})
/** 任一入口还有图在上传：页面提交前据此拦截 */
const uploading = computed(() => sourceUp.uploading.value || poseUp.uploading.value)
defineExpose({
  uploading,
  /** 节内操作钮（上传 / 更换人物、资产库、清空）直接调这几个 */
  pickSource: () => pickSource(),
  openSourceAssets: () => openAssets('source'),
  clearSource: () => clearSource(),
  hasSource: computed(() => !!source.value[0]),
})
// 清空 / 回填 / 重置整组换掉时，还在路上的上传作废（不追加进新内容）
sourceUp.invalidateOnReplace(() => source.value)
poseUp.invalidateOnReplace(() => poses.value)

const sourceUrl = computed(() => source.value[0] ?? '')
const poseFull = computed(() => poses.value.length >= max)
const poseN = computed(() => Math.max(1, poses.value.length))

// ---------------- 叠片尺寸：60 + (n-1) × 6，悬停摊开到 step ----------------

const SLOT_GAP = 16
const slotsEl = ref<HTMLElement | null>(null)
const slotsWidth = ref(0)
let observer: ResizeObserver | null = null
onMounted(() => {
  const el = slotsEl.value
  if (!el) return
  slotsWidth.value = el.getBoundingClientRect().width
  if (typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(([entry]) => {
    if (entry) slotsWidth.value = entry.contentRect.width
  })
  observer.observe(el)
})

/** 展开步长：放得下就用 63，碰到右缘按余量压缩，最密 8（左边人物图恒为 60 宽） */
const step = computed(() => {
  const gaps = poseN.value - 1
  if (!gaps) return 63
  const lead = part === 'poses' ? 0 : 60 + SLOT_GAP
  const room = (slotsWidth.value || 410) - lead
  return Math.min(63, Math.max(8, (room - 60) / gaps))
})

// ---------------- 悬停：人物图单图预览 / 姿势图摊开 + 面板接力 ----------------

const sourcePeeking = ref(false)
const posePeeking = ref(false)
let peekTimer: ReturnType<typeof setTimeout> | undefined

function clearPeekTimer() {
  if (peekTimer !== undefined) {
    clearTimeout(peekTimer)
    peekTimer = undefined
  }
}
function enterPose() {
  clearPeekTimer()
  posePeeking.value = true
}
/** 离开先等 180ms：从叠片往下走进面板（顶上 12 高透明桥）时不收 */
function leavePose() {
  clearPeekTimer()
  peekTimer = setTimeout(() => {
    peekTimer = undefined
    posePeeking.value = false
  }, 180)
}
onBeforeUnmount(() => {
  clearPeekTimer()
  observer?.disconnect()
  observer = null
})

const poseExpanded = computed(() => posePeeking.value && poses.value.length > 0)
const poseStep = computed(() => (poseExpanded.value ? step.value : 6))
const poseWidth = computed(() => `${60 + (poseN.value - 1) * poseStep.value}px`)
const poseDelLeft = computed(() => `${60 + (poseN.value - 1) * poseStep.value - 8}px`)

// ---------------- 上传 ----------------

const sourceInput = ref<HTMLInputElement | null>(null)
const poseInput = ref<HTMLInputElement | null>(null)

function pickSource() {
  if (disabled || sourceUp.uploading.value) return
  sourceInput.value?.click()
}

function warnFull() {
  message.warning(`满了，最多 ${max} 张；要换先在上面的预览里删一张`)
}

function pickPoses() {
  if (disabled || poseUp.uploading.value) return
  if (poseFull.value) return warnFull()
  poseInput.value?.click()
}

/** 人物图只有一张：再传即更换 */
async function addSource(files: File[]) {
  await sourceUp.uploadFiles(files.slice(0, 1), 1, 1, (url) => {
    source.value = [url]
  })
}

async function addPoses(files: File[]) {
  if (poseFull.value) {
    message.warning(`位置满了，最多 ${max} 张`)
    return
  }
  await poseUp.uploadFiles(files, max - poses.value.length, max, (url) => {
    if (!poses.value.includes(url)) poses.value.push(url)
  })
}

function onSourceFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  void addSource(files)
}

function onPoseFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  void addPoses(files)
}

const sourceEntry = ref<HTMLElement | null>(null)
const poseEntry = ref<HTMLElement | null>(null)
const { dragging: sourceDragging } = useFileDropPaste(sourceEntry, {
  accept: 'image',
  multiple: false,
  disabled: () => disabled || part === 'poses' || sourceUp.uploading.value,
  // 人物图 / 姿态图两块并排：没指向哪块时粘贴进人物图
  pastePrimary: true,
  rejectMessage: () => '已跳过非图片文件',
  onFiles: (files) => void addSource(files),
})
const { dragging: poseDragging } = useFileDropPaste(poseEntry, {
  accept: 'image',
  multiple: true,
  disabled: () => disabled || part === 'source' || poseUp.uploading.value,
  rejectMessage: () => '已跳过非图片文件',
  onFiles: (files) => void addPoses(files),
})

function clearSource() {
  if (disabled) return
  sourceUp.invalidate()
  source.value = []
  sourcePeeking.value = false
  message.info('已清空人物图')
}

function clearPoses() {
  if (disabled || !poses.value.length) return
  const count = poses.value.length
  poseUp.invalidate()
  emit('clearPoses')
  posePeeking.value = false
  message.info(`已清空 ${count} 张姿势图`)
}

function removePose(url: string) {
  if (disabled) return
  emit('removePose', url)
}

// ---------------- 资产库 ----------------

const assetOpen = ref(false)
const assetFor = ref<'source' | 'poses'>('poses')

function openAssets(kind: 'source' | 'poses') {
  if (disabled) return
  if (kind === 'poses' && poseFull.value) return warnFull()
  assetFor.value = kind
  assetOpen.value = true
}

/** 资产图与上传同口径：只收 http(s)、去重、不超过余量 */
function onAssets(picked: string[]) {
  const ok = picked.filter((u) => /^https?:\/\//i.test(u))
  if (assetFor.value === 'source') {
    if (ok.length < picked.length) message.warning('已跳过重复或不可用的图片')
    if (ok[0]) source.value = [ok[0]]
    return
  }
  const fresh = [...new Set(ok.filter((u) => !poses.value.includes(u)))]
  if (fresh.length < picked.length) message.warning('已跳过重复或不可用的图片')
  poses.value.push(...fresh.slice(0, Math.max(0, max - poses.value.length)))
}

const assetLimit = computed(() => (assetFor.value === 'poses' ? Math.max(1, max - poses.value.length) : 1))

const seamCls =
  "before:(content-[''] absolute top-0 left-[-12px] w-9px h-100px pointer-events-none bg-[linear-gradient(90deg,rgb(var(--xq-ink-rgb)/0)_0%,rgb(var(--xq-ink-rgb)/0.026)_35%,rgb(var(--xq-ink-rgb)/0.026)_65%,rgb(var(--xq-ink-rgb)/0)_100%)] [mask:linear-gradient(180deg,transparent_0%,#000_12%,#000_88%,transparent_100%)]) after:(content-[''] absolute top-0 left-[-8px] w-1px h-100px pointer-events-none bg-[linear-gradient(180deg,rgb(var(--xq-ink-rgb)/0)_0%,rgb(var(--xq-ink-rgb)/0.09)_14%,rgb(var(--xq-ink-rgb)/0.09)_86%,rgb(var(--xq-ink-rgb)/0)_100%)])"
const plateCls =
  'relative block w-60px h-100px box-border overflow-hidden border border-solid border-white rounded-5px bg-surface3 shadow-[0_1px_3px_rgba(31,35,41,0.16)] transition-[margin-left] duration-220 ease-[cubic-bezier(0.25,0.8,0.25,1)] motion-reduce:transition-none'
const entryCls =
  'relative flex flex-col items-center justify-center gap-4px box-border h-100px p-0 overflow-visible rounded-5px cursor-pointer transition-[width] duration-220 ease-[cubic-bezier(0.25,0.8,0.25,1)] motion-reduce:transition-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2) disabled:cursor-not-allowed'
const emptyCls =
  'border border-solid border-white bg-white text-placeholder shadow-[0_1px_3px_rgba(31,35,41,0.16)] hover:shadow-[0_2px_6px_rgba(31,35,41,0.2)]'
const capCls =
  'flex flex-col items-center gap-2px w-60px mt-8px mb-0 text-10px leading-15px text-center text-placeholder'
const popCls =
  'absolute top-108px box-border border border-solid border-line rounded-8px bg-white shadow-[0_12px_32px_rgba(31,35,41,0.18),0_2px_8px_rgba(31,35,41,0.08)] animate-[stu-preview-in_120ms_ease_both] motion-reduce:animate-none'
</script>

<template>
  <div ref="slotsEl" class="relative flex items-start gap-16px">
    <!-- 人物图：单张片子，悬停出大图 -->
    <div
      v-if="part !== 'poses'"
      class="relative flex flex-[0_0_auto] min-w-0 flex-col items-center"
      @mouseenter="sourcePeeking = true"
      @mouseleave="sourcePeeking = false"
    >
      <div class="relative">
        <button
          ref="sourceEntry"
          type="button"
          class="w-60px"
          :class="[entryCls, sourceUrl ? 'border-0 bg-transparent' : emptyCls, sourceDragging && 'sx-drop-ring']"
          :disabled="disabled"
          :aria-label="sourceUrl ? '人物图已上传，点击更换' : '上传人物图'"
          title="图里需有人物，且不能是未成年人"
          @click="pickSource"
        >
          <span v-if="sourceUrl" class="absolute left-0 top-0 flex" aria-hidden="true">
            <span :class="plateCls"><img class="block w-full h-full object-cover" :src="sourceUrl" alt="" /></span>
          </span>
          <n-spin v-else-if="sourceUp.uploading.value" :size="16" />
          <template v-else>
            <svg
              class="w-18px h-18px text-muted"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
              <circle cx="9" cy="10" r="1.6" />
              <path d="M20.5 16l-5-5L6 19.5" />
            </svg>
            <span class="text-9px leading-13px">待上传</span>
          </template>
          <span
            v-if="sourceUrl && sourceUp.uploading.value"
            class="absolute inset-0 z-20 grid place-items-center rounded-5px bg-surface/60"
          >
            <n-spin :size="16" />
          </span>
        </button>
        <StudioMedBtn
          v-if="part === 'all'"
          label="从资产库选人物图"
          class="-right-12px -bottom-12px z-12"
          :disabled="disabled"
          @click.stop="openAssets('source')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path
              d="M7 18.5h10.5a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.4 9.1 4.75 4.75 0 0 0 7 18.5z"
              stroke-linejoin="round"
              transform="translate(0 -0.5)"
            />
          </svg>
        </StudioMedBtn>
        <StudioMedBtn
          v-if="part === 'all' && sourceUrl && !disabled"
          label="清空人物图"
          class="-top-8px left-52px z-14"
          @click.stop="clearSource"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5M10.5 11v5M13.5 11v5" />
          </svg>
        </StudioMedBtn>
      </div>
      <p v-if="part === 'all'" :class="capCls">
        <b class="text-11px font-500 text-ink-2">人物图</b>
        <span>{{ sourceUrl ? '1张' : '最多1张' }}</span>
      </p>
    </div>

    <div
      v-if="part !== 'poses' && sourcePeeking && sourceUrl"
      :class="popCls"
      class="z-20 left-0 w-240px p-8px pointer-events-none before:(content-[''] absolute -top-12px inset-x-0 h-12px)"
      aria-hidden="true"
    >
      <img class="block w-full h-auto max-h-420px rounded-5px object-contain bg-surface2" :src="sourceUrl" alt="" />
      <div class="mt-6px text-9.5px leading-14px text-placeholder">人物图 · 身份与服装都锁这张 · 点击更换</div>
    </div>

    <!-- 姿势图：最多 9 张叠片，满 9 张后只拦点击，悬停照样摊开 -->
    <div
      v-if="part !== 'source'"
      class="relative flex flex-[0_0_auto] min-w-0 flex-col items-center"
      :class="part === 'all' ? seamCls : ''"
      @mouseenter="enterPose"
      @mouseleave="leavePose"
    >
      <div class="relative">
        <button
          ref="poseEntry"
          type="button"
          :class="[
            entryCls,
            poses.length ? 'border-0 bg-transparent' : emptyCls,
            poseFull && '!cursor-default',
            poseExpanded ? 'z-5' : 'z-1',
            poseDragging && 'sx-drop-ring',
          ]"
          :style="{ width: poseWidth }"
          :disabled="disabled"
          :aria-label="poseFull ? `姿势图已满 ${max} 张` : `姿势图，${poses.length} 张，点击添加`"
          :aria-disabled="poseFull || undefined"
          @click="pickPoses"
        >
          <span v-if="poses.length" class="absolute left-0 top-0 flex" aria-hidden="true">
            <span
              v-for="(url, index) in poses.slice(0, 9)"
              :key="url"
              :class="plateCls"
              :style="{ zIndex: index, marginLeft: index ? `${poseStep - 60}px` : '0px' }"
            >
              <img class="block w-full h-full object-cover" :src="url" alt="" />
            </span>
          </span>
          <n-spin v-else-if="poseUp.uploading.value" :size="16" />
          <template v-else>
            <svg
              class="w-18px h-18px text-muted"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
              <circle cx="9" cy="10" r="1.6" />
              <path d="M20.5 16l-5-5L6 19.5" />
            </svg>
            <span class="text-9px leading-13px">待上传</span>
          </template>
          <span
            v-if="poses.length && poseUp.uploading.value"
            class="absolute inset-0 z-20 grid place-items-center rounded-5px bg-surface/60"
          >
            <n-spin :size="16" />
          </span>
        </button>
        <!-- 展开时片子会盖到云上：有图时一悬停就收掉；空块不藏 -->
        <StudioMedBtn
          label="从资产库选姿势图"
          class="-right-12px -bottom-12px z-12 transition-opacity duration-120 motion-reduce:transition-none"
          :class="poseExpanded ? 'opacity-0 pointer-events-none' : ''"
          :disabled="disabled"
          @click.stop="openAssets('poses')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path
              d="M7 18.5h10.5a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.4 9.1 4.75 4.75 0 0 0 7 18.5z"
              stroke-linejoin="round"
              transform="translate(0 -0.5)"
            />
          </svg>
        </StudioMedBtn>
        <StudioMedBtn
          v-if="poses.length && !disabled"
          label="清空姿势图"
          class="-top-8px z-14 transition-[left] duration-220 ease-[cubic-bezier(0.25,0.8,0.25,1)] motion-reduce:transition-none"
          :style="{ left: poseDelLeft }"
          @click.stop="clearPoses"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5M10.5 11v5M13.5 11v5" />
          </svg>
        </StudioMedBtn>
      </div>
      <p v-if="part === 'all'" :class="capCls">
        <b class="text-11px font-500 text-ink-2">姿势图</b>
        <span>{{ poses.length ? `${poses.length}/${max}` : `最多${max}张` }}</span>
      </p>
    </div>

    <!-- 姿势图面板：左缘压在切口上（左块 60 + 间距 16），右缘到卡右缘 -->
    <div
      v-if="part !== 'source' && poseExpanded"
      :class="popCls"
      :style="part === 'poses' ? { left: 'auto', width: '300px' } : undefined"
      class="z-21 left-76px right-0 p-10px before:(content-[''] absolute -top-12px inset-x-0 h-12px)"
      role="group"
      :aria-label="`姿势图，共 ${poses.length} 张`"
      @mouseenter="enterPose"
      @mouseleave="leavePose"
    >
      <div class="flex items-baseline gap-6px mb-6px text-10px text-muted">
        <b class="text-11px font-600 text-ink-2">姿势图</b><span>{{ poses.length }} 张</span>
      </div>
      <div class="grid grid-cols-3 gap-8px">
        <span
          v-for="(url, index) in poses"
          :key="url"
          class="relative aspect-[3/4] overflow-hidden border border-solid border-line rounded-5px"
        >
          <img class="block w-full h-full object-cover" :src="url" alt="" />
          <span
            class="absolute bottom-2px left-2px px-4px rounded-full bg-[rgba(31,35,41,0.66)] text-white text-8px leading-13px"
            >{{ index + 1 }}</span
          >
          <StudioMedBtn
            v-if="!disabled"
            label="移除这张姿势"
            class="top-3px right-3px z-2"
            @click.stop="removePose(url)"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5M10.5 11v5M13.5 11v5" />
            </svg>
          </StudioMedBtn>
        </span>
      </div>
    </div>

    <input
      ref="sourceInput"
      type="file"
      class="hidden"
      :accept="ACCEPT_IMAGE"
      tabindex="-1"
      aria-hidden="true"
      @change="onSourceFiles"
    />
    <input
      ref="poseInput"
      type="file"
      class="hidden"
      :accept="ACCEPT_IMAGE"
      multiple
      tabindex="-1"
      aria-hidden="true"
      @change="onPoseFiles"
    />
    <AssetPickerModal v-model:show="assetOpen" :limit="assetLimit" @select="onAssets" />
  </div>
</template>

<style>
/* 与 StudioImageUpload 同名同值：直接进姿态页时那边没挂载，这里也备一份（UnoCSS animate-[…] 只引用名字） */
@keyframes stu-preview-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
</style>
