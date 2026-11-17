<script setup lang="ts">
/**
 * 对话卡片：多比例导出（CONTRACT §N，免费）。
 * 事件帧里的签名地址被清洗剔除：挂载后用只读 GET /jobs/:id/exports 取现签地址并按 ratio+mode 匹配，
 * 临近过期 / 播放出错时补拉一次，不轮询；拉取失败保留占位。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { replicateListExports, urlExpiringSoon, type ReplicateExport } from '@/api/replicate.ts'

const props = defineProps<{ view: ReplicateExport }>()

const fetched = ref<ReplicateExport | null>(null)
const cur = computed(() => ({ ...props.view, ...(fetched.value ?? {}) }))
const url = computed(() => cur.value.videoUrl || '')
const failed = ref(false)
const show = computed(() => !!url.value && !failed.value)

const modeText = computed(() => (props.view.mode === 'crop' ? '居中裁切' : '加模糊背景，不裁画面'))
const LIBRARY: Record<string, string> = { saved: '已存入资产库', saving: '正在存入资产库…', pending: '正在存入资产库…', failed: '没能存入资产库' }
const libraryText = computed(() => {
  const raw = cur.value.library
  // Go LibraryView {status, state} 同值；兼容旧的纯字符串
  const l = typeof raw === 'string' ? raw : (raw?.state ?? raw?.status ?? '')
  return l ? (LIBRARY[l] ?? l) : ''
})
/** 比例框：宽度不超过「高 360px」对应的宽，窄屏按容器宽 */
const box = computed(() => {
  const [w = 0, h = 0] = props.view.ratio.split(':').map(Number)
  const ok = w > 0 && h > 0
  return { aspectRatio: ok ? `${w} / ${h}` : '9 / 16', width: `min(100%, ${ok ? Math.round((360 * w) / h) : 203}px)` }
})

let timer: ReturnType<typeof setTimeout> | undefined
let alive = true
let inFlight = false
const MAX_TIMEOUT = 2 ** 31 - 1
const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

async function refresh() {
  if (!alive || inFlight) return
  inFlight = true
  try {
    const res = await replicateListExports(props.view.jobId)
    if (!alive) return
    const hit = (res.data?.exports ?? []).find((e) => e.ratio === props.view.ratio && e.mode === props.view.mode)
    if (hit) {
      fetched.value = hit
      failed.value = false
    }
  } catch {
    // 失败：保留占位，不重试
  } finally {
    inFlight = false
  }
  schedule()
}
function schedule() {
  clearTimeout(timer)
  const exp = fetched.value?.urlExpiresAt
  if (!alive || hidden() || !exp) return
  timer = setTimeout(refresh, Math.min(Math.max(new Date(exp).getTime() - Date.now() - 60_000, 5000), MAX_TIMEOUT))
}
function onVisible() {
  if (hidden()) return clearTimeout(timer)
  if (!fetched.value || urlExpiringSoon(fetched.value.urlExpiresAt)) void refresh()
  else schedule()
}
function onError() {
  failed.value = true
  void refresh()
}
function download() {
  if (url.value) window.open(url.value, '_blank', 'noopener')
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
watch(
  () => [props.view.jobId, props.view.ratio, props.view.mode],
  () => {
    fetched.value = null
    failed.value = false
    void refresh()
  },
)
</script>

<template>
  <section class="sx-squircle w-full max-w-520px rounded-18px sx-soft px-16px py-14px" aria-label="多比例导出">
    <h3 class="vr-h3">{{ view.ratio }} 版本</h3>
    <p class="vr-sub">{{ modeText }}</p>
    <div class="mx-auto overflow-hidden rounded-12px bg-violet-tint" :style="box">
      <video v-if="show" :src="url" controls playsinline preload="metadata" class="block h-full w-full bg-black object-contain" @error="onError" />
      <div v-else class="flex h-full w-full items-center justify-center px-12px text-center text-13px text-muted">视频地址暂时没拿到，稍后会自动刷新</div>
    </div>
    <p v-if="libraryText" class="m-0 mt-8px text-12px leading-18px text-muted" role="status">{{ libraryText }}</p>
    <div class="mt-8px flex flex-wrap gap-8px">
      <button type="button" class="sx-btn !h-32px" :disabled="!show" @click="download">下载</button>
    </div>
  </section>
</template>
