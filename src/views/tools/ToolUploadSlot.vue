<script setup lang="ts">
/**
 * 工具页的上传槽位：图片或视频，按 schema 的 max / maxBytes / accept / 时长在上传前拦截。
 *
 * <p>上传走现有的 api/ossUpload.ts（STS 直传 + confirm，ImageUpload / VideoUpload 同一条通道），不另开通道。
 *
 * <p>长相对齐 s1.1 统一上传态（`layout`，见 schemas.ts 的 UploadLayout）：
 * - batch / single：B3.1 卡 434×742（内边距 13），空态只有 48 云影球、球心在卡正中，不写「原图」；
 *   batch 有图后是 60×100 白边浮片格（5 列、列距 27、行距 105.33，20 张铺满 408×716）；
 * - pipe：同款片格 5 列 × 4 行 = 408×512（产品替换底图）；
 * - ml / material：60×100 叠片入口（StudioImageUpload 的 picker 模式只负责长相，选文件 / 校验 / 上传仍在这里）。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { upload } from '@/api/ossUpload.ts'
import { toApiError } from '@/api/index.ts'
import StudioImageUpload from '@/views/studio/components/StudioImageUpload/index.vue'
import StudioMedBtn from '@/views/studio/components/StudioImageUpload/StudioMedBtn.vue'
import type { UploadLayout, UploadSpec } from './schemas'

const props = defineProps<{
  spec: UploadSpec
  id: string
  disabled?: boolean
  /** s1.1 版式（纯展示）；不传按 kind / max 推断：视频或单张 = single，多张 = batch */
  layout?: UploadLayout
}>()
const urls = defineModel<string[]>({ required: true })

const message = useMessage()
const inputRef = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

const isVideo = computed(() => props.spec.kind === 'video')
const room = computed(() => props.spec.max - urls.value.length)
const exts = computed(() => props.spec.accept.split(',').map((s) => s.trim().toLowerCase()))
const extText = computed(() => exts.value.map((e) => e.replace('.', '').toUpperCase()).join(' / '))
const sizeText = computed(() => {
  const mb = props.spec.maxBytes / 1024 / 1024
  return mb >= 1024 ? `${mb / 1024}G` : `${mb}M`
})
const hint = computed(() => {
  const parts = [`支持 ${extText.value}`, `单个不超过 ${sizeText.value}`]
  if (props.spec.max > 1) parts.push(`最多 ${props.spec.max} ${isVideo.value ? '段' : '张'}`)
  if (props.spec.minDuration || props.spec.maxDuration)
    parts.push(`时长 ${props.spec.minDuration ?? 0}–${props.spec.maxDuration ?? '∞'} 秒`)
  return parts.join('，')
})

function pick() {
  if (props.disabled || uploading.value) return
  inputRef.value?.click()
}

/** 读取视频时长（秒）；读不出来返回 null，不拦截 */
function videoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement('video')
    const url = URL.createObjectURL(file)
    const done = (v: number | null) => {
      URL.revokeObjectURL(url)
      resolve(v)
    }
    el.preload = 'metadata'
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : null)
    el.onerror = () => done(null)
    el.src = url
  })
}

async function validate(file: File): Promise<string | null> {
  const name = file.name.toLowerCase()
  if (!exts.value.some((ext) => name.endsWith(ext))) {
    return `「${file.name}」格式不支持，仅支持 ${extText.value}`
  }
  if (file.size > props.spec.maxBytes) {
    return `「${file.name}」超过 ${sizeText.value}，请压缩后再上传`
  }
  if (isVideo.value && (props.spec.minDuration || props.spec.maxDuration)) {
    const d = await videoDuration(file)
    if (d !== null) {
      if (props.spec.minDuration && d < props.spec.minDuration) {
        return `「${file.name}」时长不足 ${props.spec.minDuration} 秒`
      }
      if (props.spec.maxDuration && d > props.spec.maxDuration) {
        return `「${file.name}」时长超过 ${props.spec.maxDuration} 秒`
      }
    }
  }
  return null
}

async function onChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length) return
  // 单槽位（max=1）选新文件 = 换一张
  const replacing = props.spec.max === 1
  const capacity = replacing ? 1 : room.value
  if (capacity <= 0) {
    message.warning(`最多上传 ${props.spec.max} ${isVideo.value ? '段' : '张'}`)
    return
  }
  let picked = files
  if (picked.length > capacity) {
    message.warning(`最多还能添加 ${capacity} 个，多选的 ${picked.length - capacity} 个未添加`)
    picked = picked.slice(0, capacity)
  }
  const valid: File[] = []
  for (const f of picked) {
    const err = await validate(f)
    if (err) message.error(err)
    else valid.push(f)
  }
  if (!valid.length) return

  uploading.value = true
  try {
    const uploaded = await upload(valid)
    urls.value = replacing ? uploaded.slice(0, 1) : [...urls.value, ...uploaded]
  } catch (err) {
    // 业务失败（取凭证被拒等）请求层已 toast，这里只补传输层 / 对象存储的失败提示
    const apiErr = toApiError(err)
    if (!apiErr || apiErr.code === -1) message.error('上传失败，请检查网络后重试')
  } finally {
    uploading.value = false
  }
}

function remove(i: number) {
  urls.value = urls.value.filter((_, idx) => idx !== i)
}

// ---------------- 展示（s1.1 统一上传态） ----------------

const mode = computed<UploadLayout>(() => props.layout ?? (isVideo.value || props.spec.max === 1 ? 'single' : 'batch'))
const isPlates = computed(() => mode.value === 'ml' || mode.value === 'material')
const unit = computed(() => (isVideo.value ? '段' : '张'))
/** 槽头只在单角色参考图槽（数量写槽头）和产品替换底图显示；其它版式名称只给读屏（s1.1：上传框上方不再写「原图」） */
const showHeader = computed(() => mode.value === 'ml' || mode.value === 'pipe')

/** 叠片入口点击：满额先给同一句提示，不弹文件框（单张槽 = 换一张，照常弹） */
function pickFromPlates() {
  if (props.spec.max > 1 && room.value <= 0) {
    message.warning(`最多上传 ${props.spec.max} ${unit.value}`)
    return
  }
  pick()
}

/** 空片格（产品替换的底图占位）：只给鼠标，键盘走「待上传」片 */
function pickFromPlaceholder() {
  if (room.value > 0) pick()
}

/** 片格版式里的空位：产品替换空态是 4 个底图占位 + 1 个添加格，正好 5 列 */
const placeholders = computed(() => (mode.value === 'pipe' ? Math.max(0, 4 - urls.value.length) : 0))

/** 悬停预览朝向：后两列往左展开、下两行往上展开，240 宽的预览不出卡 */
function previewPos(i: number) {
  const col = i % 5
  const row = Math.floor(i / 5)
  return [col >= 3 ? 'right-0' : 'left-0', mode.value === 'batch' && row >= 2 ? 'bottom-[110px]' : 'top-[110px]']
}

// 云影球：真实弹跳 1300ms，弹跳中再移入不重播（1360ms 锁）
const ballPlaying = ref(false)
let ballTimer: ReturnType<typeof setTimeout> | null = null
function playBall() {
  if (ballPlaying.value) return
  ballPlaying.value = true
  ballTimer = setTimeout(() => {
    ballPlaying.value = false
    ballTimer = null
  }, 1360)
}
onBeforeUnmount(() => {
  if (ballTimer) clearTimeout(ballTimer)
})

const focusRing = 'outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)'
/** B3.1 上传卡：434×742 的外壳，内边距 13 */
const cardCls =
  'relative w-full max-w-[434px] box-border p-[13px] rounded-10px bg-white ' +
  'shadow-[0_0_0_1px_rgba(31,35,41,0.05),0_1px_3px_rgba(31,35,41,0.06)]'
/** 白边浮片：60×100 · r5 · 1px #fff · 0 1px 3px .16；悬停只把影压深 */
const plateCls =
  'relative box-border w-60px h-100px rounded-5px border border-solid border-white bg-white ' +
  'shadow-[0_1px_3px_rgba(31,35,41,0.16)] transition-shadow duration-160 ease-out motion-reduce:transition-none ' +
  'hover:shadow-[0_2px_6px_rgba(31,35,41,0.2)]'
/** 60×100 片格：5 列 60，列距按卡内宽分（408 时正好 27） */
const gridCls = 'm-0 p-0 list-none grid grid-cols-[repeat(5,60px)] auto-rows-[100px] justify-between'
/** 切口：同排两块隔 16，线画在第二块上（9 宽柔影带 α.026 上下渐隐 + 正中 1px 中线 α.09） */
const seamCls = [
  "[.tus-plate+&]:before:content-[''] [.tus-plate+&]:before:absolute [.tus-plate+&]:before:top-0",
  '[.tus-plate+&]:before:left-[-12px] [.tus-plate+&]:before:w-9px [.tus-plate+&]:before:h-100px',
  '[.tus-plate+&]:before:pointer-events-none',
  '[.tus-plate+&]:before:bg-[linear-gradient(90deg,rgba(31,35,41,0)_0%,rgba(31,35,41,0.026)_35%,rgba(31,35,41,0.026)_65%,rgba(31,35,41,0)_100%)]',
  '[.tus-plate+&]:before:[mask:linear-gradient(180deg,transparent_0%,#000_12%,#000_88%,transparent_100%)]',
  '[.tus-plate+&]:before:[-webkit-mask:linear-gradient(180deg,transparent_0%,#000_12%,#000_88%,transparent_100%)]',
  "[.tus-plate+&]:after:content-[''] [.tus-plate+&]:after:absolute [.tus-plate+&]:after:top-0",
  '[.tus-plate+&]:after:left-[-8px] [.tus-plate+&]:after:w-1px [.tus-plate+&]:after:h-100px',
  '[.tus-plate+&]:after:pointer-events-none',
  '[.tus-plate+&]:after:bg-[linear-gradient(180deg,rgba(31,35,41,0)_0%,rgba(31,35,41,0.09)_14%,rgba(31,35,41,0.09)_86%,rgba(31,35,41,0)_100%)]',
]
</script>

<template>
  <div
    :class="
      isPlates
        ? ['tus-plate relative flex-[0_0_auto] min-w-0', seamCls]
        : mode === 'single' || mode === 'batch'
          ? 'w-full flex justify-center'
          : ''
    "
  >
    <div :class="showHeader ? 'll-label' : 'sr-only'">
      <span :id="`${id}-label`">
        {{ spec.label }}
        <span v-if="spec.required" class="text-danger" aria-hidden="true">*</span>
      </span>
      <span v-if="spec.max > 1 || mode === 'ml'" class="text-12px text-placeholder">{{
        uploading ? '上传中…' : `${urls.length} / ${spec.max}`
      }}</span>
    </div>
    <input
      :id="id"
      ref="inputRef"
      type="file"
      class="hidden"
      :accept="spec.accept"
      :multiple="spec.max > 1"
      :aria-labelledby="`${id}-label`"
      @change="onChange"
    />

    <!-- 参考图槽 / 材料片：一叠 60×100 白边浮片就是入口（长相由 StudioImageUpload 的 picker 模式画） -->
    <StudioImageUpload
      v-if="isPlates"
      :model-value="urls"
      picker
      :max="spec.max"
      :multiple="spec.max > 1"
      :disabled="disabled"
      :label="mode === 'material' ? spec.label : ''"
      :name="spec.label"
      :hint="uploading ? '上传中…' : ''"
      @pick="pickFromPlates"
      @remove="(_url: string, index: number) => remove(index)"
      @clear="urls = []"
    />

    <!-- 空态（batch / single）：B3.1 卡 434×742，整块可点，48 云影球在卡正中 -->
    <div v-else-if="!urls.length && (mode === 'batch' || mode === 'single')" :class="[cardCls, 'h-[742px]']">
      <button
        type="button"
        class="relative block w-full h-full box-border p-0 rounded-8px cursor-pointer transition-colors disabled:cursor-not-allowed"
        :class="[
          focusRing,
          mode === 'batch'
            ? 'border border-dashed border-line-strong bg-white hover:border-violet-line'
            : 'border border-solid border-#c9cfd6 bg-gradient-to-b from-white to-#f9fafb shadow-[inset_0_1px_3px_rgba(31,35,41,0.04)] hover:border-violet-line',
        ]"
        :disabled="disabled || uploading"
        :aria-describedby="`${id}-hint`"
        @click="pick"
      >
        <span
          class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 grid w-64px h-84px place-items-center"
          aria-hidden="true"
          @pointerenter="playBall"
        >
          <!-- 地面影 38.4×11.2 · blur 7.2，弹跳时同步变深变浅 -->
          <span
            class="absolute left-1/2 bottom-5px z-1 w-[38.4px] h-[11.2px] ml-[-19.2px] rounded-full bg-[rgba(31,35,41,0.32)] blur-[7.2px] opacity-75 scale-x-85 scale-y-80 pointer-events-none motion-reduce:animate-none"
            :class="ballPlaying ? 'animate-[tus-ball-ground_1300ms_both]' : ''"
          />
          <span
            class="relative z-2 w-48px h-48px motion-reduce:animate-none"
            :class="ballPlaying ? 'animate-[tus-ball-jump_1300ms_both]' : ''"
          >
            <span
              class="absolute inset-0 box-border border border-solid border-[#dfe3e8] rounded-full bg-[radial-gradient(circle_at_50%_35%,#fff_0_55%,#fbfbfc_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] origin-[50%_100%] motion-reduce:animate-none"
              :class="ballPlaying ? 'animate-[tus-ball-shell_1300ms_both]' : ''"
            />
            <span class="absolute inset-0 z-1 grid place-items-center text-ink-2 pointer-events-none -translate-y-2px">
              <svg
                class="w-[35.2px] h-[35.2px] overflow-visible"
                viewBox="-0.4 -0.56 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M6.5 18a4.5 4.5 0 0 1-.7-8.95A6 6 0 0 1 17.5 10.5a3.75 3.75 0 0 1 0 7.5z" />
                <path d="M12 11v7" />
                <path d="M9.5 13.5 12 11l2.5 2.5" />
              </svg>
            </span>
          </span>
        </span>
        <span class="absolute inset-x-12px top-[calc(50%+46px)] flex flex-col items-center gap-6px text-center">
          <b class="text-13px font-600 leading-[1.4] text-ink">{{
            uploading ? '上传中…' : `点击上传${isVideo ? '视频' : '图片'}`
          }}</b>
          <span :id="`${id}-hint`" class="text-11px leading-[1.5] text-muted">{{ hint }}</span>
          <span v-if="mode === 'batch'" class="text-11px leading-[1.5] text-muted">已选 0 / {{ spec.max }}</span>
        </span>
      </button>
    </div>

    <!-- 有图（batch / pipe）：60×100 白边浮片格；pipe 空态也走这里（4 个底图占位 + 添加格） -->
    <div v-else-if="mode === 'batch' || mode === 'pipe'" :class="[cardCls, mode === 'batch' ? 'h-[742px]' : '']">
      <span :id="`${id}-hint`" class="sr-only">{{ hint }}</span>
      <ul
        :class="[gridCls, mode === 'batch' ? 'grid-rows-[repeat(4,100px)] gap-y-[105.33px]' : 'gap-y-[37.33px]']"
        :aria-labelledby="`${id}-label`"
      >
        <li v-for="(url, i) in urls" :key="url + i" class="group relative w-60px h-100px">
          <div
            :class="[plateCls, focusRing]"
            tabindex="0"
            :aria-label="`${spec.label} 第 ${i + 1} 张，按 Delete 删除`"
            @keydown.delete.prevent="!disabled && remove(i)"
          >
            <img :src="url" alt="" class="block w-full h-full object-cover rounded-4px" />
          </div>
          <!-- 悬停 / 聚焦看大图：240 宽固定框 contain，120ms + 4px 上浮；纯看不挡点击 -->
          <div
            class="hidden group-hover:block group-focus-within:block absolute z-30 w-240px box-border p-8px rounded-8px border border-solid border-line bg-white shadow-[0_12px_32px_rgba(31,35,41,0.18),0_2px_8px_rgba(31,35,41,0.08)] pointer-events-none animate-[tus-preview-in_120ms_ease_both] motion-reduce:animate-none"
            :class="previewPos(i)"
            aria-hidden="true"
          >
            <div class="grid place-items-center h-[312px] overflow-hidden rounded-6px bg-surface2">
              <img :src="url" alt="" class="block max-w-full max-h-[312px] object-contain" />
            </div>
          </div>
          <StudioMedBtn
            :label="`删除${spec.label}第 ${i + 1} 个`"
            class="-top-8px -right-8px z-12 disabled:(opacity-45 cursor-not-allowed)"
            :disabled="disabled"
            @click="remove(i)"
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
        </li>

        <li
          v-for="n in placeholders"
          :key="`ph-${n}`"
          class="w-60px h-100px box-border rounded-5px border border-dashed border-line bg-surface2 cursor-pointer"
          aria-hidden="true"
          @click="pickFromPlaceholder"
        />

        <!-- 待上传：同尺寸白边浮片，图标 18 + 文案 9/13（间距 4），已选数写在片里 -->
        <li v-if="room > 0" class="relative w-60px h-100px">
          <button
            type="button"
            :class="[
              plateCls,
              focusRing,
              'flex flex-col items-center justify-center gap-4px p-0 text-placeholder cursor-pointer disabled:(cursor-not-allowed opacity-60)',
            ]"
            :disabled="disabled || uploading"
            :aria-label="`${uploading ? '上传中' : `继续添加${spec.label}`}，已选 ${urls.length} / ${spec.max}`"
            :aria-describedby="`${id}-hint`"
            @click="pick"
          >
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
            <span class="text-9px leading-13px">{{ uploading ? '上传中…' : '待上传' }}</span>
            <span class="absolute inset-x-0 bottom-10px text-9px leading-12px text-center text-muted"
              >已选 {{ urls.length }}/{{ spec.max }}</span
            >
          </button>
        </li>
      </ul>
    </div>

    <!-- 有图（single）：在上传卡里看图，图高封顶 340；右上删除，下方换一张 -->
    <div v-else :class="cardCls">
      <div
        v-for="(url, i) in urls"
        :key="url + i"
        class="relative grid place-items-center overflow-hidden rounded-8px border border-solid border-line bg-surface3"
      >
        <video
          v-if="isVideo"
          :src="url"
          class="block w-full max-h-[340px] object-contain bg-black"
          controls
          preload="metadata"
        />
        <img
          v-else
          :src="url"
          :alt="`${spec.label} 第 ${i + 1} 张`"
          class="block max-w-full max-h-[340px] object-contain"
        />
        <StudioMedBtn
          :label="`删除${spec.label}第 ${i + 1} 个`"
          class="top-8px right-8px disabled:(opacity-45 cursor-not-allowed)"
          :disabled="disabled"
          @click="remove(i)"
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
      <button
        v-if="spec.max === 1"
        type="button"
        class="ll-pill mt-10px"
        :class="focusRing"
        :disabled="disabled || uploading"
        @click="pick"
      >
        {{ uploading ? '上传中…' : '换一张' }}
      </button>
    </div>
  </div>
</template>

<style>
/*
 * 只留 @keyframes：UnoCSS 的 animate-[…] 只引用名字，关键帧本身写不成原子类。
 * 不加 scoped——scoped 会给关键帧名加哈希，模板里的原子类就对不上了；名字带 tus- 前缀避免撞名。
 * 数值照抄 s1.1 BounceBallIcon（1300ms · 18px · 落地 1.10/.90 · 起跳 1.08/.92）与 .sx-preview-in（120ms + 4px）。
 */
@keyframes tus-ball-jump {
  0% {
    transform: translateY(0);
    animation-timing-function: ease-in;
  }
  10% {
    transform: translateY(2px);
    animation-timing-function: cubic-bezier(0.16, 0.84, 0.44, 1);
  }
  20% {
    transform: translateY(-8px);
    animation-timing-function: ease-out;
  }
  40% {
    transform: translateY(-18px);
    animation-timing-function: cubic-bezier(0.55, 0, 0.85, 0.36);
  }
  60% {
    transform: translateY(-10px);
    animation-timing-function: ease-in;
  }
  72% {
    transform: translateY(-2px);
    animation-timing-function: cubic-bezier(0.55, 0, 0.85, 0.36);
  }
  78% {
    transform: translateY(0);
    animation-timing-function: cubic-bezier(0.16, 0.84, 0.44, 1);
  }
  88% {
    transform: translateY(-4px);
    animation-timing-function: ease-in;
  }
  95% {
    transform: translateY(0);
    animation-timing-function: ease-out;
  }
  100% {
    transform: translateY(0);
  }
}
@keyframes tus-ball-shell {
  0% {
    transform: scale(1, 1);
  }
  10% {
    transform: scale(1.08, 0.92);
  }
  20% {
    transform: scale(0.97, 1.05);
  }
  40% {
    transform: scale(1, 1);
  }
  60% {
    transform: scale(0.99, 1.02);
  }
  78% {
    transform: scale(1.1, 0.9);
  }
  88% {
    transform: scale(0.98, 1.03);
  }
  95% {
    transform: scale(1.05, 0.96);
  }
  100% {
    transform: scale(1, 1);
  }
}
@keyframes tus-ball-ground {
  0% {
    transform: scale(0.85, 0.8);
    opacity: 0.75;
  }
  10% {
    transform: scale(0.82, 0.9);
    opacity: 0.98;
  }
  20% {
    transform: scale(0.95, 0.75);
    opacity: 0.55;
  }
  40% {
    transform: scale(1.15, 0.75);
    opacity: 0.3;
  }
  60% {
    transform: scale(1.02, 0.8);
    opacity: 0.55;
  }
  78% {
    transform: scale(0.78, 0.95);
    opacity: 1;
  }
  88% {
    transform: scale(0.9, 0.8);
    opacity: 0.65;
  }
  95% {
    transform: scale(0.82, 0.9);
    opacity: 0.95;
  }
  100% {
    transform: scale(0.85, 0.8);
    opacity: 0.75;
  }
}
@keyframes tus-preview-in {
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
