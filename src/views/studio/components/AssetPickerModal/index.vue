<script setup lang="ts">
/**
 * 从资产库选图 / 选视频（s1.1 图片入口的云钮；工具页视频槽的「资产添加」）。
 *
 * <p>只读：GET /api/v1/asset-library/assets（media=image，或调用方传 media="video" 时为 video）+ 分类条计数，不做任何写入。
 * 筛选与资产库页一致：分类（kind）+ 来源（source）+ 关键词（q）。
 * 选中后把图片 URL（视频模式为 video_url）数组交回调用方（http/https 以外的地址不展示，契约拒收 blob: / data:），
 * 调用方按上传同一条路径入组（上限 / 提示 / 角度规则不变）。
 * limit=1 时点一张即选中并关闭；多选时点「使用」确认。
 */
import { computed, ref, watch } from 'vue'
import { assetLibCategories, assetLibList } from '@/api/assetLibrary.ts'
import type { IAssetLibAsset, IAssetLibCategory } from '@/api/assetLibrary.ts'
import { useDebounce } from '@/utils/hooks/index.ts'

const show = defineModel<boolean>('show', { required: true })

const { limit = 1, media = 'image' } = defineProps<{
  /** 本次最多还能选几张 */
  limit?: number
  /** 选哪类资产；不传 = 图片（原有行为） */
  media?: 'image' | 'video'
}>()

const emit = defineEmits<{
  select: [urls: string[]]
}>()

const SOURCES = [
  { key: '', label: '全部来源' },
  { key: 'upload', label: '我上传的' },
  { key: 'generated', label: 'AI 生成' },
  { key: 'official', label: '官方' },
] as const

const PAGE_SIZE = 30

const kind = ref('all')
const source = ref('')
const keyword = ref('')
const categories = ref<IAssetLibCategory[]>([])
const items = ref<IAssetLibAsset[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const loadingMore = ref(false)
const failed = ref(false)
const chosen = ref<string[]>([])
/** 防乱序：只认最后一次请求 */
let seq = 0

const hasMore = computed(() => items.value.length < total.value)
const isHttp = (url: string) => /^https?:\/\//i.test(url)
const isVideoMode = computed(() => media === 'video')
const mediaWord = computed(() => (isVideoMode.value ? '视频' : '图片'))
/** 交回调用方的地址：图片取 image，视频取 video_url（image 是封面） */
const pickUrl = (a: IAssetLibAsset) => (isVideoMode.value ? a.video_url : a.image)

async function fetchPage(reset: boolean) {
  if (!show.value) return
  const my = ++seq
  if (reset) {
    loading.value = true
    loadingMore.value = false
    failed.value = false
    page.value = 1
  } else {
    loadingMore.value = true
  }
  try {
    const res = await assetLibList({
      kind: kind.value === 'all' ? undefined : kind.value,
      source: source.value || undefined,
      media,
      q: keyword.value.trim().slice(0, 100) || undefined,
      page: page.value,
      page_size: PAGE_SIZE,
    })
    if (my !== seq) return
    const list = (res.data?.items ?? []).filter((a) => a.media === media && isHttp(pickUrl(a)))
    items.value = reset ? list : [...items.value, ...list]
    total.value = res.data?.total ?? 0
  } catch {
    if (my !== seq) return
    failed.value = true
    if (reset) {
      items.value = []
      total.value = 0
    } else {
      page.value -= 1
    }
  } finally {
    if (my === seq) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

async function fetchCategories() {
  try {
    const res = await assetLibCategories({ source: source.value || undefined, media })
    categories.value = res.data?.items ?? []
  } catch {
    categories.value = []
  }
}

function reload() {
  void fetchPage(true)
}

function loadMore() {
  if (loadingMore.value || loading.value || !hasMore.value) return
  page.value += 1
  void fetchPage(false)
}

function toggle(asset: IAssetLibAsset) {
  const url = pickUrl(asset)
  if (limit <= 1) {
    emit('select', [url])
    show.value = false
    return
  }
  const at = chosen.value.indexOf(url)
  if (at >= 0) chosen.value.splice(at, 1)
  else if (chosen.value.length < limit) chosen.value.push(url)
}

function confirm() {
  if (!chosen.value.length) return
  emit('select', [...chosen.value])
  show.value = false
}

// 打开时重置筛选；分类 / 来源变化重新拉。关键词走防抖，避免与重置叠成两次请求
watch(
  show,
  (open) => {
    if (!open) return
    kind.value = 'all'
    source.value = ''
    keyword.value = ''
    chosen.value = []
    void fetchCategories()
    reload()
  },
  { immediate: true },
)
watch(source, () => {
  if (!show.value) return
  void fetchCategories()
  reload()
})
watch(kind, () => {
  if (show.value) reload()
})
useDebounce({ data: keyword, callback: reload, delay: 300 })
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :title="isVideoMode ? '从资产库添加视频' : '从资产库添加图片'"
    :style="{ width: '760px', maxWidth: 'calc(100vw - 48px)' }"
  >
    <div class="flex flex-col gap-10px">
      <div class="flex gap-10px items-center">
        <div class="flex gap-8px flex-wrap">
          <span
            v-for="s in SOURCES"
            :key="s.key"
            class="ll-pill"
            :class="{ 'll-pill-active': source === s.key }"
            @click="source = s.key"
            >{{ s.label }}</span
          >
        </div>
        <n-input
          v-model:value="keyword"
          size="small"
          clearable
          placeholder="搜标题 / 提示词"
          class="!w-200px ml-auto"
        />
      </div>
      <div v-if="categories.length" class="flex gap-8px flex-wrap">
        <span
          v-for="c in categories"
          :key="c.key"
          class="ll-pill"
          :class="{ 'll-pill-active': kind === c.key }"
          @click="kind = c.key"
          >{{ c.label }} {{ c.count }}</span
        >
      </div>

      <div class="max-h-[min(52vh,480px)] min-h-200px overflow-y-auto" v-loading="loading">
        <div v-if="failed && !loading && !items.length" class="py-40px text-center text-12px text-placeholder">
          资产加载失败
          <span class="ll-link ml-6px" @click="reload">重试</span>
        </div>
        <div v-else-if="!loading && !items.length" class="py-40px text-center text-12px text-placeholder">
          没有匹配的{{ mediaWord }}资产，换个分类或关键词试试
        </div>
        <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-10px">
          <button
            v-for="a in items"
            :key="a.id"
            type="button"
            class="relative aspect-[3/4] p-0 overflow-hidden border-2 border-solid rounded-8px bg-surface2 cursor-pointer focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-violet"
            :class="chosen.includes(pickUrl(a)) ? 'border-violet' : 'border-transparent hover:border-violet-line'"
            :title="a.title"
            :aria-label="a.title || `资产${mediaWord}`"
            :aria-pressed="chosen.includes(pickUrl(a))"
            @click="toggle(a)"
          >
            <img
              v-if="isHttp(a.image)"
              class="block w-full h-full object-cover"
              :src="a.image"
              :alt="a.title"
              loading="lazy"
            />
            <video
              v-else
              class="block w-full h-full object-cover pointer-events-none"
              :src="a.video_url"
              preload="metadata"
              muted
              playsinline
              aria-hidden="true"
            />
            <span
              v-if="isVideoMode"
              class="absolute left-4px bottom-4px px-4px rounded-4px bg-black/55 text-white text-10px leading-16px"
              aria-hidden="true"
              >视频</span
            >
            <span
              v-if="chosen.includes(pickUrl(a))"
              class="absolute top-4px right-4px grid place-items-center w-18px h-18px rounded-full bg-violet text-white text-11px"
              >{{ chosen.indexOf(pickUrl(a)) + 1 }}</span
            >
          </button>
        </div>
        <div v-if="loadingMore" class="py-8px text-11px text-center text-placeholder">加载中…</div>
        <div
          v-else-if="hasMore && items.length && !failed"
          class="ll-link py-8px !text-11px text-center"
          @click="loadMore"
        >
          加载更多（{{ items.length }}/{{ total }}）
        </div>
        <div v-else-if="failed && items.length" class="py-8px text-11px text-center text-placeholder">
          加载更多失败，<span class="ll-link" @click="loadMore">重试</span>
        </div>
      </div>
    </div>
    <template v-if="limit > 1" #footer>
      <div class="flex items-center justify-end gap-10px">
        <span class="text-12px text-muted">已选 {{ chosen.length }}/{{ limit }}</span>
        <n-button size="small" @click="show = false">取消</n-button>
        <n-button size="small" type="primary" :disabled="!chosen.length" @click="confirm">使用</n-button>
      </div>
    </template>
  </n-modal>
</template>
