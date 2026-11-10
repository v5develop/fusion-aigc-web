<script setup lang="ts">
import { modelLabelOf, modelLabelsOf } from '@/utils/modelLabel'
/**
 * 提示词库：官方电商 / 官方通用 / 我的 三个页签 + 搜索 + 卡片列表。
 * 官方卡片可复制、看详情；我的卡片可编辑 / 删除（新建编辑见 PromptEditor）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import type { GlobalThemeOverrides } from 'naive-ui'
import { llTheme } from '@/views/local-life/theme.ts'
import { promptLibList, promptLibRemove } from '@/api/promptLibrary.ts'
import type { IPromptLibItem } from '@/api/promptLibrary.ts'
import { useDebounce } from '@/utils/hooks'
import PageEmpty from '@/components/PageEmpty/index.vue'
import PromptEditor from './PromptEditor.vue'

defineOptions({ name: 'prompt-library-page' })

const message = useMessage()

// 材质对齐（原型 material-align.css）：按钮 r14 · 输入/选择 r15 · 弹窗卡片 r18；仅本页生效
const pageTheme: GlobalThemeOverrides = {
  ...llTheme,
  Button: { ...llTheme.Button, borderRadiusSmall: '14px', borderRadiusMedium: '14px' },
  Input: { ...llTheme.Input, borderRadius: '15px' },
  InternalSelection: { ...llTheme.InternalSelection, borderRadius: '15px' },
  Card: { ...llTheme.Card, borderRadius: '18px' },
}

const PAGE_SIZE = 20

/** 卡片底部文字操作：可点高 ≥ 28px、文字 13px */
const ACTION =
  'sx-focus inline-flex items-center h-28px px-6px rounded-md border-none bg-transparent text-13px text-violet cursor-pointer hover:text-violet-press'

const TABS = [
  { key: 'ecommerce', label: '官方电商' },
  { key: 'general', label: '官方通用' },
  { key: 'mine', label: '我的' },
] as const

const vertical = ref<string>('ecommerce')
const q = ref('')
// 筛选：group（二级分类英文 key）/ model（四档）。group 无字典接口，从已加载数据聚合
const groupFilter = ref<string | null>(null)
const modelFilter = ref<string | null>(null)

const MODEL_OPTIONS = ['通用', 'GPT', 'Banana', 'Seedream'].map((m) => ({ label: modelLabelOf(m), value: m }))

const groupOptions = computed(() => {
  const seen = new Set<string>()
  for (const it of items.value) {
    if (it.group) seen.add(it.group)
  }
  return [...seen].map((g) => ({ label: g, value: g }))
})

const items = ref<IPromptLibItem[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const loadingMore = ref(false)
const hasMore = computed(() => items.value.length < total.value)

function formatTime(ms?: number) {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 列表加载：页签 / 搜索变化整页重拉；用序号挡住慢响应把新结果覆盖回去
let seq = 0

async function loadPage(p: number): Promise<IPromptLibItem[]> {
  const res = await promptLibList({
    vertical: vertical.value,
    q: q.value.trim() || undefined,
    group: groupFilter.value || undefined,
    model: modelFilter.value || undefined,
    page: p,
    page_size: PAGE_SIZE,
  })
  total.value = res.data?.total ?? 0
  return res.data?.items ?? []
}

async function reload() {
  const cur = ++seq
  loading.value = true
  try {
    const list = await loadPage(1)
    if (cur !== seq) return
    items.value = list
    page.value = 1
  } finally {
    if (cur === seq) loading.value = false
  }
}

async function loadMore() {
  if (loading.value || loadingMore.value || !hasMore.value) return
  const cur = seq
  loadingMore.value = true
  try {
    const list = await loadPage(page.value + 1)
    if (cur !== seq) return
    items.value.push(...list)
    page.value++
  } finally {
    loadingMore.value = false
  }
}

onMounted(reload)

// 搜索防抖；页签切换立即重拉
useDebounce({ data: q, callback: () => void reload(), delay: 300 })
// 下拉筛选变化立即重拉
watch([groupFilter, modelFilter], () => void reload())
function switchTab(key: string) {
  if (vertical.value === key) return
  vertical.value = key
  void reload()
}

// ---------------- 卡片操作 ----------------

async function copyPrompt(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    message.success('已复制到剪贴板')
  } catch {
    message.error('复制失败，请手动选择文本复制')
  }
}

async function removeItem(item: IPromptLibItem) {
  await promptLibRemove(item.id)
  message.success('已删除')
  void reload()
}

// ---------------- 详情弹层（完整 prompt） ----------------

const detail = ref<IPromptLibItem | null>(null)
// v-model:show 需要可写绑定：关弹层时清掉选中项
const showDetail = computed({
  get: () => !!detail.value,
  set: (v: boolean) => {
    if (!v) detail.value = null
  },
})

// ---------------- 新建 / 编辑弹窗 ----------------

const showEditor = ref(false)
const editing = ref<IPromptLibItem | null>(null)

function openCreate() {
  editing.value = null
  showEditor.value = true
}

function openEdit(item: IPromptLibItem) {
  editing.value = item
  showEditor.value = true
}

function onSaved() {
  void reload()
}
</script>

<template>
  <n-config-provider :theme-overrides="pageTheme" abstract>
    <div class="prompt-library h-full overflow-auto px-32px py-24px">
      <div class="flex items-center justify-between mb-16px">
        <div>
          <h1 class="text-20px text-ink mx-0 mt-0 mb-4px">提示词库</h1>
          <p class="text-12px text-muted m-0">沉淀常用提示词，官方精选可直接复制使用，我的支持新建与编辑</p>
        </div>
        <n-button type="primary" @click="openCreate">+ 新建提示词</n-button>
      </div>

      <div class="flex items-center justify-between gap-12px mb-16px">
        <div class="flex gap-8px">
          <button
            v-for="t in TABS"
            :key="t.key"
            type="button"
            class="ll-pill sx-focus min-h-32px text-13px"
            :class="{ 'll-pill-active': vertical === t.key }"
            :aria-pressed="vertical === t.key"
            @click="switchTab(t.key)"
          >
            {{ t.label }}
          </button>
        </div>
        <n-input v-model:value="q" clearable placeholder="搜索标题 / 提示词 / 标签" style="width: 240px" />
        <n-select
          v-model:value="groupFilter"
          clearable
          size="small"
          style="width: 140px"
          :options="groupOptions"
          placeholder="分类"
        />
        <n-select
          v-model:value="modelFilter"
          clearable
          size="small"
          style="width: 130px"
          :options="MODEL_OPTIONS"
          placeholder="模型"
        />
      </div>

      <div class="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-14px min-h-200px" v-loading="loading">
        <div
          v-for="item in items"
          :key="item.id"
          class="ll-card sx-enter-card p-16px flex flex-col gap-10px cursor-pointer transition-shadow duration-200 hover:shadow-[0_4px_12px_0_rgba(31,35,41,0.12)]"
          @click="detail = item"
        >
          <div class="flex items-center justify-between gap-8px">
            <span class="text-15px font-600 text-ink overflow-hidden text-ellipsis whitespace-nowrap">{{
              item.title
            }}</span>
            <span class="ll-chip" :class="item.owner === 'mine' ? 'll-chip-success' : 'll-chip-running'">
              {{ item.owner === 'mine' ? '我的' : '官方' }}
            </span>
          </div>

          <div class="text-12px text-ink-2 leading-20px whitespace-pre-wrap break-all line-clamp-3 overflow-hidden">
            {{ item.prompt }}
          </div>

          <div v-if="item.models?.length" class="flex flex-wrap gap-6px">
            <span
              v-for="m in modelLabelsOf(item.models)"
              :key="m"
              class="text-11px text-violet-ink bg-violet-soft rounded-4px px-6px py-1px"
              >{{ m }}</span
            >
          </div>
          <div v-if="item.tags?.length" class="flex flex-wrap gap-6px">
            <span v-for="t in item.tags" :key="t" class="ll-tag">{{ t }}</span>
          </div>

          <div class="mt-auto pt-6px flex justify-between items-center text-12px text-placeholder">
            <span>{{ formatTime(item.updated_at || item.created_at) }}</span>
            <div class="flex gap-8px">
              <button type="button" :class="ACTION" @click.stop="copyPrompt(item.prompt)">复制</button>
              <template v-if="item.owner === 'mine'">
                <button type="button" :class="ACTION" @click.stop="openEdit(item)">编辑</button>
                <n-popconfirm @positive-click="removeItem(item)">
                  <template #trigger>
                    <button type="button" :class="[ACTION, '!text-danger hover:!text-#c1524c']" @click.stop>
                      删除
                    </button>
                  </template>
                  删除后不可恢复，确定删除这条提示词？
                </n-popconfirm>
              </template>
            </div>
          </div>
        </div>

        <div v-if="!loading && !items.length" class="col-span-full h-360px">
          <PageEmpty :text="q ? '没有找到匹配的提示词' : '这里还没有提示词'">
            <button v-if="vertical === 'mine' && !q" type="button" class="sx-btn-primary" @click="openCreate">
              新建第一条提示词
            </button>
          </PageEmpty>
        </div>
      </div>

      <div v-if="hasMore && !loading" class="text-center pt-16px pb-4px">
        <button type="button" :class="ACTION" :disabled="loadingMore" @click="loadMore()">
          {{ loadingMore ? '加载中…' : '加载更多' }}
        </button>
      </div>

      <!-- 详情弹层 -->
      <n-modal v-model:show="showDetail" preset="card" :title="detail?.title" style="width: 640px">
        <div v-if="detail">
          <div class="flex flex-wrap items-center gap-6px mb-12px">
            <span class="ll-chip" :class="detail.owner === 'mine' ? 'll-chip-success' : 'll-chip-running'">
              {{ detail.owner === 'mine' ? '我的' : '官方' }}
            </span>
            <span
              v-for="m in modelLabelsOf(detail.models)"
              :key="m"
              class="text-11px text-violet-ink bg-violet-soft rounded-4px px-6px py-1px"
              >{{ m }}</span
            >
            <span v-for="t in detail.tags ?? []" :key="t" class="ll-tag">{{ t }}</span>
          </div>
          <div
            class="bg-surface2 border border-line rounded-8px p-12px text-13px text-ink leading-22px whitespace-pre-wrap break-all max-h-420px overflow-auto"
          >
            {{ detail.prompt }}
          </div>
          <div class="mt-12px flex justify-between items-center text-12px text-placeholder">
            <span>更新于 {{ formatTime(detail.updated_at || detail.created_at) }}</span>
            <n-button size="small" type="primary" @click="copyPrompt(detail.prompt)">复制提示词</n-button>
          </div>
        </div>
      </n-modal>

      <!-- 新建 / 编辑 -->
      <PromptEditor v-model:show="showEditor" :editing="editing" @saved="onSaved" />
    </div>
  </n-config-provider>
</template>

<style scoped lang="less">
@import '@/assets/variables.less';

// 滚动条 mixin 无法用原子类表达
.prompt-library {
  .scrollbar(@width: 8px, @trackColor: #f7f8f9, @thumbColor: rgba(0, 0, 0, 0.1), @thumbWidth: 4px, @hoverColor: rgba(0, 0, 0, 0.35));
}
</style>
