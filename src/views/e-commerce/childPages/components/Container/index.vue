<script setup lang="ts">
/**
 * 电商功能页外壳（对齐原型工具页 ToolWorkspaceColumns ml 版，规范 §6 / §7.3）：
 * 三栏 `460 / 224 / 1fr`、gap 16、页面内边距 16。
 * - 左栏一张白板（2026-11-06 材质：r18 squircle、line 描边、面板投影），分三段：功能卡 64（外缘 12，#e9dff2 描边，白→#fbf7fe）/
 *   操作区（板内唯一滚动区，`pt12 px12 pb14`，不再套卡）/ 页脚（设置行 + 提交按钮，`0 12 12`，上沿细线）。
 * - 中栏历史（HistoryColumn）：本标签会话里的每一批生成一张历史卡，点一张在右栏看它的产物。
 * - 右栏结果：有记录时放 RecordList（只展示选中的那一批），否则放功能介绍（Sample）。
 *
 * <p>窄屏折叠（2026-11-07，同本地生活 Workbench 三栏模式）：
 * - ≥1440（`wide:`）：上面的三栏原样；右侧包裹层 `wide:contents` 不生成盒子，历史与结果仍是根网格的第 2、3 格。
 * - <1440：两栏 `460 / 1fr`（操作栏宽度与底部提交钮不变），右栏顶部分段「生成结果 / 历史记录 N」，只显示选中的一段；
 *   两段都用 v-show 切换不卸载（轮询、滚动位置、选中批次都保留），≥1440 用 `wide:!flex` / `wide:!block` 压过 v-show 的内联 none。
 *   在历史里点一条、或出现新批次（刚提交成功）时自动切回「生成结果」。
 *
 * <p>高度扣掉电商标签条（48px），否则会把 body 顶出滚动条。
 * 提交按钮用共用的 CreationActionBar（整宽藤紫渐变，第二行写本次消耗）；询价中 / 询价失败写在第二行。
 *
 * <p>上传拦截：向子树提供上传忙碌登记（components/uploadBusy.ts），操作区里任一 ImageUpload / VideoUpload
 * 正在上传或留有失败格时，提交按钮禁用并在上方写原因（「图片上传中」/「有图片上传失败，请重试或移除」）。
 */
import { computed, inject, nextTick, onDeactivated, provide, ref, unref, useId, useTemplateRef, watch, type Ref } from 'vue'
import { useRoute } from 'vue-router'
import CreationActionBar from '@/components/creation/CreationActionBar.vue'
import HistoryColumn from '../HistoryColumn/index.vue'
import { ecEntryByName } from '@/views/e-commerce/entries'
import { EC_SELECTED_TASK_KEY } from '../HistoryColumn/selection'
import { provideUploadBusy } from '@/components/uploadBusy'

const { title, submit, loading, integral, quoteStatus, submitHint } = defineProps<{
  title: string
  submit: () => void
  loading?: boolean
  /** 本次生成所需点数；询价未返回时为 null */
  integral: number | null
  /** 询价状态：loading 显示「正在计算消耗」、error 显示「消耗获取失败」 */
  quoteStatus?: 'loading' | 'success' | 'error'
  /** 提交按钮上方的说明行（原型四页提交 hint） */
  submitHint?: string
}>()

const rootRef = useTemplateRef<HTMLElement>('root')
const titleId = `ec-title-${useId()}`

// 功能卡缩略图：与电商首页入口卡片同源（按路由 name 取）。keep-alive 缓存期间全局 route 会变，只在 setup 读一次
const thumb = ecEntryByName[String(useRoute().name)]?.url ?? ''

// 上传中 / 有失败格时拦提交（原因写在按钮上方）
const uploadBlockReason = provideUploadBusy().reason
const onSubmit = () => {
  if (uploadBlockReason.value) return
  submit()
}

// 中栏历史卡与右栏结果共用的「当前选中批次」
provide(EC_SELECTED_TASK_KEY, ref<string | null>(null))

// <1440 右栏显示哪一段（≥1440 两段同时显示，此值不起作用）
type Pane = 'preview' | 'history'
const pane = ref<Pane>('preview')
const paneId = `ec-pane-${useId()}`
const PANES: Pane[] = ['preview', 'history']

// 页面 provide 的批次列表（与 HistoryColumn / RecordList 同源），只读：分段上的条数 + 新批次出现时切回结果
const recordsData = inject<Ref<any[] | undefined> | any[] | undefined>('recordsData')
const groups = computed<any[]>(() => unref(recordsData) ?? [])
// 不 immediate：首个快照只记账；之后任何新 taskId（含从空列表提交第一批）都切回结果
let seenIds = new Set<string>(groups.value.map((g) => g.taskId as string))
watch(
  () => groups.value.map((g) => g.taskId as string),
  (ids) => {
    if (ids.some((id) => !seenIds.has(id))) pane.value = 'preview'
    seenIds = new Set(ids)
  },
)

// 分段键盘：← → / Home End 切换并移焦（WAI-ARIA tabs 自动激活）
const onTabKeydown = (e: KeyboardEvent) => {
  const i = PANES.indexOf(pane.value)
  const next =
    e.key === 'ArrowRight' ? PANES[(i + 1) % PANES.length]
    : e.key === 'ArrowLeft' ? PANES[(i + PANES.length - 1) % PANES.length]
    : e.key === 'Home' ? PANES[0]
    : e.key === 'End' ? PANES[PANES.length - 1]
    : undefined
  if (!next) return
  e.preventDefault()
  pane.value = next
  nextTick(() => document.getElementById(`${paneId}-tab-${next}`)?.focus())
}

// 询价未返回时不能把「未知」显示成 0 点数
const costText = computed(() => {
  if (quoteStatus === 'loading') return '正在计算消耗…'
  if (quoteStatus === 'error') return '消耗获取失败'
  return `消耗 ${integral ?? '--'} 点数`
})

// 被 keep-alive 缓存的标签切走后组件不卸载，正在播的视频会继续出声。
// deactivated 会向整棵子树传播，Container 包住了全部 14 个功能页的内容，在这一处收口即可
onDeactivated(() => {
  rootRef.value?.querySelectorAll('video').forEach((video) => video.pause())
})
</script>

<template>
  <div
    ref="root"
    class="grid grid-cols-[460px_minmax(0,1fr)] wide:grid-cols-[460px_224px_minmax(0,1fr)] gap-16px h-[calc(100vh-48px)] p-16px box-border bg-page"
  >
    <section
      class="sx-squircle flex flex-col min-h-0 bg-white rounded-18px border border-solid border-line shadow-panel overflow-hidden"
      :aria-labelledby="titleId"
    >
      <!-- 段一：功能卡（原型 FunctionSwitcher）：高 64、外缘 12、内边距 12 14、gap 12；缩略图 56×40；名称 15/20 -->
      <header
        class="sx-squircle flex-none flex items-center gap-12px h-64px mx-12px mt-12px px-14px box-border rounded-18px border border-solid border-#e9dff2 bg-gradient-to-b from-white to-#fbf7fe"
      >
        <img
          v-if="thumb"
          class="flex-none block w-56px h-40px rounded-md object-cover bg-surface3"
          :src="thumb"
          alt=""
        />
        <h1 :id="titleId" class="m-0 min-w-0 truncate text-16px font-600 leading-[1.4] text-ink">{{ title }}</h1>
        <slot name="titleExtra"></slot>
      </header>

      <!-- 段二：操作区，板内唯一滚动区；始终预留滚动条宽度，内容由不溢出变为溢出时不会挤窄 -->
      <div
        class="flex-1 min-h-0 overflow-auto pt-12px px-12px pb-14px [scrollbar-gutter:stable] [scrollbar-width:thin]"
      >
        <slot></slot>
      </div>

      <!-- 段三：页脚（设置行 44 + 提交按钮 56，间距 8） -->
      <footer class="flex-none flex flex-col gap-8px px-12px pt-12px pb-12px border-t border-solid border-line-soft">
        <slot name="settings"></slot>
        <p v-if="submitHint" class="m-0 text-center text-11px leading-16px text-muted">{{ submitHint }}</p>
        <CreationActionBar
          label="立即生成"
          :cost-text="costText"
          :loading="loading"
          :disabled="!!uploadBlockReason"
          :reason="uploadBlockReason"
          @submit="onSubmit"
        />
      </footer>
    </section>

    <!-- 右侧：<1440 是一栏（分段 + 当前段）；≥1440 `contents` 不生成盒子，历史与结果直接落在根网格第 2、3 格 -->
    <div class="min-w-0 min-h-0 flex flex-col gap-12px wide:contents">
      <div class="wide:hidden flex-none self-start sx-seg" role="tablist" aria-label="结果与历史" @keydown="onTabKeydown">
        <button
          v-for="p in PANES"
          :id="`${paneId}-tab-${p}`"
          :key="p"
          type="button"
          role="tab"
          class="sx-seg-item !h-32px !px-12px !text-13px"
          :class="pane === p ? 'sx-seg-on' : ''"
          :aria-selected="pane === p"
          :aria-controls="`${paneId}-${p}`"
          :tabindex="pane === p ? 0 : -1"
          @click="pane = p"
        >
          <template v-if="p === 'preview'">生成结果</template>
          <template v-else>
            历史记录<span v-if="groups.length" class="ml-4px tabular-nums">{{ groups.length }}</span>
          </template>
        </button>
      </div>

      <HistoryColumn
        v-show="pane === 'history'"
        :id="`${paneId}-history`"
        class="flex-1 wide:!flex"
        :title="title"
        @select="pane = 'preview'"
      />

      <section
        v-show="pane === 'preview'"
        :id="`${paneId}-preview`"
        class="sx-squircle relative min-w-0 h-full overflow-auto bg-white rounded-18px border border-solid border-line shadow-panel [scrollbar-width:thin] flex-1 min-h-0 wide:!block"
        aria-label="生成结果"
      >
        <slot name="rightContent"></slot>
      </section>
    </div>
  </div>
</template>
