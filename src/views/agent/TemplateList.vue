<script setup lang="ts">
/**
 * 行业版 · 图片 / 视频列表（TemplateBrowser 的一个面板）：GET /api/v1/plaza/templates（industry 必填），
 * 行业 / 二级 / 类型 / 搜索词任一变化重拉（seq 防乱序，搜索词 300ms 防抖），「加载更多」续页（不重播入场动画）。
 * 空态按场景给文案：搜索无结果 / 二级下没有 / 行业下没有该类型。
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { isIndustryGate, plazaErrorText, plazaTemplates } from './industry/plazaScope.ts'
import type { IPlazaTemplate } from '@/api/plaza.ts'
import PageEmpty from '@/components/PageEmpty/index.vue'
import PageLoadError from '@/components/PageLoadError/index.vue'
import TemplateCard from './TemplateCard.vue'

const props = defineProps<{
  industry: string
  industryName: string
  sub: string
  subName: string
  mediaType: 'image' | 'video'
  keyword: string
  /** 另一类型的数量（>0 才给「看 X 模板」按钮） */
  otherCount: number
  pickedId?: number | null
  disabled?: boolean
}>()
const emit = defineEmits<{
  open: [item: IPlazaTemplate]
  loaded: [items: IPlazaTemplate[], total: number]
  gone: []
  switchTab: [tab: 'image' | 'video']
  clearSearch: []
  clearSub: []
}>()

const PAGE_SIZE = 24
const items = ref<IPlazaTemplate[]>([])
const total = ref(0)
const page = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const failed = ref(false)
const failMsg = ref('')
const moreFailed = ref(false)
/** 入场动画只在整体替换（行业 / Tab / 搜索）时播，续页不播 */
const entering = ref(true)
let seq = 0
let enterTimer: ReturnType<typeof setTimeout> | undefined

function params(next: number) {
  return {
    industry: props.industry,
    subIndustry: props.sub || undefined,
    mediaType: props.mediaType,
    keyword: props.keyword,
    page: next,
    size: PAGE_SIZE,
  }
}

async function fetchPage(next: number) {
  const s = seq
  const res = await plazaTemplates(params(next))
  if (s !== seq) return
  const d = res.data
  const rows = d?.data ?? []
  if (next === 1) items.value = rows
  else {
    const seen = new Set(items.value.map((t) => t.plazaTemplateId))
    items.value.push(...rows.filter((t) => !seen.has(t.plazaTemplateId)))
  }
  total.value = d?.total ?? items.value.length
  page.value = next
  hasMore.value = (d?.current ?? next) < (d?.pages ?? 0)
  emit('loaded', items.value, total.value)
}

async function reload() {
  const s = ++seq
  loading.value = true
  loadingMore.value = false
  failed.value = false
  failMsg.value = ''
  moreFailed.value = false
  entering.value = true
  clearTimeout(enterTimer)
  enterTimer = setTimeout(() => (entering.value = false), 900)
  try {
    await fetchPage(1)
  } catch (err) {
    if (s !== seq) return
    if (isIndustryGate(err)) {
      emit('gone')
      return
    }
    failed.value = true
    failMsg.value = plazaErrorText(err, '')
    items.value = []
    hasMore.value = false
    emit('loaded', [], 0)
  } finally {
    if (s === seq) loading.value = false
  }
}

async function loadMore() {
  if (loading.value || loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  moreFailed.value = false
  entering.value = false
  const s = seq
  try {
    await fetchPage(page.value + 1)
  } catch {
    if (s === seq) moreFailed.value = true
  } finally {
    if (s === seq) loadingMore.value = false
  }
}

let timer: ReturnType<typeof setTimeout> | undefined
watch(
  () => [props.industry, props.sub, props.mediaType] as const,
  () => {
    clearTimeout(timer)
    void reload()
  },
  { immediate: true },
)
watch(
  () => props.keyword.trim(),
  () => {
    clearTimeout(timer)
    timer = setTimeout(() => void reload(), 300)
  },
)
onBeforeUnmount(() => {
  clearTimeout(timer)
  clearTimeout(enterTimer)
})

const mediaName = () => (props.mediaType === 'image' ? '图片' : '视频')
</script>

<template>
  <div>
    <div v-if="loading && !items.length" class="flex justify-center py-40px"><n-spin size="small" /></div>
    <PageLoadError
      v-else-if="failed"
      compact
      :subtitle="failMsg || '服务暂时有点忙，稍后再试'"
      retryable
      @retry="reload"
    />
    <PageEmpty
      v-else-if="!items.length && keyword.trim()"
      compact
      :text="`没找到「${keyword.trim()}」相关的${industryName}模板`"
      description="只在这个行业里搜索，换个词试试"
    >
      <button type="button" class="sx-btn" @click="emit('clearSearch')">清除搜索</button>
    </PageEmpty>
    <PageEmpty
      v-else-if="!items.length && sub"
      compact
      :text="`${subName}下暂时没有${mediaName()}模板`"
    >
      <button type="button" class="sx-btn" @click="emit('clearSub')">不限细分</button>
    </PageEmpty>
    <PageEmpty v-else-if="!items.length" compact :text="`${industryName}暂时还没有${mediaName()}模板`" description="我们在加紧上新">
      <button v-if="otherCount > 0" type="button" class="sx-btn" @click="emit('switchTab', mediaType === 'image' ? 'video' : 'image')">
        看{{ mediaType === 'image' ? '视频' : '图片' }}模板
      </button>
    </PageEmpty>
    <template v-else>
      <div
        :class="[
          'grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-14px max-sm:grid-cols-1',
          entering ? 'is-entering' : '',
          loading ? 'opacity-60' : '',
        ]"
      >
        <TemplateCard
          v-for="(t, i) in items"
          :key="t.plazaTemplateId"
          :item="t"
          :picked="pickedId === t.plazaTemplateId"
          :disabled="disabled"
          :style="{ '--i': Math.min(i, 11) }"
          class="tpl-card"
          preview
          favorable
          @pick="emit('open', $event)"
        />
      </div>
      <div v-if="hasMore || moreFailed" class="mt-16px flex flex-col items-center gap-6px">
        <p v-if="moreFailed" class="m-0 text-12px text-danger" role="alert">没加载出来</p>
        <button type="button" class="sx-btn" :disabled="loadingMore" @click="loadMore">
          {{ loadingMore ? '加载中…' : moreFailed ? '重试' : '加载更多' }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.is-entering .tpl-card {
  animation: tpl-in 420ms cubic-bezier(0.22, 0.8, 0.3, 1) both;
  animation-delay: calc(var(--i, 0) * 35ms);
}
@keyframes tpl-in {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .is-entering .tpl-card {
    animation: none;
    opacity: 1;
    transform: none;
  }
}
</style>
