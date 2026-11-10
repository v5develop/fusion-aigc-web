<script setup lang="ts">
/**
 * 「选择AI文案」弹窗：各生成模块复用，选中后把文案 id 与正文带给表单。
 * 只列已完成的（status=1），与后端约定一致。
 */
import { computed, ref, watch } from 'vue'
import { llCopywritingList } from '@/api/local-life.ts'
import type { ILCopywriting } from '@/api/local-life-types.ts'

const show = defineModel<boolean>('show', { default: false })

const emit = defineEmits<{ select: [item: { id: number; title: string; body: string }] }>()

const keyword = ref('')
const items = ref<ILCopywriting[]>([])
const total = ref(0)
const loading = ref(false)
const page = ref(1)
const PAGE_SIZE = 10

const hasMore = computed(() => items.value.length < total.value)

async function load(reset = false) {
  if (loading.value) return
  if (reset) {
    page.value = 1
  } else if (!hasMore.value) {
    return
  }
  loading.value = true
  try {
    const res = await llCopywritingList({
      status: 1,
      keyword: keyword.value || undefined,
      page: page.value,
      pageSize: PAGE_SIZE,
    })
    const list = res.data?.list ?? []
    items.value = reset ? list : [...items.value, ...list]
    total.value = res.data?.total ?? 0
  } finally {
    loading.value = false
  }
}

watch(show, (v) => {
  if (v) void load(true)
})

function pick(item: ILCopywriting) {
  emit('select', { id: item.id, title: item.title, body: item.body })
  show.value = false
}
</script>

<template>
  <n-modal v-model:show="show" preset="card" title="选择AI文案" class="cw-picker" style="width: 560px">
    <div class="flex items-center gap-8px mb-12px">
      <n-input
        v-model:value="keyword"
        class="flex-1"
        size="small"
        placeholder="搜索标题关键词"
        clearable
        @keydown.enter="load(true)"
        @clear="load(true)"
      />
      <n-button size="small" type="primary" ghost @click="load(true)">搜索</n-button>
    </div>

    <div v-loading="loading" class="max-h-420px overflow-auto flex flex-col gap-8px">
      <button
        v-for="item in items"
        :key="item.id"
        type="button"
        class="flex-none block w-full box-border rounded-lg border border-solid border-line bg-white px-12px py-10px text-left cursor-pointer transition-[border-color,box-shadow] duration-mid ease-[ease] motion-reduce:transition-none hover:(border-violet-line shadow-raised) sx-focus"
        @click="pick(item)"
      >
        <span class="flex items-center gap-8px mb-6px">
          <span class="flex-1 min-w-0 truncate text-13px font-600 leading-20px text-ink">{{
            item.title || '未命名文案'
          }}</span>
          <span class="flex-none text-11px leading-16px text-muted tabular-nums"
            >{{ item.contentTypeLabel }}<template v-if="item.wordCount"> · {{ item.wordCount }}字</template></span
          >
        </span>
        <span class="block line-clamp-2 text-12px leading-18px text-ink-2">{{ item.body }}</span>
      </button>
      <div v-if="!loading && !items.length" class="sx-empty">
        <span class="sx-empty-desc">暂无已完成文案，先去「AI文案」生成一条吧</span>
      </div>
      <button
        v-if="hasMore && !loading"
        type="button"
        class="ll-link self-center my-4px rounded-sm border-none bg-transparent px-8px py-4px transition-colors duration-fast sx-focus"
        @click="load()"
      >
        加载更多
      </button>
    </div>
  </n-modal>
</template>
