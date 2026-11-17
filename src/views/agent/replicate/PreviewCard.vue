<script setup lang="ts">
/**
 * 对话卡片：定妆图（替换后的第 1 帧预览，免费，不是成片）。
 * 事件帧里的签名地址会被清洗剔除：挂载后用只读 GET /plans/:no/preview 拉一次现签地址（原片帧 + 预览图并排），
 * 地址临近过期或页面回到前台时补拉一次，不轮询；拉取失败 / 不存在时保留占位，卡片仍显示事件帧里的数据。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { replicateGetPreview, urlExpiringSoon, type ReplicatePreview } from '@/api/replicate.ts'
import MediaLightbox from '@/components/MediaLightbox/index.vue'

const props = defineProps<{ view: ReplicatePreview }>()

/** 以最新拉到的为准；还没拉到（或失败）时用事件帧里的 view */
const fetched = ref<ReplicatePreview | null>(null)
const cur = computed(() => ({ ...props.view, ...(fetched.value ?? {}) }))

const left = computed(() => Math.max(0, (cur.value.quotaTotal || 0) - (cur.value.quotaUsed || 0)))
const url = computed(() => cur.value.imageUrl || '')
const frame = computed(() => cur.value.frameUrl || '')
const failedImg = ref(false)
const failedFrame = ref(false)
const showImg = computed(() => !!url.value && !failedImg.value)
const showFrame = computed(() => !!frame.value && !failedFrame.value)

let timer: ReturnType<typeof setTimeout> | undefined
let alive = true
let inFlight = false
/** setTimeout 的上限（约 24.8 天） */
const MAX_TIMEOUT = 2 ** 31 - 1

const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

async function refresh() {
  const no = props.view.planNo
  if (!alive || inFlight || !no) return
  inFlight = true
  try {
    const res = await replicateGetPreview(no)
    if (!alive) return
    if (res.data) {
      fetched.value = res.data
      failedImg.value = false
      failedFrame.value = false
    }
  } catch {
    // 失败 / 不存在：保留占位，不重试
  } finally {
    inFlight = false
  }
  schedule()
}

/** 只在有过期时间时挂一次续签（到期前 60 秒），不轮询 */
function schedule() {
  clearTimeout(timer)
  const exp = fetched.value?.urlExpiresAt
  if (!alive || hidden() || !exp) return
  const ms = new Date(exp).getTime() - Date.now() - 60_000
  timer = setTimeout(refresh, Math.min(Math.max(ms, 5000), MAX_TIMEOUT))
}

function onVisible() {
  if (hidden()) return clearTimeout(timer)
  if (!fetched.value || urlExpiringSoon(fetched.value.urlExpiresAt)) void refresh()
  else schedule()
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisible)
  void refresh()
})
onBeforeUnmount(() => {
  alive = false
  clearTimeout(timer)
  document.removeEventListener('visibilitychange', onVisible)
})
// 同一张卡换了方案：重新拉
watch(
  () => props.view.planNo,
  () => {
    fetched.value = null
    void refresh()
  },
)

const lightboxShow = ref(false)
const lightboxIndex = ref(0)
/** 放大查看：原片帧在前、预览图在后（按实际有的项排） */
const lightboxEntries = computed(() => {
  const list: { key: 'frame' | 'img'; url: string; name: string }[] = []
  if (showFrame.value) list.push({ key: 'frame', url: frame.value, name: '原片' })
  if (showImg.value) list.push({ key: 'img', url: url.value, name: '预览图' })
  return list
})
const lightboxItems = computed(() => lightboxEntries.value.map((e) => ({ url: e.url, type: 'image' as const, name: e.name })))
function open(key: 'frame' | 'img') {
  lightboxIndex.value = Math.max(0, lightboxEntries.value.findIndex((e) => e.key === key))
  lightboxShow.value = true
}
</script>

<template>
  <section class="sx-squircle w-full max-w-520px rounded-18px sx-soft px-16px py-14px" aria-label="预览图">
    <h3 class="vr-h3">预览图已生成</h3>
    <p class="vr-sub">换好之后第 1 帧大概的样子，满意再开始做</p>
    <!-- 容器够宽时并排，窄时自动堆叠 -->
    <div class="grid gap-8px" style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))">
      <div v-if="showFrame" class="relative overflow-hidden rounded-12px bg-violet-tint">
        <button
          type="button"
          class="block w-full cursor-zoom-in border-0 bg-transparent p-0"
          aria-label="点击放大原片"
          @click="open('frame')"
        >
          <img :src="frame" alt="原片" class="block max-h-360px w-full object-contain" @error="failedFrame = true" />
        </button>
        <span class="absolute left-8px top-8px rounded-full bg-black/60 px-10px py-3px text-12px font-500 leading-18px text-white">原片</span>
      </div>
      <div class="relative overflow-hidden rounded-12px bg-violet-tint">
        <button
          v-if="showImg"
          type="button"
          class="block w-full cursor-zoom-in border-0 bg-transparent p-0"
          aria-label="点击放大预览图"
          @click="open('img')"
        >
          <img :src="url" alt="预览图" class="block max-h-360px w-full object-contain" @error="failedImg = true" />
        </button>
        <div v-else class="flex h-180px w-full items-center justify-center text-13px text-muted">预览图已生成</div>
        <span class="absolute left-8px top-8px rounded-full bg-black/60 px-10px py-3px text-12px font-500 leading-18px text-white">预览图，不是成片</span>
      </div>
    </div>
    <p class="m-0 mt-8px text-12px leading-18px text-muted" role="status">今天还能免费预览 {{ left }} 次</p>
    <MediaLightbox v-model:show="lightboxShow" v-model:index="lightboxIndex" :items="lightboxItems" />
  </section>
</template>
