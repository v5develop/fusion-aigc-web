<script setup lang="ts">
/**
 * 商拍换装 · 「精细读图」勾选 + 「AI 找细节 / 裁切缩略图 / 重新裁切」（反推交付包验收 F7 / F10 / F33，PAGE_CONTRACT §1.4）。
 *
 * <ul>
 *   <li>精细读图：默认不勾；勾选后反推读图更慢、设计细节更多（适合设计复杂 / 小图案 / 五金刺绣），不另收费；</li>
 *   <li>AI 找细节并裁切：POST /studio/tryon/details（免费），按图片内容回每张服装图的细节框；缩略图在本地按框从原图取景
 *       （CSS 背景定位，**不调裁图接口**）。可删单张、「重新裁切」（再找一次，整体替换）、「清空裁切」；</li>
 *   <li>找过细节后提交带 detail_crops + detail_crops_manual=true：服务端只用这些框（删光 = 不用细节图）；
 *       没点过 = 服务端自动找细节，与以前一样。生图时按模型参考图上限截取，超出的不参与生成（提交响应会提示）。</li>
 * </ul>
 * 服装图 / 单品变了由父级清空（框按 garment_images 下标对应，图一换就对不上）。
 */
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { studioTryonDetails } from '@/api/studio.ts'
import { toApiError } from '@/api/index.ts'
import type { StudioDetailCrop, StudioGarmentImage } from '@/api/studioTypes.ts'

const props = defineProps<{
  /** 将要提交的 garment_images（顺序即 garment_index） */
  garments: StudioGarmentImage[]
  items: string[]
  setMode: string
  fabric?: string
  prompt?: string
  /** 生图时最多能用的细节图张数（模型参考图上限 − 服装图 − 模特 1）；0 = 不知道 */
  budget: number
  disabled?: boolean
}>()

const crops = defineModel<StudioDetailCrop[]>('crops', { required: true })
/** true = 找过细节（提交带 detail_crops_manual） */
const manual = defineModel<boolean>('manual', { required: true })
const fineRead = defineModel<boolean>('fineRead', { required: true })

const busy = ref(false)
const error = ref('')
const warnings = ref<string[]>([])

const canDetect = computed(() => !busy.value && !props.disabled && props.garments.length > 0 && props.items.length > 0)

/** 请求期间服装图 / 单品变了：回包按下标已对不上，丢弃（父级已清空细节框） */
const inputSig = () => JSON.stringify([props.items, props.setMode, props.garments])
/** 卸载后（单品清空时本组件 v-if 掉）回包也丢弃，免得把旧细节框写回父级 */
let alive = true
onBeforeUnmount(() => {
  alive = false
})

async function detect() {
  if (!canDetect.value) return
  const sig = inputSig()
  busy.value = true
  error.value = ''
  warnings.value = []
  try {
    const res = await studioTryonDetails({
      items: [...props.items],
      set_mode: props.setMode,
      garment_images: props.garments.map((g) => ({ ...g })),
      fabric: props.fabric || undefined,
      prompt: props.prompt || undefined,
    })
    if (!alive || sig !== inputSig()) return
    const d = res.data
    crops.value = (d?.plans ?? []).flatMap((p) => p.crops ?? [])
    manual.value = true
    warnings.value = d?.warnings ?? []
  } catch (err) {
    if (!alive || sig !== inputSig()) return
    const e = toApiError(err)
    error.value =
      e?.httpStatus === 404 && e.code === -1
        ? 'AI 找细节暂未开放，提交后服务端会自动找细节'
        : !e || e.isNetwork
          ? 'AI 找细节超时或网络中断，可以稍后重试，或直接提交（服务端会自动找细节）'
          : e.message || 'AI 找细节失败，可以稍后重试，或直接提交（服务端会自动找细节）'
  } finally {
    busy.value = false
  }
}

function removeCrop(i: number) {
  crops.value = crops.value.filter((_, k) => k !== i)
}

/** 清空：回到「没找过」——提交时由服务端自动找细节 */
function clearAll() {
  crops.value = []
  manual.value = false
  warnings.value = []
  error.value = ''
}

/** 删光（找过但一张不留）：提交时不用细节图 */
const keptNone = computed(() => manual.value && !crops.value.length)
const overBudget = computed(() => props.budget > 0 && crops.value.length > props.budget)

// ---------------- 缩略图：按原图尺寸等比取景 ----------------

const THUMB = 56
const natural = reactive<Record<string, { w: number; h: number }>>({})
function ensureSize(url: string) {
  if (!url || natural[url]) return
  natural[url] = { w: 0, h: 0 }
  const img = new Image()
  img.onload = () => {
    natural[url] = { w: img.naturalWidth, h: img.naturalHeight }
  }
  img.src = url
}
watch(
  () => crops.value.map((c) => props.garments[c.garment_index]?.url ?? ''),
  (urls) => urls.forEach(ensureSize),
  { immediate: true },
)

function thumbStyle(c: StudioDetailCrop) {
  const url = props.garments[c.garment_index]?.url ?? ''
  const size = natural[url]
  const [x = 0, y = 0, w = 1, h = 1] = c.box
  if (!size?.w || !size.h) {
    // 尺寸还没拿到：按比例近似（可能轻微拉伸），拿到后换成等比
    return {
      backgroundImage: `url(${url})`,
      backgroundSize: `${100 / w}% ${100 / h}%`,
      backgroundPosition: `${w < 1 ? (x / (1 - w)) * 100 : 0}% ${h < 1 ? (y / (1 - h)) * 100 : 0}%`,
    }
  }
  const cw = w * size.w
  const ch = h * size.h
  const s = THUMB / Math.max(cw, ch)
  const offX = (THUMB - cw * s) / 2 - x * size.w * s
  const offY = (THUMB - ch * s) / 2 - y * size.h * s
  return {
    backgroundImage: `url(${url})`,
    backgroundSize: `${size.w * s}px ${size.h * s}px`,
    backgroundPosition: `${offX}px ${offY}px`,
  }
}

/** 部位名去掉「单品·」前缀（悬停显示全名） */
const shortLabel = (label: string) => label.split('·').slice(-1)[0] || label
</script>

<template>
  <section class="flex flex-col gap-6px pt-5px" aria-labelledby="tryon-detail-title">
    <div class="flex items-center gap-8px min-w-0">
      <h2 id="tryon-detail-title" class="m-0 text-12px font-600 text-ink">细节裁切</h2>
      <label
        class="flex items-center gap-4px text-11px text-ink-2 cursor-pointer select-none"
        title="7–10 秒，设计细节更多，适合设计复杂 / 小图案 / 五金刺绣；不另收费"
      >
        <input v-model="fineRead" type="checkbox" class="m-0 accent-violet" :disabled="disabled" />
        精细读图
      </label>
      <span class="ml-auto flex items-center gap-4px">
        <button
          type="button"
          class="sx-btn-ghost !text-violet-ink hover:!text-violet-press"
          :disabled="!canDetect"
          :title="garments.length ? '' : '先上传服装图'"
          @click="detect"
        >
          {{ busy ? 'AI 找细节中…' : manual ? '重新裁切' : 'AI 找细节并裁切' }}
        </button>
        <button v-if="manual" type="button" class="sx-btn-ghost" :disabled="busy || disabled" @click="clearAll">
          清空裁切
        </button>
      </span>
    </div>
    <p v-if="fineRead" class="m-0 text-11px leading-16px text-muted">
      精细读图：读图更慢（多约 5–10 秒），设计细节更多，不另收费
    </p>

    <p v-if="busy" class="m-0 text-11px leading-16px text-violet-ink" role="status" aria-live="polite">
      AI 正在按图片内容找细节，通常要几十秒到 1 分钟，可以先填别的
    </p>
    <p v-else-if="error" class="m-0 text-11px leading-16px text-danger" role="alert">{{ error }}</p>
    <ul v-if="warnings.length && !busy" class="m-0 pl-0 list-none text-11px leading-16px text-warning" role="note">
      <li v-for="w in warnings" :key="w">{{ w }}</li>
    </ul>

    <div v-if="crops.length" class="flex flex-wrap gap-6px" role="list" aria-label="细节裁切缩略图">
      <div
        v-for="(c, i) in crops"
        :key="`${c.garment_index}-${c.label}-${i}`"
        class="group relative w-56px"
        role="listitem"
      >
        <span
          class="block w-56px h-56px box-border rounded-4px border border-solid border-line bg-surface3 bg-no-repeat"
          :style="thumbStyle(c)"
          :title="`${c.label}（服装图 ${c.garment_index + 1}）`"
        />
        <span class="block mt-2px text-10px leading-14px text-muted truncate" :title="c.label">{{
          shortLabel(c.label)
        }}</span>
        <button
          type="button"
          class="absolute top-[-6px] right-[-6px] grid place-items-center w-18px h-18px p-0 rounded-full border border-solid border-line bg-white text-11px leading-none text-ink-2 cursor-pointer after:(content-empty absolute -inset-7px rounded-full) opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 focus-visible:opacity-100"
          :aria-label="`删除细节图 ${c.label}`"
          :disabled="disabled"
          @click="removeCrop(i)"
        >
          ×
        </button>
      </div>
    </div>
    <p class="m-0 text-11px leading-16px text-placeholder">
      <template v-if="!manual">不点也可以：提交后服务端会自动找细节。</template>
      <template v-else-if="keptNone">已删光细节图：本次只用服装原图生成；点「清空裁切」恢复自动找细节。</template>
      <template v-else>
        已选 {{ crops.length }} 张细节图<template v-if="budget > 0">，当前模型最多用 {{ budget }} 张</template>
        <span v-if="overBudget" class="text-warning">，多出的 {{ crops.length - budget }} 张不参与生成</span>。
      </template>
    </p>
  </section>
</template>
