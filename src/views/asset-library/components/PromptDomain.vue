<script setup lang="ts">
import { modelLabelOf, modelLabelsOf } from '@/utils/modelLabel'
/**
 * 资产 · 提示词域（原型 5185：提示词只分官方 / 我的）。数据走提示词库接口 /api/v1/prompt-library：
 * 来源 全部('') / 官方电商(ecommerce) / 官方通用(general) / 我的(mine)，模型四档筛选，关键词与页面共用。
 * 卡片：复制、详情；我的提示词可删除，新建 / 编辑去提示词库页（/prompt-library）做，避免两处维护编辑器。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NModal, NPopconfirm, NSelect, useMessage } from 'naive-ui'
import { promptLibList, promptLibRemove } from '@/api/promptLibrary.ts'
import type { IPromptLibItem } from '@/api/promptLibrary.ts'
import { useDebounce } from '@/utils/hooks'
import PageEmpty from '@/components/PageEmpty/index.vue'
import PageLoadError from '@/components/PageLoadError/index.vue'
import AssetPager from './AssetPager.vue'
import { PILL_CLS, PILL_OFF, PILL_ON, ROW_CLS, ROW_LABEL_CLS, SEARCH_CLS, copyText } from '../ui.ts'

const q = defineModel<string>('q', { required: true })

const router = useRouter()
const message = useMessage()

const PAGE_SIZE = 32

const SOURCES = [
  { value: '', label: '全部' },
  { value: 'ecommerce', label: '官方电商' },
  { value: 'general', label: '官方通用' },
  { value: 'mine', label: '我的' },
]
const MODEL_OPTIONS = ['通用', 'GPT', 'Banana', 'Seedream'].map((m) => ({ label: modelLabelOf(m), value: m }))

const vertical = ref('')
const model = ref<string | null>(null)
const items = ref<IPromptLibItem[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const loadError = ref(false)

let seq = 0
async function load() {
  const cur = ++seq
  loading.value = true
  loadError.value = false
  try {
    const res = await promptLibList({
      vertical: vertical.value || undefined,
      model: model.value || undefined,
      q: q.value.trim() || undefined,
      page: page.value,
      page_size: PAGE_SIZE,
    })
    if (cur !== seq) return
    items.value = res.data?.items ?? []
    total.value = res.data?.total ?? 0
  } catch {
    if (cur !== seq) return
    items.value = []
    total.value = 0
    loadError.value = true
  } finally {
    if (cur === seq) loading.value = false
  }
}

/** 筛选变化回到第 1 页（已在第 1 页时 page 不变，手动拉） */
function resetAndLoad() {
  if (page.value !== 1) page.value = 1
  else void load()
}

/** 来源再点一次回到「全部」 */
function pickSource(v: string) {
  vertical.value = v && vertical.value !== v ? v : ''
}

watch(page, () => void load())
watch([vertical, model], resetAndLoad)
useDebounce({ data: () => q.value, callback: resetAndLoad })
onMounted(load)

const scroller = ref<HTMLElement | null>(null)
watch(page, () => scroller.value?.scrollTo({ top: 0 }))

// ---------------- 操作 ----------------

const isMine = (item: IPromptLibItem) => item.owner === 'mine'

async function removeItem(item: IPromptLibItem) {
  try {
    await promptLibRemove(item.id)
  } catch {
    return // 失败 toast 已由请求层弹出
  }
  message.success('已删除')
  if (detail.value?.id === item.id) detail.value = null
  // 删掉本页最后一条：退回上一页
  if (items.value.length === 1 && page.value > 1) page.value -= 1
  else void load()
}

function goLibrary() {
  void router.push('/prompt-library')
}

const detail = ref<IPromptLibItem | null>(null)
const showDetail = computed({
  get: () => !!detail.value,
  set: (v: boolean) => {
    if (!v) detail.value = null
  },
})

function formatTime(ms?: number) {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`
}

const emptyText = computed(() => {
  if (q.value.trim()) return { text: '没有匹配的提示词', desc: '换个关键词试试。' }
  if (model.value) return { text: `没有适用于「${model.value}」的提示词`, desc: '换个模型，或清除模型筛选。' }
  if (vertical.value === 'mine') return { text: '还没有我的提示词', desc: '在提示词库里新建，常用的提示词会出现在这里。' }
  return { text: '还没有提示词', desc: '官方提示词会出现在这里。' }
})

const ACTION =
  'inline-flex items-center h-28px px-8px rounded-14px border-none bg-transparent text-12px text-violet-ink cursor-pointer hover:(bg-violet-soft text-violet-press) sx-focus'
</script>

<template>
  <div :class="ROW_CLS">
    <span :class="ROW_LABEL_CLS">来源</span>
    <div class="flex items-center gap-6px min-w-0 overflow-x-auto [scrollbar-width:none]" role="group" aria-label="提示词来源">
      <button
        v-for="s in SOURCES"
        :key="s.value || '__all'"
        type="button"
        :aria-pressed="vertical === s.value"
        :class="[PILL_CLS, vertical === s.value ? PILL_ON : PILL_OFF]"
        @click="pickSource(s.value)"
      >
        {{ s.label }}
      </button>
    </div>
    <n-select
      v-model:value="model"
      :options="MODEL_OPTIONS"
      clearable
      size="small"
      placeholder="适用模型"
      class="!w-120px shrink-0"
    />
    <label :class="SEARCH_CLS">
      <svg class="w-13px h-13px shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4 4" />
      </svg>
      <input
        v-model="q"
        type="search"
        aria-label="搜索提示词"
        placeholder="搜索标题 / 提示词 / 标签"
        class="min-w-0 flex-1 border-none outline-none bg-transparent text-12px text-ink placeholder:text-placeholder"
      />
    </label>
  </div>

  <div ref="scroller" class="flex-1 min-h-0 overflow-auto px-20px pt-14px pb-20px">
    <PageLoadError v-if="loadError && !loading" subtitle="提示词列表没有取到，请检查网络后重试" retryable @retry="load" />
    <template v-else>
      <div
        v-loading="loading"
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 wide:grid-cols-5 items-start gap-8px min-h-240px"
      >
        <article
          v-for="item in items"
          :key="item.id"
          class="flex flex-col gap-8px min-w-0 p-12px sx-card-raised cursor-pointer"
          role="button"
          tabindex="0"
          :aria-label="`查看提示词 ${item.title}`"
          @click="detail = item"
          @keydown.enter.self.prevent="detail = item"
          @keydown.space.self.prevent="detail = item"
        >
          <div class="flex items-center gap-8px min-w-0">
            <strong class="flex-1 min-w-0 text-13px font-600 text-ink whitespace-nowrap overflow-hidden text-ellipsis" :title="item.title">
              {{ item.title }}
            </strong>
            <span class="ll-chip" :class="isMine(item) ? 'll-chip-success' : 'll-chip-running'">
              {{ isMine(item) ? '我的' : '官方' }}
            </span>
          </div>
          <p class="m-0 text-12px leading-20px text-ink-2 whitespace-pre-wrap break-all line-clamp-4">{{ item.prompt }}</p>
          <div v-if="item.models?.length || item.tags?.length" class="flex flex-wrap gap-4px">
            <span v-for="m in modelLabelsOf(item.models)" :key="`m-${m}`" class="text-11px text-violet-ink bg-violet-soft rounded-4px px-6px py-1px">{{ m }}</span>
            <span v-for="t in item.tags ?? []" :key="`t-${t}`" class="text-11px text-muted bg-surface3 rounded-4px px-6px py-1px">{{ t }}</span>
          </div>
          <div class="flex items-center gap-8px mt-auto text-11px text-placeholder">
            <span class="mr-auto">{{ formatTime(item.updated_at || item.created_at) }}</span>
            <button type="button" :class="ACTION" @click.stop="copyText(item.prompt, message)">复制</button>
            <n-popconfirm v-if="isMine(item)" @positive-click="removeItem(item)">
              <template #trigger>
                <button type="button" :class="[ACTION, '!text-danger hover:!bg-danger-soft']" @click.stop>删除</button>
              </template>
              删除后不可恢复，确定删除这条提示词？
            </n-popconfirm>
          </div>
        </article>

        <div v-if="!loading && !items.length" class="col-span-full h-360px">
          <PageEmpty :text="emptyText.text" :description="emptyText.desc">
            <button v-if="q.trim()" type="button" class="sx-btn" @click="q = ''">清除搜索</button>
            <button v-else-if="vertical === 'mine'" type="button" class="sx-btn-primary" @click="goLibrary">去提示词库新建</button>
          </PageEmpty>
        </div>
      </div>

      <AssetPager v-model:page="page" :total="total" :page-size="PAGE_SIZE" :disabled="loading" />
    </template>
  </div>

  <n-modal v-model:show="showDetail" preset="card" :title="detail?.title" style="width: 640px; max-width: calc(100vw - 32px)">
    <div v-if="detail">
      <div class="flex flex-wrap items-center gap-6px mb-12px">
        <span class="ll-chip" :class="isMine(detail) ? 'll-chip-success' : 'll-chip-running'">
          {{ isMine(detail) ? '我的' : '官方' }}
        </span>
        <span v-for="m in modelLabelsOf(detail.models)" :key="m" class="text-11px text-violet-ink bg-violet-soft rounded-4px px-6px py-1px">{{ m }}</span>
        <span v-for="t in detail.tags ?? []" :key="t" class="ll-tag">{{ t }}</span>
      </div>
      <div class="bg-surface2 border border-solid border-line rounded-8px p-12px text-13px text-ink leading-22px whitespace-pre-wrap break-all max-h-420px overflow-auto">
        {{ detail.prompt }}
      </div>
      <div class="mt-12px flex flex-wrap items-center gap-8px text-12px text-placeholder">
        <span class="mr-auto">更新于 {{ formatTime(detail.updated_at || detail.created_at) }}</span>
        <button v-if="isMine(detail)" type="button" class="sx-btn" @click="goLibrary">去提示词库编辑</button>
        <button type="button" class="sx-btn-primary" @click="copyText(detail.prompt, message)">复制提示词</button>
      </div>
    </div>
  </n-modal>
</template>
