<script setup lang="ts">
import { modelLabelsOf } from '@/utils/model-label'
/**
 * 从提示词库选择（商拍 / 图片生成页融合提示词库的弹层）。
 *
 * <p>页签：官方电商（vertical=ecommerce）/ 官方通用（general）/ 我的（mine）+ 关键词搜索，
 * 复用 GET /api/v1/prompt-library/prompts（promptLibList），页内自己实现弹层，
 * 不 import prompt-library 页面的组件。选中条目把 prompt 交回页面填入输入框。
 */
import { computed, ref, watch } from 'vue'
import { promptLibList } from '@/api/prompt-library.ts'
import type { IPromptLibItem } from '@/api/prompt-library.ts'
import { useDebounce } from '@/utils/hooks/index.ts'

const show = defineModel<boolean>('show', { required: true })

const emit = defineEmits<{
  /** 选中一条提示词，交回页面的 prompt 输入框 */
  select: [prompt: string]
}>()

const TABS = [
  { key: 'ecommerce', label: '官方电商' },
  { key: 'general', label: '官方通用' },
  { key: 'mine', label: '我的' },
] as const

const PAGE_SIZE = 20

const tab = ref<string>('ecommerce')
const keyword = ref('')
const items = ref<IPromptLibItem[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const loadingMore = ref(false)
const hasMore = computed(() => items.value.length < total.value)

async function fetchPage(reset: boolean) {
  if (!show.value) return
  if (reset) {
    loading.value = true
    page.value = 1
  } else {
    loadingMore.value = true
  }
  try {
    const res = await promptLibList({
      vertical: tab.value,
      q: keyword.value.trim() || undefined,
      page: page.value,
      pageSize: PAGE_SIZE,
    })
    const list = res.data?.items ?? []
    items.value = reset ? list : [...items.value, ...list]
    total.value = res.data?.total ?? 0
  } catch {
    // 业务失败拦截器已 toast，弹层自身保持原列表
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function reload() {
  void fetchPage(true)
}

function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  page.value += 1
  void fetchPage(false)
}

function choose(item: IPromptLibItem) {
  emit('select', item.prompt)
  show.value = false
}

watch(
  () => [show.value, tab.value] as const,
  ([open]) => {
    if (!open) return
    keyword.value = ''
    reload()
  },
  { immediate: true },
)

useDebounce({ data: keyword, callback: reload, delay: 300 })

const excerpt = (item: IPromptLibItem) => item.prompt.replace(/\s+/g, ' ').trim()
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    title="从提示词库选择"
    :style="{ width: '720px', maxWidth: 'calc(100vw - 48px)' }"
  >
    <div class="flex flex-col gap-10px">
      <div class="flex gap-10px items-center">
        <div class="flex gap-8px flex-wrap">
          <span
            v-for="t in TABS"
            :key="t.key"
            class="ll-pill !min-h-32px !text-13px"
            :class="{ 'll-pill-active': tab === t.key }"
            @click="tab = t.key"
            >{{ t.label }}</span
          >
        </div>
        <n-input
          v-model:value="keyword"
          size="small"
          clearable
          placeholder="搜标题 / 提示词"
          class="!w-220px ml-auto"
        />
      </div>

      <div
        class="stu-scroll flex flex-col gap-8px max-h-[min(52vh,480px)] overflow-y-auto [scrollbar-gutter:stable]"
        v-loading="loading"
      >
        <button
          v-for="item in items"
          :key="item.id"
          type="button"
          class="group flex flex-col gap-5px px-12px py-10px text-left border border-solid border-line rounded-8px bg-white cursor-pointer transition-[border-color,background-color] duration-180 ease-[cubic-bezier(0.2,0.7,0.2,1)] hover:border-violet-line hover:bg-#faf7fc"
          @click="choose(item)"
        >
          <span class="text-13px font-600 text-ink">{{ item.title }}</span>
          <span class="line-clamp-2 overflow-hidden text-11px leading-17px text-muted">{{ excerpt(item) }}</span>
          <span class="flex gap-6px items-center flex-wrap">
            <span v-for="m in modelLabelsOf(item.models)" :key="`m-${item.id}-${m}`" class="ll-tag !cursor-default">{{
              m
            }}</span>
            <span v-for="tg in item.tags" :key="`t-${item.id}-${tg}`" class="ll-tag !cursor-default">#{{ tg }}</span>
            <span
              class="ml-auto text-11px text-violet opacity-0 transition-opacity duration-110 ease-[cubic-bezier(0.2,0.7,0.2,1)] group-hover:opacity-100"
              >点击使用 →</span
            >
          </span>
        </button>

        <div v-if="!loading && !items.length" class="py-40px text-center text-placeholder text-12px">
          这个页签下没有匹配的提示词，换个关键词试试
        </div>
        <div v-if="loadingMore" class="py-6px pb-2px text-11px text-center">加载中…</div>
        <div v-else-if="hasMore && items.length" class="ll-link pt-6px pb-2px !text-13px text-center" @click="loadMore">
          加载更多（{{ items.length }}/{{ total }}）
        </div>
      </div>
    </div>
  </n-modal>
</template>

<style scoped lang="less">
@import '@/assets/variables.less';

/* 滚动条 mixin 无法用原子类表达 */
.stu-scroll {
  .scrollbar-autohide(@width: 8px, @trackColor: #fff, @thumbColor: rgba(0, 0, 0, 0.1), @thumbWidth: 4px, @hoverColor: rgba(0, 0, 0, 0.35));
}
</style>
