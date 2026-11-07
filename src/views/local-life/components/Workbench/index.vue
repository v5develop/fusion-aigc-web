<script setup lang="ts">
/**
 * 本地生活功能页双栏布局：左参数配置 + 右结果展示。
 *
 * 版式与工具页（views/tools/index.vue）同一套：页面 bg-page + 16px 外边距与栏间距，
 * 左栏是白底面板卡（圆角 8、细描边、面板投影，同电商功能页 Container），标题 15/600/20（工具名角色），
 * 右栏透明落在页面底色上，由各页自己放白底记录卡。
 * 局部 n-config-provider 把 naive-ui 主色收敛到藤紫（只影响本地生活页）。
 *
 * <p>左栏三段（原型 StudioSplit：滚动操作区 + 固定页脚）：
 * - 功能卡（2026-11-06 审计口径）：高 64、外缘 12、r18 squircle、#e9dff2 描边、白 → #fbf7fe、名称 16/600；
 * - 操作区：板内唯一滚动区，#f7f8f9 托盘上叠白底分组卡（FormCard），卡距 8（v3-theme.css:433-435 `.studio-split__inner gap 8`），
 *   托盘内边距 pt12 px12 pb14（同电商 Container 段二）；
 * - 页脚：#settings 设置行（模型 / 生成设置两颗药丸，44 高）+ 56 高藤紫提交按钮，间距 8，上沿细线（同电商 Container 段三）。
 *
 * 本地生活网关暂无询价接口，按钮上只放生成动作本身。
 *
 * <p>三栏模式（2026-11-07，原型 ToolWorkspaceColumns ml：左操作 / 中历史 / 右预览）——**按页选用**：
 * 页面填了 `#history` 插槽才进入三栏，结果区改放 `#preview`（没填 `#preview` 时退回 `#right`）；
 * 不填 `#history` 的页面走原来的双栏分支，DOM 与类名与之前完全一致。
 * - ≥1440（`wide:`）：操作 460 / 历史 224 / 预览 1fr，gap 16，三栏等高、各自滚动；历史与预览是 r18 白板。
 * - <1440：保持双栏几何（操作 400 不变，提交钮仍钉在左栏底部），右栏顶部一组分段「生成结果 / 历史记录」切换；
 *   在历史里点一条（页面调 inject(LL_WORKBENCH_KEY)?.revealPreview()，HistoryCard 已内置）自动切回「生成结果」。
 *
 * <p>上传拦截（同电商 Container）：向子树提供上传忙碌登记（components/uploadBusy.ts），任一 ImageUpload / VideoUpload
 * 正在上传或留有失败格时，提交按钮禁用并在上方写原因。
 */
import { nextTick, provide, ref, useId } from 'vue'
import { NConfigProvider } from 'naive-ui'
import { llFormSkin, llTheme } from '../../theme.ts'
import { LL_WORKBENCH_KEY } from './context.ts'
import { provideUploadBusy } from '@/components/uploadBusy'

const {
  title,
  submit,
  loading,
  submitText = '立即生成',
  showSubmit = true,
  submitHint,
} = defineProps<{
  title: string
  submit?: () => void
  loading?: boolean
  submitText?: string
  showSubmit?: boolean
  /** 提交按钮上方的说明行（原型四页提交 hint） */
  submitHint?: string
  /** 三栏模式：<1440 分段切换里「历史记录」后面的条数；不传不显示 */
  historyCount?: number
}>()

defineSlots<{
  default?: () => unknown
  settings?: () => unknown
  /** 双栏模式的右栏（不填 #history 时使用） */
  right?: () => unknown
  /** 填了即进入三栏模式：中栏历史（≥1440）/ 右栏「历史记录」分段（<1440） */
  history?: () => unknown
  /** 三栏模式的预览区；不填退回 #right */
  preview?: () => unknown
}>()

// 上传中 / 有失败格时拦提交（原因写在按钮上方，按钮禁用但不用 pointer-events-none，悬停仍可见 title）
const uploadBlockReason = provideUploadBusy().reason
const reasonId = `ll-wb-reason-${useId()}`
const onSubmit = () => {
  if (uploadBlockReason.value) return
  submit?.()
}

/** <1440 时右栏显示哪一段（≥1440 两段同时显示，此值不起作用） */
const pane = ref<'preview' | 'history'>('preview')
const paneId = `ll-wb-${useId()}`
const PANES = ['preview', 'history'] as const

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
provide(LL_WORKBENCH_KEY, {
  revealPreview: () => {
    pane.value = 'preview'
  },
})
</script>

<template>
  <n-config-provider :theme-overrides="llTheme" abstract>
    <div :class="['h-full min-h-0 flex gap-16px box-border p-16px bg-page text-ink', llFormSkin]">
      <section
        class="sx-squircle w-400px flex-none min-h-0 flex flex-col overflow-hidden bg-white rounded-18px border border-solid border-line shadow-panel"
        :class="{ 'wide:w-460px': !!$slots.history }"
        :aria-label="title"
      >
        <!-- 功能卡（同电商 Container 段一）：外缘 12、r8、#e9dff2 描边、白 → #fbf7fe 渐变，作为左栏的顶部高光面 -->
        <header
          class="sx-squircle flex-none flex items-center gap-12px h-64px m-12px px-14px box-border rounded-18px border border-solid border-#e9dff2 bg-gradient-to-b from-white to-#fbf7fe shadow-plate"
        >
          <h1 class="m-0 min-w-0 truncate text-16px font-600 leading-[1.4] text-ink">{{ title }}</h1>
        </header>
        <!-- 操作区：板内唯一滚动区；托盘 #f7f8f9 + 上下细线，白底分组卡叠在上面 -->
        <div
          class="flex-1 min-h-0 overflow-y-auto pt-12px px-12px pb-14px bg-surface2 border-y border-y-solid border-y-line-soft [scrollbar-gutter:stable] [scrollbar-width:thin]"
        >
          <div class="flex flex-col gap-8px">
            <slot></slot>
          </div>
        </div>
        <div v-if="showSubmit || $slots.settings" class="flex-none flex flex-col gap-8px px-12px pt-12px pb-12px">
          <slot name="settings"></slot>
          <p v-if="submitHint" class="m-0 text-center text-11px leading-16px text-muted">{{ submitHint }}</p>
          <p
            v-if="showSubmit && uploadBlockReason"
            :id="reasonId"
            class="m-0 text-center text-11px leading-15px text-warning"
            aria-live="polite"
          >
            {{ uploadBlockReason }}
          </p>
          <button
            v-if="showSubmit"
            type="button"
            class="sx-submit relative box-border transition-[background,border-color,box-shadow,color] duration-fast ease-sx motion-reduce:transition-none"
            :disabled="loading || !!uploadBlockReason"
            :title="uploadBlockReason || undefined"
            :aria-busy="loading || undefined"
            :aria-describedby="uploadBlockReason ? reasonId : undefined"
            @click="onSubmit"
          >
            <span
              v-show="loading"
              class="absolute left-14px top-1/2 -mt-6px block w-12px h-12px box-border rounded-full border-1.5px border-solid border-white/35 border-t-white animate-spin [animation-duration:0.7s]"
              aria-hidden="true"
            />
            <span class="text-16px font-600 leading-22px tracking-[0.04em] whitespace-nowrap">{{ submitText }}</span>
          </button>
        </div>
      </section>
      <!-- 双栏（默认）：与之前逐字一致 -->
      <section v-if="!$slots.history" class="relative flex-1 min-w-0 min-h-0 overflow-auto">
        <slot name="right"></slot>
      </section>
      <!-- 三栏：DOM 顺序 分段 → 历史 → 预览；≥1440 横排（历史 224 居中、预览吃剩余），<1440 竖排只显示选中的一段 -->
      <div v-else class="flex-1 min-w-0 min-h-0 flex flex-col gap-12px wide:(flex-row gap-16px)">
        <div class="wide:hidden flex-none self-start sx-seg" role="tablist" aria-label="结果与历史" @keydown="onTabKeydown">
          <button
            :id="`${paneId}-tab-preview`"
            type="button"
            role="tab"
            class="sx-seg-item !h-32px !px-12px !text-13px"
            :class="pane === 'preview' ? 'sx-seg-on' : ''"
            :aria-selected="pane === 'preview'"
            :aria-controls="`${paneId}-preview`"
            :tabindex="pane === 'preview' ? 0 : -1"
            @click="pane = 'preview'"
          >
            生成结果
          </button>
          <button
            :id="`${paneId}-tab-history`"
            type="button"
            role="tab"
            class="sx-seg-item !h-32px !px-12px !text-13px"
            :class="pane === 'history' ? 'sx-seg-on' : ''"
            :aria-selected="pane === 'history'"
            :aria-controls="`${paneId}-history`"
            :tabindex="pane === 'history' ? 0 : -1"
            @click="pane = 'history'"
          >
            历史记录<span v-if="historyCount" class="ml-4px tabular-nums">{{ historyCount }}</span>
          </button>
        </div>
        <section
          :id="`${paneId}-history`"
          class="sx-squircle min-w-0 min-h-0 flex-col overflow-hidden bg-white rounded-18px border border-solid border-line shadow-panel wide:(flex flex-none w-224px)"
          :class="pane === 'history' ? 'flex flex-1' : 'hidden'"
          aria-label="历史记录"
        >
          <slot name="history"></slot>
        </section>
        <section
          :id="`${paneId}-preview`"
          class="sx-squircle relative min-w-0 min-h-0 flex-col overflow-auto bg-white rounded-18px border border-solid border-line shadow-panel [scrollbar-width:thin] wide:(flex flex-1)"
          :class="pane === 'preview' ? 'flex flex-1' : 'hidden'"
          aria-label="生成结果"
        >
          <slot v-if="$slots.preview" name="preview"></slot>
          <slot v-else name="right"></slot>
        </section>
      </div>
    </div>
  </n-config-provider>
</template>
