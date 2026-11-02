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
    <div class="bar">
      <n-input
        v-model:value="keyword"
        size="small"
        placeholder="搜索标题关键词"
        clearable
        @keydown.enter="load(true)"
        @clear="load(true)"
      />
      <n-button size="small" type="primary" ghost @click="load(true)">搜索</n-button>
    </div>

    <div class="list" v-loading="loading">
      <div v-for="item in items" :key="item.id" class="item" @click="pick(item)">
        <div class="head">
          <span class="title">{{ item.title || '未命名文案' }}</span>
          <span class="meta">{{ item.content_type_label }}<template v-if="item.word_count"> · {{ item.word_count }}字</template></span>
        </div>
        <div class="body">{{ item.body }}</div>
      </div>
      <div v-if="!loading && !items.length" class="empty">暂无已完成文案，先去「AI文案」生成一条吧</div>
      <div v-if="hasMore && !loading" class="more" @click="load()">加载更多</div>
    </div>
  </n-modal>
</template>

<style scoped lang="less">
.bar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;

  > :first-child {
    flex: 1;
  }
}

.list {
  max-height: 420px;
  overflow: auto;

  .item {
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 10px 12px;
    margin-bottom: 8px;
    cursor: pointer;
    transition: border-color 0.2s;

    &:hover {
      border-color: #875f9a;
    }

    .head {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;

      .title {
        font-weight: 600;
        font-size: 13px;
        color: #1f2329;
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .meta {
        flex-shrink: 0;
        font-size: 12px;
        color: #5f6673;
      }
    }

    .body {
      font-size: 12px;
      color: #4b5563;
      line-height: 18px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
  }

  .empty {
    text-align: center;
    color: #5f6673;
    font-size: 13px;
    padding: 40px 0;
  }

  .more {
    text-align: center;
    color: #875f9a;
    font-size: 12px;
    padding: 8px 0 2px;
    cursor: pointer;
  }
}
</style>
