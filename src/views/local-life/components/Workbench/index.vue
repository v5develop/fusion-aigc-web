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
 * - 功能卡：外缘 12、r8、#e9dff2 描边、白 → #fbf7fe；
 * - 操作区：板内唯一滚动区，#f7f8f9 托盘上叠白底分组卡（FormCard），卡距 8（v3-theme.css:433-435 `.studio-split__inner gap 8`），
 *   托盘内边距 pt12 px12 pb14（同电商 Container 段二）；
 * - 页脚：#settings 设置行（模型 / 生成设置两颗药丸，44 高）+ 56 高藤紫提交按钮，间距 8，上沿细线（同电商 Container 段三）。
 *
 * 本地生活网关暂无询价接口，按钮上只放生成动作本身。
 */
import { NConfigProvider } from 'naive-ui'
import { llFormSkin, llTheme } from '../../theme.ts'

const {
  title,
  submit,
  loading,
  submitText = '立即生成',
  showSubmit = true,
} = defineProps<{
  title: string
  submit?: () => void
  loading?: boolean
  submitText?: string
  showSubmit?: boolean
}>()

defineSlots<{ default?: () => unknown; settings?: () => unknown; right?: () => unknown }>()
</script>

<template>
  <n-config-provider :theme-overrides="llTheme" abstract>
    <div :class="['h-full min-h-0 flex gap-16px box-border p-16px bg-page text-ink', llFormSkin]">
      <section
        class="w-400px flex-none min-h-0 flex flex-col overflow-hidden bg-white rounded-lg border border-solid border-line shadow-panel"
        :aria-label="title"
      >
        <!-- 功能卡（同电商 Container 段一）：外缘 12、r8、#e9dff2 描边、白 → #fbf7fe 渐变，作为左栏的顶部高光面 -->
        <header
          class="flex-none flex items-center gap-12px h-56px m-12px px-14px box-border rounded-lg border border-solid border-#e9dff2 bg-gradient-to-b from-white to-#fbf7fe shadow-plate"
        >
          <h1 class="m-0 min-w-0 truncate sx-title-tool">{{ title }}</h1>
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
          <button
            v-if="showSubmit"
            type="button"
            class="sx-submit relative box-border transition-[background,border-color,box-shadow,color] duration-fast ease-sx motion-reduce:transition-none"
            :disabled="loading"
            :aria-busy="loading || undefined"
            @click="submit?.()"
          >
            <span
              v-show="loading"
              class="absolute left-14px top-1/2 -mt-6px block w-12px h-12px box-border rounded-full border-1.5px border-solid border-white/35 border-t-white animate-spin [animation-duration:0.7s] motion-reduce:animate-none"
              aria-hidden="true"
            />
            <span class="text-16px font-600 leading-22px tracking-[0.04em] whitespace-nowrap">{{ submitText }}</span>
          </button>
        </div>
      </section>
      <section class="relative flex-1 min-w-0 min-h-0 overflow-auto">
        <slot name="right"></slot>
      </section>
    </div>
  </n-config-provider>
</template>
