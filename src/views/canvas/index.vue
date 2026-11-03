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
import { toApiError } from '@/api/index.ts'
import TitleModal from './TitleModal.vue'
import TemplatePicker from './TemplatePicker.vue'
import CanvasDetail from './CanvasDetail.vue'

defineOptions({ name: 'canvas-page' })

/** 首页模板卡（原型文案）：仅展示，点击统一打开「从模板创建」弹层，实际模板仍取自接口 */
const HOME_TEMPLATES = [
  { title: '模特换装', desc: '人物图 + 单品图，保脸保姿势，只换衣服', tint: 'bg-surface3' },
  { title: '商品三视图', desc: '一张商品图，生成正/侧/背三视图，白底一致', tint: 'bg-success-soft' },
  { title: '元素替换', desc: '参考视频 + 3 张元素图，只换局部元素', tint: 'bg-warning-soft' },
]

/** 原型装饰小卡：阴影取自原型计算样式；旋转角原型未导出，按截图估算 */
const DECO_CLS =
  'absolute flex flex-col gap-6px w-146px px-12px py-12px rounded-6px border border-solid border-line bg-white text-ink-2 text-11px leading-[1.4] text-left shadow-[0_1px_2px_0_rgba(16,24,40,0.06)] [&_small]:(text-10px text-muted)'

/** 原型白底按钮：白渐变 + 内高光 / 内底线 + 短投影，过渡 0.12s ease */
const BTN_WHITE_SHADOW =
  'shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9),inset_0_-1px_0_0_rgba(31,35,41,0.04),0_1px_2px_0_rgba(31,35,41,0.05)]'
const BTN_BASE =
  'inline-flex items-center justify-center gap-6px rounded-6px border border-solid cursor-pointer transition-[background,border-color,box-shadow] duration-120 ease-[ease] focus-visible:(outline outline-2 outline-violet outline-offset-2)'

const ACTION_CLS =
  'p-0 border-none bg-transparent text-12px text-violet cursor-pointer hover:text-violet-press focus-visible:(outline outline-2 outline-violet outline-offset-2)'

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

/** 业务失败拦截器已 toast；只补传输层失败（超时 / 断网）的提示，避免无反馈或重复提示 */
function notifyNetworkError(err: unknown, text: string) {
  if ((toApiError(err)?.code ?? -1) === -1) message.error(text)
}

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
  } catch (err) {
    if (cur === seq) notifyNetworkError(err, '画布列表加载失败，请稍后重试')
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
  } catch (err) {
    notifyNetworkError(err, '加载更多失败，请稍后重试')
  } finally {
    loadingMore.value = false
  }
}

onMounted(reload)

// ---------------- 卡片操作 ----------------

async function removeItem(item: ICanvasSummary) {
  try {
    await canvasRemove(item.id)
    message.success('已删除')
    void reload()
  } catch (err) {
    notifyNetworkError(err, '删除失败，请稍后重试')
  }
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
  } catch (err) {
    notifyNetworkError(err, '创建失败，请稍后重试')
  } finally {
    creating.value = false
  }
}

const showTemplates = ref(false)

/** 从模板建好后直接打开（契约 4.3 回包带 id + snapshot）；没拿到 id 时退回刷新列表 */
function onCreatedFromTemplate(id: string) {
  if (id) void router.push({ name: 'canvas-editor', params: { id } })
  else void reload()
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
  } catch (err) {
    notifyNetworkError(err, '重命名失败，请稍后重试')
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
  } catch (err) {
    notifyNetworkError(err, '另存为失败，请稍后重试')
  } finally {
    savingAs.value = false
  }
}
</script>

<template>
  <n-config-provider :theme-overrides="llTheme" abstract>
    <div class="canvas-page flex flex-col h-full bg-page text-ink">
      <header class="flex items-center gap-10px shrink-0 h-48px px-18px bg-white border-b border-b-solid border-line">
        <div class="flex items-center gap-10px text-ink-2">
          <span class="grid place-items-center w-22px h-22px rounded-6px border border-solid border-line bg-surface3">
            <svg
              class="w-14px h-14px"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="m12 3 9 4.5-9 4.5-9-4.5z" />
              <path d="m3 12 9 4.5 9-4.5" />
              <path d="m3 16.5 9 4.5 9-4.5" />
            </svg>
          </span>
          <h1 class="m-0 text-14px font-600 text-ink">画布</h1>
        </div>
        <div class="flex items-center gap-8px ml-auto">
          <button
            type="button"
            :class="[
              BTN_BASE,
              BTN_WHITE_SHADOW,
              'h-30px px-12px border-line-strong bg-gradient-to-b from-white to-#fbfcfc text-ink-2 text-13px hover:(border-#aeb6bf text-ink)',
            ]"
            @click="showTemplates = true"
          >
            <svg
              class="w-15px h-15px"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              aria-hidden="true"
            >
              <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" />
              <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" />
              <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" />
              <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" />
            </svg>
            模板与历史
          </button>
          <button
            type="button"
            :class="[
              BTN_BASE,
              'h-30px px-12px border-violet-border bg-gradient-to-b from-violet-top to-violet-bottom text-white text-13px shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16),0_1px_1px_0_rgba(90,60,110,0.18),0_2px_4px_0_rgba(90,60,110,0.18)] hover:(from-#9a6fae to-#875c9a border-violet-press) active:(from-violet-press to-violet-press shadow-[inset_0_1px_3px_rgba(40,24,48,0.35)])',
            ]"
            @click="showCreate = true"
          >
            <span aria-hidden="true" class="text-16px leading-none">+</span>
            新建画布
          </button>
        </div>
      </header>

      <main class="canvas-scroll flex-1 min-h-0 overflow-auto">
        <div class="w-[min(1240px,calc(100%-48px))] mx-auto pt-22px pb-56px">
          <section
            class="relative flex flex-col items-center justify-center min-h-246px px-20px py-24px rounded-10px border border-dashed border-line-strong bg-white text-center"
          >
            <span
              class="inline-flex items-center gap-6px h-24px px-10px rounded-999px border border-solid border-violet-line bg-violet-soft text-violet-ink text-11px tracking-[0.08em] uppercase"
            >
              <svg
                class="w-12px h-12px"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path
                  d="M10 3.5 11.6 8a3 3 0 0 0 1.9 1.9L18 11.5l-4.5 1.6a3 3 0 0 0-1.9 1.9L10 19.5 8.4 15a3 3 0 0 0-1.9-1.9L2 11.5l4.5-1.6A3 3 0 0 0 8.4 8z"
                />
                <path d="M19 3v4M17 5h4" />
              </svg>
              AI CREATION · CANVAS
            </span>
            <h2 class="mt-14px mb-12px text-20px leading-[1.4] font-700 text-ink">从一张画布开始</h2>
            <p class="m-0 max-w-560px text-13px leading-[1.6] text-muted">
              把提示词、素材和模型串成一条链路，也可以直接从模板复制一套。
            </p>
            <div class="flex gap-8px mt-20px">
              <button
                type="button"
                :class="[
                  BTN_BASE,
                  BTN_WHITE_SHADOW,
                  'h-32px px-16px border-line-strong bg-gradient-to-b from-white to-#fbfcfc text-violet-ink text-13px hover:(border-violet-line bg-violet-soft)',
                ]"
                @click="showCreate = true"
              >
                <span aria-hidden="true" class="text-16px leading-none">+</span>
                构建画布
              </button>
              <button
                type="button"
                :class="[
                  BTN_BASE,
                  BTN_WHITE_SHADOW,
                  'h-32px px-16px border-transparent bg-violet-soft text-violet-ink text-13px hover:(border-violet-line bg-violet-soft-2)',
                ]"
                @click="showTemplates = true"
              >
                从模板开始
              </button>
            </div>
            <div class="flex flex-wrap items-center justify-center gap-8px mt-18px" aria-label="常用模板">
              <span class="mr-2px text-12px text-ink-2">快速开始</span>
              <button
                v-for="t in HOME_TEMPLATES"
                :key="t.title"
                type="button"
                class="inline-flex items-center gap-7px h-30px px-12px rounded-999px border border-solid border-line bg-white text-ink-2 text-12px cursor-pointer transition-[background,border-color,box-shadow] duration-120 ease-[ease] hover:(border-violet-line bg-violet-soft text-violet-ink) focus-visible:(outline outline-2 outline-violet outline-offset-2)"
                @click="showTemplates = true"
              >
                <i class="w-6px h-6px rounded-full border border-solid border-line" :class="t.tint" />
                {{ t.title }}
              </button>
            </div>
            <div class="hidden xl:block absolute inset-0 pointer-events-none" aria-hidden="true">
              <span :class="[DECO_CLS, 'top-24px left-2px -rotate-3']"
                >TEXT INPUT<small>A close-up of the woman.</small></span
              >
              <span :class="[DECO_CLS, 'bottom-30px left-62px rotate-2']">图片<small>点击上传</small></span>
              <span :class="[DECO_CLS, 'top-38px right-2px rotate-3']">Nano Banana<small>参考图 · 2/5</small></span>
              <span :class="[DECO_CLS, 'right-72px bottom-20px -rotate-2']">图片<small>输出</small></span>
            </div>
          </section>

          <section class="mt-24px">
            <header class="flex items-end gap-16px mb-10px">
              <div>
                <h2 class="m-0 text-16px font-600 text-ink">从模板开始</h2>
                <p class="mt-6px mb-0 text-13px text-muted">每个模板是一块可继续改的底板，插入后节点和连线都能编辑。</p>
              </div>
              <span class="ml-auto text-12px text-muted">{{ HOME_TEMPLATES.length }} 个模板</span>
            </header>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-12px">
              <button
                v-for="t in HOME_TEMPLATES"
                :key="t.title"
                type="button"
                class="flex items-center gap-12px min-w-0 min-h-92px p-10px pr-12px rounded-8px border border-solid border-line bg-white text-left cursor-pointer transition-[border-color,box-shadow] duration-120 ease-[ease] hover:(border-violet-line shadow-[0_4px_12px_0_rgba(31,35,41,0.12)]) focus-visible:(outline outline-2 outline-violet outline-offset-2)"
                @click="showTemplates = true"
              >
                <span
                  class="relative shrink-0 w-108px h-72px rounded-6px overflow-hidden flex items-end gap-4px p-8px"
                  :class="t.tint"
                  aria-hidden="true"
                >
                  <i class="absolute top-8px left-8px w-52px h-6px rounded-3px bg-white/80" />
                  <i class="w-26px h-30px rounded-3px bg-white/90" />
                  <i class="w-26px h-30px rounded-3px bg-white/90" />
                  <i class="ml-auto w-30px h-40px rounded-3px bg-white" />
                </span>
                <span class="flex flex-col gap-6px min-w-0 flex-1">
                  <strong class="text-14px font-600 text-ink">{{ t.title }}</strong>
                  <small class="text-13px leading-[1.5] text-muted">{{ t.desc }}</small>
                </span>
                <span class="text-14px text-ink-2 shrink-0" aria-hidden="true">→</span>
              </button>
            </div>
          </section>

          <section class="mt-24px">
            <header class="flex items-end gap-16px mb-10px">
              <div>
                <h2 class="m-0 text-16px font-600 text-ink">已保存的画布</h2>
                <p class="mt-6px mb-0 text-13px text-muted">
                  打开继续编辑；每次生成成功都会自动进资产库，不会覆盖旧结果。
                </p>
              </div>
              <span class="ml-auto text-12px text-muted">{{ total }} 个画布</span>
            </header>

            <div class="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-14px min-h-200px" v-loading="loading">
              <div
                v-for="item in items"
                :key="item.id"
                role="button"
                tabindex="0"
                class="ll-card p-0 overflow-hidden cursor-pointer flex flex-col transition-shadow duration-200 hover:shadow-[0_4px_12px_0_rgba(31,35,41,0.12)] focus-visible:(outline outline-2 outline-violet outline-offset-2)"
                @click="openCanvas(item)"
                @keydown.enter.self.prevent="openCanvas(item)"
                @keydown.space.self.prevent="openCanvas(item)"
              >
                <div class="h-140px bg-violet-soft">
                  <img v-if="item.cover_url" :src="item.cover_url" alt="" class="block w-full h-full object-cover" />
                  <div v-else class="h-full flex items-center justify-center text-13px text-violet-ink">画布</div>
                </div>
                <div class="px-14px py-12px">
                  <div class="text-14px font-600 text-ink mb-4px overflow-hidden text-ellipsis whitespace-nowrap">
                    {{ item.title || '未命名画布' }}
                  </div>
                  <div class="text-12px text-placeholder">
                    {{ item.node_count }} 个节点 · 更新于 {{ formatTime(item.updated_at) }}
                  </div>
                </div>
                <div class="flex gap-12px px-14px pb-12px text-12px" @click.stop>
                  <button type="button" :class="ACTION_CLS" @click="openDetail(item)">详情</button>
                  <button type="button" :class="ACTION_CLS" @click="openRename(item)">重命名</button>
                  <button type="button" :class="ACTION_CLS" @click="openSaveAs(item)">另存为</button>
                  <n-popconfirm @positive-click="removeItem(item)">
                    <template #trigger>
                      <button
                        type="button"
                        class="ll-danger-link p-0 border-none bg-transparent text-12px focus-visible:(outline outline-2 outline-violet outline-offset-2)"
                      >
                        删除
                      </button>
                    </template>
                    删除后画布及其运行历史不可恢复，确定删除？
                  </n-popconfirm>
                </div>
              </div>

              <div
                v-if="!loading && !items.length"
                class="col-span-full flex flex-col items-center justify-center gap-10px min-h-154px py-32px rounded-10px border border-dashed border-line-strong bg-white text-center"
              >
                <strong class="text-14px font-600 text-ink">还没有保存的画布</strong>
                <p class="m-0 text-13px text-muted">从模板开始，或者新建一张空白画布。</p>
                <button
                  type="button"
                  :class="[
                    BTN_BASE,
                    'h-28px px-10px border-line-strong bg-gradient-to-b from-white to-#fbfcfc text-ink text-13px hover:(border-#aeb6bf bg-surface2)',
                  ]"
                  @click="showCreate = true"
                >
                  新建画布
                </button>
              </div>
            </div>

            <div v-if="hasMore && !loading" class="text-center pt-16px pb-4px">
              <button
                type="button"
                class="p-0 border-none bg-transparent text-13px text-violet cursor-pointer hover:text-violet-press focus-visible:(outline outline-2 outline-violet outline-offset-2)"
                @click="loadMore()"
              >
                {{ loadingMore ? '加载中…' : '加载更多' }}
              </button>
            </div>
          </section>
        </div>
      </main>

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
.canvas-scroll {
  .scrollbar(@width: 8px, @trackColor: #f7f8f9, @thumbColor: rgba(0, 0, 0, 0.1), @thumbWidth: 4px, @hoverColor: rgba(0, 0, 0, 0.35));
}
</style>
