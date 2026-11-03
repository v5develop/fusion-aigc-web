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

/** 首页模板卡（原型文案）：仅展示，点击统一打开「从模板创建」弹层，实际模板仍取自接口；色块取自原型 canvasTemplates（v3 外壳） */
const HOME_TEMPLATES = [
  { title: '模特换装', desc: '人物图 + 单品图，保脸保姿势，只换衣服', tint: 'bg-[rgba(135,95,154,0.09)]' },
  { title: '商品三视图', desc: '一张商品图，生成正/侧/背三视图，白底一致', tint: 'bg-[rgba(20,184,166,0.10)]' },
  { title: '元素替换', desc: '参考视频 + 3 张元素图，只换局部元素', tint: 'bg-[rgba(249,115,22,0.10)]' },
]

/** 原型装饰小卡（CanvasHomeView .ch-mini-node + canvas-v31 覆盖）：宽 148、内边距 9/11、r8、11px；旋转角取自原型源码 */
const DECO_CLS =
  'absolute flex flex-col gap-3px w-148px px-11px py-9px rounded-8px border border-solid border-line bg-white/90 text-ink-2 text-11px text-left shadow-[0_1px_2px_rgba(16,24,40,0.06)] [&_small]:(text-11px text-muted)'

/** 原型 .ch-btn（v3）：高 30、r4、13px/500，白渐变 + 内高光 / 内底线 + 短投影，过渡 0.12s ease */
const BTN_SHADOW =
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),0_1px_2px_rgba(31,35,41,0.05)]'
const BTN_BASE =
  'inline-flex items-center justify-center gap-6px rounded-4px border border-solid text-13px font-500 cursor-pointer transition-[background,border-color,box-shadow] duration-120 ease-[ease] focus-visible:(outline outline-2 outline-violet outline-offset-2)'
const BTN_DEFAULT = `${BTN_BASE} ${BTN_SHADOW} h-30px px-10px border-#c9cfd6 bg-gradient-to-b from-white to-#fbfcfc text-ink-2 hover:(border-#aeb6bf from-surface2 to-surface2 text-ink)`
/** 原型 .ch-btn.is-lg：高 34、内边距 16 */
const BTN_LG = `${BTN_BASE} ${BTN_SHADOW} h-34px px-16px`

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
    <div class="canvas-page flex flex-col h-full bg-page text-ink-2">
      <header class="flex items-center gap-10px shrink-0 h-48px px-16px bg-white border-b border-b-solid border-line">
        <div class="flex items-center gap-8px text-ink">
          <span
            class="grid place-items-center w-26px h-26px rounded-6px border border-solid border-line bg-surface2 text-ink-2"
          >
            <svg
              class="w-18px h-18px"
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
          <button type="button" :class="BTN_DEFAULT" @click="showTemplates = true">
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
              'h-30px px-10px border-violet-border bg-gradient-to-b from-violet-top to-violet-bottom text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_1px_1px_rgba(90,60,110,0.18),0_2px_4px_rgba(90,60,110,0.18)] hover:(from-#926ba6 to-#835a96) active:(border-violet-press from-violet-deep to-violet-press shadow-[inset_0_1px_3px_rgba(31,35,41,0.24)])',
            ]"
            @click="showCreate = true"
          >
            <span aria-hidden="true" class="text-16px leading-none">+</span>
            新建画布
          </button>
        </div>
      </header>

      <main class="canvas-scroll flex-1 min-h-0 overflow-auto">
        <div class="w-[min(1240px,calc(100%-48px))] mx-auto pt-24px pb-48px">
          <section
            class="relative flex flex-col items-center justify-center min-h-188px px-20px pt-22px pb-26px text-center"
          >
            <span
              class="inline-flex items-center gap-5px px-9px py-3px rounded-999px border border-solid border-violet-line bg-violet-soft text-violet-ink text-11px tracking-[0.06em]"
            >
              <svg
                class="w-13px h-13px"
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
            <h2 class="mt-12px mb-7px text-20px font-600 tracking-[0.01em] text-ink">从一张画布开始</h2>
            <p class="m-0 max-w-560px text-13px leading-[1.65] text-muted">
              把提示词、素材和模型串成一条链路，也可以直接从模板复制一套。
            </p>
            <div class="flex gap-8px mt-18px">
              <button
                type="button"
                :class="[
                  BTN_LG,
                  'border-violet-line bg-gradient-to-b from-white to-#fbfcfc text-violet-ink hover:(border-#c9b2d8 from-violet-soft to-violet-soft)',
                ]"
                @click="showCreate = true"
              >
                <span aria-hidden="true" class="text-17px leading-none">+</span>
                构建画布
              </button>
              <button
                type="button"
                :class="[BTN_LG, 'border-transparent bg-transparent text-violet-ink hover:bg-violet-soft']"
                @click="showTemplates = true"
              >
                从模板开始
              </button>
            </div>
            <div class="flex flex-wrap items-center justify-center gap-8px mt-18px" aria-label="常用模板">
              <span class="text-12px text-muted">快速开始</span>
              <button
                v-for="t in HOME_TEMPLATES"
                :key="t.title"
                type="button"
                class="inline-flex items-center gap-7px h-32px px-12px rounded-999px border border-solid border-line bg-white text-ink-2 text-12px cursor-pointer transition-[background,border-color,color] duration-120 ease-[ease] hover:(border-violet-line bg-violet-soft text-violet-ink) focus-visible:(outline outline-2 outline-violet outline-offset-2)"
                @click="showTemplates = true"
              >
                <i class="w-7px h-7px rounded-full" :class="t.tint" />
                {{ t.title }}
              </button>
            </div>
            <div class="absolute inset-0 overflow-hidden pointer-events-none max-[980px]:hidden" aria-hidden="true">
              <span :class="[DECO_CLS, 'top-24px left-0 -rotate-4']"
                >TEXT INPUT<small>A close-up of the woman.</small></span
              >
              <span :class="[DECO_CLS, 'bottom-28px left-62px rotate-3']">图片<small>点击上传</small></span>
              <span :class="[DECO_CLS, 'top-38px right-0 rotate-4']">Nano Banana<small>参考图 · 2/5</small></span>
              <span :class="[DECO_CLS, 'right-72px bottom-18px -rotate-3']">图片<small>输出</small></span>
            </div>
          </section>

          <section class="mt-24px">
            <header class="flex items-end gap-14px mb-10px">
              <div>
                <h2 class="m-0 text-16px font-600 text-ink">从模板开始</h2>
                <p class="mt-3px mb-0 text-13px text-muted">每个模板是一块可继续改的底板，插入后节点和连线都能编辑。</p>
              </div>
              <span class="ml-auto text-11px text-muted">{{ HOME_TEMPLATES.length }} 个模板</span>
            </header>
            <div class="grid grid-cols-3 max-[980px]:grid-cols-1 gap-12px">
              <button
                v-for="t in HOME_TEMPLATES"
                :key="t.title"
                type="button"
                class="flex items-center gap-12px min-w-0 p-10px rounded-8px border border-solid border-line bg-white text-left shadow-[0_1px_2px_rgba(16,24,40,0.06)] cursor-pointer transition-[border-color,box-shadow] duration-120 ease-[ease] hover:(border-violet-line shadow-[0_2px_6px_rgba(135,95,154,0.12)]) focus-visible:(outline outline-2 outline-violet outline-offset-2)"
                @click="showTemplates = true"
              >
                <span
                  class="relative shrink-0 w-108px h-72px rounded-6px overflow-hidden [&>i]:(absolute block rounded-3px border-[0.8px] border-solid border-[rgba(51,51,51,0.08)] bg-white/92)"
                  :class="t.tint"
                  aria-hidden="true"
                >
                  <i class="top-10px left-9px w-1/2 h-8px" />
                  <i class="bottom-9px left-9px w-24% h-32px" />
                  <i class="bottom-9px left-36% w-24% h-32px" />
                  <i class="right-8px bottom-9px w-28% h-40px" />
                </span>
                <span class="flex flex-col gap-3px min-w-0">
                  <strong class="text-14px font-600 text-ink">{{ t.title }}</strong>
                  <small class="text-13px leading-[1.45] text-muted">{{ t.desc }}</small>
                </span>
                <span class="ml-auto shrink-0 text-14px leading-none text-placeholder" aria-hidden="true">→</span>
              </button>
            </div>
          </section>

          <section class="mt-24px">
            <header class="flex items-end gap-14px mb-10px">
              <div>
                <h2 class="m-0 text-16px font-600 text-ink">已保存的画布</h2>
                <p class="mt-3px mb-0 text-13px text-muted">
                  打开继续编辑；每次生成成功都会自动进资产库，不会覆盖旧结果。
                </p>
              </div>
              <span class="ml-auto text-11px text-muted">{{ total }} 个画布</span>
            </header>

            <!-- 加载态：原型 .ch-state「正在加载画布…」虚线卡 -->
            <div
              v-if="loading && !items.length"
              class="flex flex-col items-center gap-8px px-20px py-32px rounded-8px border border-dashed border-line-strong bg-white text-13px text-muted text-center"
              role="status"
            >
              正在加载画布…
            </div>
            <div
              v-else
              class="grid gap-10px max-[980px]:grid-cols-1"
              :class="[items.length <= 2 ? 'grid-cols-1' : 'grid-cols-2', { 'opacity-60': loading }]"
              :aria-busy="loading || undefined"
            >
              <div
                v-for="item in items"
                :key="item.id"
                role="button"
                tabindex="0"
                class="flex items-center gap-12px min-w-0 p-10px rounded-8px border border-solid border-line bg-white text-left shadow-[0_1px_2px_rgba(16,24,40,0.06)] cursor-pointer transition-[background,border-color] duration-120 ease-[ease] hover:(border-violet-line bg-surface2) focus-visible:(outline outline-2 outline-violet outline-offset-2)"
                @click="openCanvas(item)"
                @keydown.enter.self.prevent="openCanvas(item)"
                @keydown.space.self.prevent="openCanvas(item)"
              >
                <span class="grid place-items-center shrink-0 w-88px h-58px rounded-6px overflow-hidden bg-surface3">
                  <img v-if="item.cover_url" :src="item.cover_url" alt="" class="block w-full h-full object-cover" />
                  <span
                    v-else
                    class="relative w-54px h-34px [&>i]:(absolute block w-14px h-9px rounded-2px border-[0.8px] border-solid border-#d9dde5 bg-white)"
                    aria-hidden="true"
                  >
                    <i class="top-2px left-2px" />
                    <i class="top-2px left-22px" />
                    <i class="bottom-2px left-12px" />
                    <i class="bottom-2px right-0" />
                  </span>
                </span>
                <span class="flex flex-col gap-4px min-w-0 flex-1">
                  <strong class="text-14px font-600 text-ink overflow-hidden text-ellipsis whitespace-nowrap">
                    {{ item.title || '未命名画布' }}
                  </strong>
                  <span class="flex items-center gap-4px text-11px text-muted">
                    <svg
                      class="w-12px h-12px shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v5l3 2" />
                    </svg>
                    更新于 {{ formatTime(item.updated_at) }} · {{ item.node_count }} 个节点
                  </span>
                  <span class="flex gap-12px text-12px" @click.stop>
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
                  </span>
                </span>
                <svg
                  class="ml-auto w-15px h-15px shrink-0 text-placeholder"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </div>

              <div
                v-if="!loading && !items.length"
                class="col-span-full flex flex-col items-center gap-8px px-20px py-32px rounded-8px border border-dashed border-line-strong bg-white text-13px text-muted text-center"
              >
                <strong class="text-14px text-ink">还没有保存的画布</strong>
                <p class="m-0">从模板开始，或者新建一张空白画布。</p>
                <button type="button" :class="BTN_DEFAULT" @click="showCreate = true">新建画布</button>
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
