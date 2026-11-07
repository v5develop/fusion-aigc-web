<script setup lang="ts">
/**
 * 画布管理：画布卡片列表（updated_at 倒序）+ 新建空白 / 从模板创建
 * + 重命名 / 另存为 / 删除 + 详情抽屉（运行历史）。
 * 不做节点编辑器（规划中），仅画布级管理。
 */
import { computed, h, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDialog, useMessage } from 'naive-ui'
import type { DropdownOption } from 'naive-ui'
import { llTheme } from '@/views/local-life/theme.ts'
import {
  canvasCreate,
  canvasFromTemplate,
  canvasList,
  canvasRemove,
  canvasRename,
  canvasSaveAs,
  canvasTemplates,
} from '@/api/canvasHome.ts'
import type { ICanvasSummary, ICanvasTemplate } from '@/api/canvasHome.ts'
import IconButton from '@/components/IconButton/index.vue'
import { toApiError } from '@/api/index.ts'
import TitleModal from './TitleModal.vue'
import TemplatePicker from './TemplatePicker.vue'
import CanvasDetail from './CanvasDetail.vue'

defineOptions({ name: 'canvas-page' })

/**
 * 首页模板卡（2026-11-06 二轮：3 → 6 套，名称/说明/色块逐条抄原型 canvasTemplates.ts，封面用真实编辑态截图）。
 * 点击按标题匹配接口模板（接口无稳定 code），命中则直接建画布并进编辑器，未命中退回「从模板创建」弹层并预选/过滤。
 */
const HOME_TEMPLATES = [
  { title: '模特换装', desc: '人物图 + 单品图，保脸保姿势，只换衣服', tint: 'bg-[rgba(135,95,154,0.09)]', dot: 'rgba(135,95,154,0.78)', cover: '/canvas-templates/outfit.webp' },
  { title: '商品三视图', desc: '一张商品图，生成正/侧/背三视图，白底一致', tint: 'bg-[rgba(20,184,166,0.10)]', dot: 'rgba(20,184,166,0.78)', cover: '/canvas-templates/three-view.webp' },
  { title: '元素替换', desc: '参考视频 + 3 张元素图，只换局部元素', tint: 'bg-[rgba(249,115,22,0.10)]', dot: 'rgba(249,115,22,0.78)', cover: '/canvas-templates/element-replace.webp' },
  { title: '商品主图', desc: '一张商品图，出白底 / 场景两版 1:1 主图', tint: 'bg-[rgba(20,184,166,0.10)]', dot: 'rgba(20,184,166,0.78)', cover: '/canvas-templates/product-main.webp' },
  { title: '带货短片', desc: '商品图 + 卖点，出 8 秒竖屏带货短片', tint: 'bg-[rgba(106,72,123,0.10)]', dot: 'rgba(106,72,123,0.78)', cover: '/canvas-templates/short-video.webp' },
  { title: '高清放大', desc: '模糊素材放到 2K，保留原构图与比例', tint: 'bg-[rgba(59,130,246,0.10)]', dot: 'rgba(59,130,246,0.78)', cover: '/canvas-templates/hd-upscale.webp' },
]

/** 加载失败的模板封面：回落同色调色块 + 迷你节点装饰 */
const failedCovers = ref(new Set<string>())
function markCoverFailed(cover: string) {
  if (failedCovers.value.has(cover)) return
  failedCovers.value = new Set([...failedCovers.value, cover])
}

/** 原型装饰小卡（CanvasHomeView .ch-mini-node + canvas-v31 覆盖）：宽 148、内边距 9/11、r8、11px；旋转角取自原型源码 */
const DECO_CLS =
  'absolute flex flex-col gap-3px w-148px px-11px py-9px rounded-8px border border-solid border-line bg-white/90 text-ink-2 text-11px text-left shadow-[0_1px_2px_rgba(16,24,40,0.06)] [&_small]:(text-11px text-muted)'

/** 原型 .ch-btn（v3）：高 32（命中区 ≥32）、r14、13px/500，白渐变 + 内高光 / 内底线 + 短投影，过渡 0.12s ease */
const BTN_SHADOW =
  'shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),0_1px_2px_rgba(31,35,41,0.05)]'
const BTN_BASE =
  'sx-squircle inline-flex items-center justify-center gap-6px rounded-14px border border-solid text-13px font-500 cursor-pointer transition-[background,border-color,box-shadow] duration-120 ease-[ease] focus-visible:(outline outline-2 outline-violet outline-offset-2)'
const BTN_DEFAULT = `${BTN_BASE} ${BTN_SHADOW} h-32px px-12px border-#c9cfd6 bg-gradient-to-b from-white to-#fbfcfc text-ink-2 hover:(border-#aeb6bf from-surface2 to-surface2 text-ink)`
/** 原型 .ch-btn.is-lg：高 34、内边距 16 */
const BTN_LG = `${BTN_BASE} ${BTN_SHADOW} h-36px px-16px`

const message = useMessage()
const router = useRouter()

const PAGE_SIZE = 20

const items = ref<ICanvasSummary[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const loadError = ref('')
const loadingMore = ref(false)
const hasMore = computed(() => items.value.length < total.value)

function formatTime(ms?: number) {
  if (!ms) return '尚未保存'
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  const now = new Date()
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
    return `今天 ${p(d.getHours())}:${p(d.getMinutes())}`
  }
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
    loadError.value = ''
  } catch (err) {
    if (cur === seq) {
      notifyNetworkError(err, '画布列表加载失败，请稍后重试')
      loadError.value = toApiError(err)?.message || '网络开小差了，请检查网络后重试。'
    }
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
    items.value = items.value.filter((i) => i.id !== item.id)
    total.value = Math.max(0, total.value - 1)
    // 删空了当前已加载的列表但服务端还有：重新拉第一页（本地删除后页码偏移，接着翻下一页会漏一条）
    if (!items.value.length && total.value > 0) void reload()
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

const creating = ref(false)

/** 新建空白画布：一步到位，标题在编辑器里改 */
async function createBlank() {
  // 模板创建在途时也不再新建：两边都会 router.push，连点会先后跳两次
  if (creating.value || startingTemplate.value) return
  creating.value = true
  try {
    const res = await canvasCreate({ title: '未命名画布' })
    const id = res.data?.id
    if (id) void router.push({ name: 'canvas-editor', params: { id } })
    else void reload()
  } catch (err) {
    notifyNetworkError(err, '创建失败，请稍后重试')
  } finally {
    creating.value = false
  }
}

const showTemplates = ref(false)
const pickerHint = ref('')

// 首页静态模板 -> 接口模板：整页只取一次，按标题匹配
let apiTemplates: ICanvasTemplate[] | null = null
let apiTemplatesLoading: Promise<ICanvasTemplate[]> | null = null
function loadApiTemplates() {
  if (apiTemplates) return Promise.resolve(apiTemplates)
  apiTemplatesLoading ??= canvasTemplates('official')
    .then((res) => (apiTemplates = res.data?.items ?? []))
    .finally(() => (apiTemplatesLoading = null))
  return apiTemplatesLoading
}
const normTitle = (t: string) => t.replace(/\s+/g, '')

const startingTemplate = ref('')

async function startFromHomeTemplate(t: { title: string }) {
  if (startingTemplate.value || creating.value) return
  startingTemplate.value = t.title
  try {
    const list = await loadApiTemplates()
    const hit = list.find((x) => normTitle(x.title) === normTitle(t.title))
    if (!hit) {
      openPicker(t.title)
      return
    }
    const res = await canvasFromTemplate({ template_id: hit.id })
    const id = res.data?.id
    if (id) void router.push({ name: 'canvas-editor', params: { id } })
    else void reload()
  } catch (err) {
    notifyNetworkError(err, '创建失败，请稍后重试')
  } finally {
    startingTemplate.value = ''
  }
}

function openPicker(hint = '') {
  pickerHint.value = hint
  showTemplates.value = true
}

function scrollToTemplates() {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  document.getElementById('canvas-home-templates')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
}

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

// ---------------- 卡片「更多」菜单 ----------------

const dialog = useDialog()

const MORE_OPTIONS: DropdownOption[] = [
  { key: 'detail', label: '详情' },
  { key: 'rename', label: '重命名' },
  { key: 'copy', label: '创建副本' },
  { type: 'divider', key: 'd1' },
  { key: 'remove', label: () => h('span', { style: 'color:#c0392b' }, '删除') },
]

function onMore(key: string | number, item: ICanvasSummary) {
  if (key === 'detail') openDetail(item)
  else if (key === 'rename') openRename(item)
  else if (key === 'copy') openSaveAs(item)
  else if (key === 'remove') {
    dialog.warning({
      title: '删除画布',
      content: '删除后画布及其运行历史不可恢复，确定删除？',
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: () => removeItem(item),
    })
  }
}

async function doSaveAs(title: string) {
  if (savingAs.value || !saveAsTarget.value) return
  savingAs.value = true
  try {
    const res = await canvasSaveAs(saveAsTarget.value.id, title || undefined)
    message.success('已创建副本')
    showSaveAs.value = false
    const d = res.data
    if (d?.id) {
      items.value.unshift({
        id: d.id,
        title: d.title,
        revision: d.revision,
        node_count: d.node_count,
        cover_url: d.cover_url,
        created_at: d.created_at,
        updated_at: d.updated_at,
      })
      total.value++
    } else void reload()
  } catch (err) {
    notifyNetworkError(err, '创建副本失败，请稍后重试')
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
          <button type="button" :class="BTN_DEFAULT" @click="openPicker()">
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
            浏览模板
          </button>
          <button
            type="button"
            :class="[
              BTN_BASE,
              'h-32px px-12px border-violet-border bg-gradient-to-b from-violet-top to-violet-bottom text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_1px_1px_rgba(90,60,110,0.18),0_2px_4px_rgba(90,60,110,0.18)] hover:(from-#926ba6 to-#835a96) active:(border-violet-press from-violet-deep to-violet-press shadow-[inset_0_1px_3px_rgba(31,35,41,0.24)])',
            ]"
            :disabled="creating || !!startingTemplate"
            @click="createBlank()"
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
                :disabled="creating || !!startingTemplate"
                @click="createBlank()"
              >
                <span aria-hidden="true" class="text-17px leading-none">+</span>
                构建画布
              </button>
              <button
                type="button"
                :class="[BTN_LG, 'border-transparent bg-transparent text-violet-ink hover:bg-violet-soft']"
                @click="scrollToTemplates()"
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
                :disabled="creating || !!startingTemplate"
                @click="startFromHomeTemplate(t)"
              >
                <i class="w-7px h-7px rounded-full" :style="{ background: t.dot }" />
                {{ t.title }}
              </button>
            </div>
            <div class="absolute inset-0 overflow-hidden pointer-events-none max-[980px]:hidden" aria-hidden="true">
              <span :class="[DECO_CLS, 'top-24px left-0 -rotate-4']"
                >提示词<small>A close-up of the woman.</small></span
              >
              <span :class="[DECO_CLS, 'bottom-28px left-62px rotate-3']">图片<small>输入素材</small></span>
              <span :class="[DECO_CLS, 'top-38px right-0 rotate-4']">Nano Banana<small>参考图 · 2/5</small></span>
              <span :class="[DECO_CLS, 'right-72px bottom-18px -rotate-3']">图片<small>输出</small></span>
            </div>
          </section>

          <section id="canvas-home-templates" class="mt-24px scroll-mt-16px">
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
                class="canvas-tpl sx-squircle group relative flex flex-col min-w-0 p-10px rounded-18px border border-solid border-line bg-white text-left shadow-[0_1px_2px_rgba(16,24,40,0.06)] cursor-pointer transition-[border-color,box-shadow,transform] duration-120 ease-[ease] hover:(-translate-y-1px border-violet-line shadow-[0_2px_6px_rgba(135,95,154,0.12)]) motion-reduce:(transition-none hover:translate-y-0) disabled:cursor-wait focus-visible:(outline outline-2 outline-violet outline-offset-2)"
                :disabled="creating || !!startingTemplate"
                @click="startFromHomeTemplate(t)"
              >
                <!-- 预览 170h r12：真实编辑态截图，加载失败回落同色调色块 + 迷你节点 -->
                <span
                  class="relative block h-170px rounded-12px overflow-hidden [&>i]:(absolute block rounded-3px border-[0.8px] border-solid border-[rgba(51,51,51,0.08)] bg-white/92) border-[0.8px] border-solid border-[rgba(51,51,51,0.06)]"
                  :class="t.tint"
                  aria-hidden="true"
                >
                  <img
                    v-if="!failedCovers.has(t.cover)"
                    :src="t.cover"
                    alt=""
                    loading="lazy"
                    decoding="async"
                    class="block h-full w-full object-cover"
                    @error="markCoverFailed(t.cover)"
                  />
                  <!-- 装饰迷你节点只在封面加载失败时出现，正常情况下不盖住截图 -->
                  <template v-else>
                    <i class="top-14px left-12px w-1/2 h-10px" />
                    <i class="bottom-12px left-12px w-24% h-44px" />
                    <i class="bottom-12px left-40% w-24% h-44px" />
                    <i class="right-10px bottom-12px w-28% h-56px" />
                  </template>
                </span>
                <span class="flex flex-col gap-3px min-w-0 pt-9px pl-2px pr-22px">
                  <strong class="text-14px font-600 text-ink">{{ t.title }}</strong>
                  <small class="text-13px leading-[1.45] text-muted">{{ t.desc }}</small>
                </span>
                <svg
                  class="absolute right-12px bottom-14px w-14px h-14px text-placeholder"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
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
              v-else-if="loadError && !items.length"
              class="flex flex-col items-center gap-8px px-20px py-32px rounded-14px border border-solid border-#e4b7b4 bg-#fdf5f4 text-13px text-#a1423d text-center"
              role="alert"
            >
              <strong class="text-14px text-#a1423d">画布列表没有加载出来</strong>
              <p class="m-0">{{ loadError }}</p>
              <button type="button" :class="BTN_DEFAULT" @click="reload()">重试</button>
            </div>
            <div
              v-else
              class="grid gap-10px max-[980px]:grid-cols-1"
              :class="[items.length <= 2 ? 'grid-cols-1' : 'grid-cols-2', { 'opacity-60': loading }]"
              :aria-busy="loading || undefined"
            >
              <div v-for="item in items" :key="item.id" class="group relative min-w-0">
                <button
                  type="button"
                  class="sx-squircle flex items-center gap-12px w-full min-w-0 p-10px pr-52px rounded-18px border border-solid border-line bg-white text-left shadow-[0_1px_2px_rgba(16,24,40,0.06)] cursor-pointer transition-[background,border-color] duration-120 ease-[ease] hover:(border-violet-line bg-surface2) focus-visible:(outline outline-2 outline-violet outline-offset-2)"
                  @click="openCanvas(item)"
                >
                  <span class="grid place-items-center shrink-0 w-88px h-58px rounded-6px overflow-hidden bg-surface3">
                    <img
                      v-if="item.cover_url && !failedCovers.has(item.cover_url)"
                      :src="item.cover_url"
                      alt=""
                      loading="lazy"
                      decoding="async"
                      class="block w-full h-full object-cover"
                      @error="markCoverFailed(item.cover_url)"
                    />
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
                  </span>
                </button>
                <n-dropdown trigger="click" placement="bottom-end" :options="MORE_OPTIONS" @select="(k: string | number) => onMore(k, item)">
                  <IconButton label="更多" size="md" variant="quiet" reveal class="absolute right-10px top-1/2 -translate-y-1/2">
                    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                      <circle cx="5" cy="12" r="1.8" />
                      <circle cx="12" cy="12" r="1.8" />
                      <circle cx="19" cy="12" r="1.8" />
                    </svg>
                  </IconButton>
                </n-dropdown>
              </div>

              <div
                v-if="!loading && !loadError && !items.length"
                class="col-span-full flex flex-col items-center gap-8px px-20px py-32px rounded-8px border border-dashed border-line-strong bg-white text-13px text-muted text-center"
              >
                <strong class="text-14px text-ink">还没有保存的画布</strong>
                <p class="m-0">从模板开始，或者新建一张空白画布。</p>
                <button type="button" :class="BTN_DEFAULT" :disabled="creating || !!startingTemplate" @click="createBlank()">新建画布</button>
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

      <!-- 从模板创建 -->
      <TemplatePicker v-model:show="showTemplates" :hint="pickerHint" @created="onCreatedFromTemplate" />

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

      <!-- 创建副本（另存为） -->
      <TitleModal
        v-model:show="showSaveAs"
        title="创建副本"
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
