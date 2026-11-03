<script setup lang="ts">
/**
 * 「选择AI文案」弹窗：各生成模块复用，选中后把文案 id 与正文带给表单。
 * 只列已完成的（status=1），与后端约定一致。
 */
import { computed, ref, watch } from 'vue'
import { llCopywritingList } from '@/api/localLife.ts'
import type { ILCopywriting } from '@/api/localLifeTypes.ts'

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
      page_size: PAGE_SIZE,
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
      <div
        v-for="item in items"
        :key="item.id"
        class="flex-none rounded-8px border border-solid border-line bg-white px-12px py-10px cursor-pointer transition-[border-color,box-shadow] duration-[0.18s] ease-[ease] hover:(border-violet-line shadow-[0_4px_16px_rgba(31,35,41,0.08)])"
        @click="pick(item)"
      >
        <div class="flex items-center gap-8px mb-6px">
          <span class="flex-1 min-w-0 truncate text-13px font-600 leading-20px text-ink">{{
            item.title || '未命名文案'
          }}</span>
          <span class="flex-none text-12px text-muted"
            >{{ item.content_type_label }}<template v-if="item.word_count"> · {{ item.word_count }}字</template></span
          >
        </div>
        <div class="line-clamp-2 text-12px leading-18px text-ink-2">{{ item.body }}</div>
      </div>
      <div v-if="!loading && !items.length" class="ll-empty py-40px">暂无已完成文案，先去「AI文案」生成一条吧</div>
      <div v-if="hasMore && !loading" class="ll-link block text-center py-8px" @click="load()">加载更多</div>
    </div>
  </n-modal>
</template>
