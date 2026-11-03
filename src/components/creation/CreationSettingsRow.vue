<script setup lang="ts">
/**
 * 创作页底部设置行（原型商拍换装「模型 通用 ▾ | 图片设置 3:4 · 1K · 1 张 ▾」、工具页「视频设置 1080P ▾」）：
 * 一排等宽的白底描边按钮，每个按钮 = 图标 + 灰色标签 + 右对齐取值摘要 + 下箭头，点开弹层。
 *
 * <p>按钮外观逐值取自原型（OperatePanel `.tool-op__settings` + `.sx-btn`）：两列等宽 grid、gap 8；高 44、
 * 内边距 0 24 0 11、圆角 6、#c9cfd6 描边、白→#fbfcfc 渐变、内高光 + 短投影、0.11s 过渡；悬停描边 #aeb6bf；
 * 展开时描边 #b9c0c8、底 #f3f4f5→#f7f8f9、内凹。图标 13（模型 16）violet；标签 11/16 muted；
 * 取值 11/16·500 ink-2 右对齐省略；箭头绝对定位距右 8。
 * 弹层（原型 SettingsPopover）：宽 = 按钮宽，默认在按钮上方 8px（放不下时 Naive 自动翻到下方），
 * 最大高 min(520, 视口 − 24)；白底圆角 10、line 描边、shadow-pop（入场沿用 Naive 弹层过渡，不另写关键帧）；
 * 头部高 44、内边距 0 8 0 14、标题 14，关闭钮 26 / r4；内容区内边距 4 14 10。内容来自同名插槽 #key
 * （模型页放 CreationModelPicker、图片设置放 CreationImageSettings）。
 */
import { onBeforeUnmount, onMounted, provide, ref, useId } from 'vue'
import { NPopover } from 'naive-ui'
import type { CreationSettingsIcon, CreationSettingsRowItem } from './types'

const { items, disabled = false } = defineProps<{
  items: CreationSettingsRowItem[]
  disabled?: boolean
}>()

defineSlots<Record<string, () => unknown>>()

const uid = useId()
const openKey = ref<string | null>(null)

/** 弹层内的选项组件据此切换为分段控件（原型「视频设置」弹层） */
provide('creation-settings-popover', true)

/** 弹层固定宽度：不再与触发按钮等宽，末项向左展开，留出选项的呼吸空间 */
/** 弹层与整行同宽（通栏）：左侧项左对齐、右侧项右对齐，都铺满整行，不再只占一半 */
const rowRef = ref<HTMLElement | null>(null)
const rowWidth = ref(360)
let rowObserver: ResizeObserver | null = null
onMounted(() => {
  if (!rowRef.value || typeof ResizeObserver === 'undefined') return
  rowObserver = new ResizeObserver(([entry]) => {
    if (entry) rowWidth.value = Math.round(entry.contentRect.width)
  })
  rowObserver.observe(rowRef.value)
})
onBeforeUnmount(() => rowObserver?.disconnect())
/** 弹层内的列表（模型）选中后据此收起弹层（原型 ModelSelect：选中即关） */
provide('creation-settings-close', () => {
  openKey.value = null
})

function setOpen(key: string, show: boolean) {
  if (show && disabled) return
  if (show) openKey.value = key
  else if (openKey.value === key) openKey.value = null
}

/** lucide sparkles / settings 线稿（24 网格，描边 1.6） */
const ICON_PATHS: Record<CreationSettingsIcon, string[]> = {
  sparkle: [
    'M9.94 15.5a2 2 0 0 0-1.44-1.44l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z',
    'M20 3v4',
    'M22 5h-4',
    'M4 17v2',
    'M5 18H3',
  ],
  gear: [
    'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
    'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  ],
}
</script>

<template>
  <div ref="rowRef" class="grid gap-8px" :class="items.length > 1 ? 'grid-cols-2' : 'grid-cols-1'">
    <NPopover
      v-for="(item, index) in items"
      :key="item.key"
      raw
      trigger="click"
      :width="rowWidth"
      :placement="index === items.length - 1 ? 'top-end' : 'top-start'"
      :show="openKey === item.key"
      :show-arrow="false"
      @update:show="(show: boolean) => setOpen(item.key, show)"
    >
      <template #trigger>
        <button
          type="button"
          class="relative min-w-0 w-full h-44px box-border flex items-center gap-6px pl-11px pr-24px rounded-6px border border-solid text-left cursor-pointer [transition:background_0.11s_cubic-bezier(0.2,0.7,0.2,1),border-color_0.11s_ease,box-shadow_0.11s_ease,color_0.11s_ease] motion-reduce:transition-none outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2) disabled:(opacity-50 cursor-not-allowed)"
          :class="
            openKey === item.key
              ? 'border-#b9c0c8 bg-[linear-gradient(#f3f4f5,#f7f8f9)] shadow-[inset_0_1px_2px_rgba(31,35,41,0.12),inset_0_0_0_1px_rgba(31,35,41,0.03)]'
              : 'border-#c9cfd6 bg-[linear-gradient(#fff,#fbfcfc)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),0_1px_2px_rgba(31,35,41,0.05)] enabled:hover:(border-#aeb6bf bg-[linear-gradient(#fff,#f7f8f9)])'
          "
          :disabled="disabled"
          :aria-label="`${item.ariaLabel ?? item.label}：${item.value}`"
          aria-haspopup="dialog"
          :aria-expanded="openKey === item.key"
          :aria-controls="openKey === item.key ? `creation-settings-${uid}-${item.key}` : undefined"
        >
          <svg
            class="flex-none text-violet"
            :class="item.icon === 'sparkle' ? 'w-16px h-16px' : 'w-13px h-13px'"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path v-for="d in ICON_PATHS[item.icon]" :key="d" :d="d" />
          </svg>
          <span class="flex-none text-11px font-400 leading-16px text-muted">{{ item.label }}</span>
          <span class="ml-auto min-w-0 truncate text-right text-11px font-500 leading-16px text-ink-2">{{
            item.value
          }}</span>
          <svg
            class="absolute right-8px top-1/2 -mt-6px w-12px h-12px text-muted transition-transform duration-150 motion-reduce:transition-none"
            :class="openKey === item.key ? 'rotate-180' : ''"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </template>
      <!-- 外层 my-8px：无论在按钮上方还是下方，都与按钮隔 8 -->
      <div class="my-8px">
        <div
          :id="`creation-settings-${uid}-${item.key}`"
          role="dialog"
          :aria-label="item.ariaLabel ?? item.label"
          class="@container flex flex-col w-full max-h-[min(520px,calc(100vh-24px))] box-border overflow-hidden rounded-10px border border-solid border-line bg-white shadow-[0_12px_24px_rgba(31,35,41,0.14),0_2px_6px_rgba(31,35,41,0.06)]"
          @keydown.esc="setOpen(item.key, false)"
        >
          <div class="flex-none flex items-center justify-between h-44px pl-14px pr-8px">
            <span class="text-14px font-600 leading-20px text-ink">{{ item.ariaLabel ?? item.label }}</span>
            <button
              type="button"
              aria-label="关闭"
              class="grid h-26px w-26px place-items-center p-0 rounded-4px border-none bg-transparent text-muted cursor-pointer hover:(bg-surface3 text-ink) outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)"
              @click="setOpen(item.key, false)"
            >
              <svg
                class="h-14px w-14px"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div class="flex-1 min-h-0 overflow-y-auto pt-4px px-14px pb-10px">
            <slot :name="item.key" />
          </div>
        </div>
      </div>
    </NPopover>
  </div>
</template>
