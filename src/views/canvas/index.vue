<script setup lang="ts">
/**
 * 画布管理：画布卡片列表（updated_at 倒序）+ 新建空白 / 从模板创建
 * + 重命名 / 另存为 / 删除 + 详情抽屉（运行历史）。
 * 不做节点编辑器（规划中），仅画布级管理。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { llTheme } from '@/views/local-life/theme.ts'
import { canvasCreate, canvasList, canvasRemove, canvasRename, canvasSaveAs } from '@/api/canvasHome.ts'
import type { ICanvasSummary } from '@/api/canvasHome.ts'
import TitleModal from './TitleModal.vue'
import TemplatePicker from './TemplatePicker.vue'
import CanvasDetail from './CanvasDetail.vue'

defineOptions({ name: 'canvas-page' })

const message = useMessage()
const router = useRouter()

const PAGE_SIZE = 20

const items = ref<ICanvasSummary[]>([])
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

// 列表加载：序号挡住慢响应把新结果覆盖回去
let seq = 0

async function loadPage(p: number): Promise<ICanvasSummary[]> {
  const res = await canvasList({ page: p, page_size: PAGE_SIZE })
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

// ---------------- 卡片操作 ----------------

async function removeItem(item: ICanvasSummary) {
  await canvasRemove(item.id)
  message.success('已删除')
  void reload()
}

// ---------------- 打开画布 / 详情抽屉 ----------------

/** 打开画布：进入节点编辑器 */
function openCanvas(item: ICanvasSummary) {
  void router.push({ name: 'canvas-editor', params: { id: item.id } })
}

const showDetail = ref(false)
const detailId = ref<string | null>(null)

function openDetail(item: ICanvasSummary) {
  detailId.value = item.id
  showDetail.value = true
}

// ---------------- 新建 / 模板 / 重命名 / 另存为 ----------------

const showCreate = ref(false)
const creating = ref(false)

async function doCreate(title: string) {
  if (creating.value) return
  creating.value = true
  try {
    await canvasCreate(title ? { title } : {})
    message.success('画布已创建')
    showCreate.value = false
    void reload()
  } finally {
    creating.value = false
  }
}

const showTemplates = ref(false)

function onCreatedFromTemplate() {
  void reload()
}

const showRename = ref(false)
const renameTarget = ref<ICanvasSummary | null>(null)
const renaming = ref(false)

function openRename(item: ICanvasSummary) {
  renameTarget.value = item
  showRename.value = true
}

async function doRename(title: string) {
  if (renaming.value || !renameTarget.value) return
  if (!title) return message.warning('请填写画布标题')
  renaming.value = true
  try {
    await canvasRename(renameTarget.value.id, title)
    message.success('已重命名')
    showRename.value = false
    void reload()
  } finally {
    renaming.value = false
  }
}

const showSaveAs = ref(false)
const saveAsTarget = ref<ICanvasSummary | null>(null)
const savingAs = ref(false)

function openSaveAs(item: ICanvasSummary) {
  saveAsTarget.value = item
  showSaveAs.value = true
}

/** 另存为初始标题：原标题 + 「 - 副本」（与后端留空时的默认一致，预填让用户可见） */
const saveAsInitial = computed(() => {
  const t = saveAsTarget.value
  return t ? `${t.title || '未命名画布'} - 副本` : ''
})

async function doSaveAs(title: string) {
  if (savingAs.value || !saveAsTarget.value) return
  savingAs.value = true
  try {
    await canvasSaveAs(saveAsTarget.value.id, title || undefined)
    message.success('已另存为副本')
    showSaveAs.value = false
    void reload()
  } finally {
    savingAs.value = false
  }
}
</script>

<template>
  <n-config-provider :theme-overrides="llTheme" abstract>
    <div class="canvas-page h-full overflow-auto px-32px py-24px">
      <div class="flex items-center justify-between mb-16px">
        <div>
          <h1 class="text-20px text-ink m-0 mb-4px">画布</h1>
          <p class="text-12px text-muted m-0">点击画布卡片进入节点编辑器，支持重命名 / 另存为 / 删除与运行历史查看</p>
        </div>
        <div class="flex gap-10px">
          <n-button @click="showTemplates = true">从模板创建</n-button>
          <n-button type="primary" @click="showCreate = true">+ 新建空白画布</n-button>
        </div>
      </div>

      <div class="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-14px min-h-200px" v-loading="loading">
        <div v-for="item in items" :key="item.id" class="ll-card p-0 overflow-hidden cursor-pointer flex flex-col transition-shadow duration-200 hover:shadow-[0_4px_12px_0_rgba(31,35,41,0.12)]" @click="openCanvas(item)">
          <div class="h-140px bg-violet-soft">
            <img v-if="item.cover_url" :src="item.cover_url" alt="" class="block w-full h-full object-cover" />
            <div v-else class="h-full flex items-center justify-center text-13px text-violet-ink">画布</div>
          </div>
          <div class="px-14px py-12px">
            <div class="text-14px font-600 text-ink mb-4px overflow-hidden text-ellipsis whitespace-nowrap">{{ item.title || '未命名画布' }}</div>
            <div class="text-12px text-placeholder">{{ item.node_count }} 个节点 · 更新于 {{ formatTime(item.updated_at) }}</div>
          </div>
          <div class="flex gap-12px px-14px pb-12px text-12px" @click.stop>
            <span class="text-violet cursor-pointer hover:text-violet-press" @click="openDetail(item)">详情</span>
            <span class="text-violet cursor-pointer hover:text-violet-press" @click="openRename(item)">重命名</span>
            <span class="text-violet cursor-pointer hover:text-violet-press" @click="openSaveAs(item)">另存为</span>
            <n-popconfirm @positive-click="removeItem(item)">
              <template #trigger><span class="ll-danger-link">删除</span></template>
              删除后画布及其运行历史不可恢复，确定删除？
            </n-popconfirm>
          </div>
        </div>

        <div v-if="!loading && !items.length" class="col-span-full bg-white rounded-12px text-center py-60px">
          <div class="text-40px mb-10px">🖼️</div>
          <p class="text-muted text-13px m-0 mb-14px">还没有画布</p>
          <div class="flex justify-center gap-10px">
            <n-button size="small" @click="showTemplates = true">从模板创建</n-button>
            <n-button type="primary" ghost size="small" @click="showCreate = true">新建空白画布</n-button>
          </div>
        </div>
      </div>

      <div v-if="hasMore && !loading" class="text-center text-13px text-violet cursor-pointer hover:text-violet-press pt-16px pb-4px" @click="loadMore()">
        {{ loadingMore ? '加载中…' : '加载更多' }}
      </div>

      <!-- 新建空白画布 -->
      <TitleModal
        v-model:show="showCreate"
        title="新建空白画布"
        label="画布标题"
        placeholder="选填，留空为「未命名画布」"
        :loading="creating"
        @confirm="doCreate"
      />

      <!-- 从模板创建 -->
      <TemplatePicker v-model:show="showTemplates" @created="onCreatedFromTemplate" />

      <!-- 重命名 -->
      <TitleModal
        v-model:show="showRename"
        title="重命名画布"
        label="画布标题"
        :initial="renameTarget?.title"
        placeholder="请输入画布标题"
        :loading="renaming"
        @confirm="doRename"
      />

      <!-- 另存为 -->
      <TitleModal
        v-model:show="showSaveAs"
        title="另存为副本"
        label="副本标题"
        :initial="saveAsInitial"
        placeholder="留空则自动命名为「原标题 - 副本」"
        :loading="savingAs"
        @confirm="doSaveAs"
      />

      <!-- 详情抽屉 -->
      <CanvasDetail v-model:show="showDetail" :canvas-id="detailId" />
    </div>
  </n-config-provider>
</template>

<style scoped lang="less">
@import '@/assets/variables.less';

// 滚动条 mixin（::-webkit-scrollbar 伪元素）无法用原子类表达
.canvas-page {
  .scrollbar(@width: 8px, @trackColor: #f7f8f9, @thumbColor: rgba(0, 0, 0, 0.1), @thumbWidth: 4px, @hoverColor: rgba(0, 0, 0, 0.35));
}
</style>
