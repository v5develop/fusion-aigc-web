<script setup lang="ts">
/**
 * 创作页底部设置行（原型商拍换装「模型 通用 ▾ | 图片设置 3:4 · 1K · 1 张 ▾」、工具页「视频设置 1080P ▾」）：
 * 一排等宽的白底描边按钮，每个按钮 = 图标 + 灰色标签 + 右对齐取值摘要 + 下箭头，点开弹层。
 *
 * <p>按钮外观逐值取自原型：高 40、圆角 6、#c9cfd6 描边、白→#fbfcfc 渐变、内高光 + 短投影、0.11s 过渡；
 * 悬停沿用本应用 ll-pill 的描边加深（原型 dump 未给悬停值）。
 * 弹层：白底圆角 10、line 描边、0 12px 24px 浮层投影，标题为该项 label，内容来自同名插槽 #key
 * （模型页放 CreationModelPicker、图片设置放 CreationImageSettings）。
 */
import { provide, ref, useId } from 'vue'
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
  <div class="flex gap-8px">
    <NPopover
      v-for="(item, i) in items"
      :key="item.key"
      raw
      trigger="click"
      :show="openKey === item.key"
      :show-arrow="false"
      :placement="items.length > 1 && i === items.length - 1 ? 'top-end' : 'top-start'"
      @update:show="(show: boolean) => setOpen(item.key, show)"
    >
      <template #trigger>
        <button
          type="button"
          class="flex-1 min-w-0 h-40px box-border flex items-center gap-6px pl-12px pr-10px rounded-6px border border-solid bg-[linear-gradient(#fff,#fbfcfc)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(31,35,41,0.04),0_1px_2px_rgba(31,35,41,0.05)] text-ink cursor-pointer [transition:background_0.11s_cubic-bezier(0.2,0.7,0.2,1),border-color_0.11s_ease,box-shadow_0.11s_ease,color_0.11s_ease] motion-reduce:transition-none hover:border-#aeb6bf outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2) disabled:(opacity-50 cursor-not-allowed hover:border-#c9cfd6)"
          :class="openKey === item.key ? 'border-violet-line' : 'border-#c9cfd6'"
          :disabled="disabled"
          :aria-label="`${item.ariaLabel ?? item.label}：${item.value}`"
          aria-haspopup="dialog"
          :aria-expanded="openKey === item.key"
          :aria-controls="openKey === item.key ? `creation-settings-${uid}-${item.key}` : undefined"
        >
          <svg
            class="flex-none w-14px h-14px text-violet"
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
          <span class="flex-none text-12px leading-16px text-muted">{{ item.label }}</span>
          <span class="flex-1 min-w-0 truncate text-right text-13px leading-18px text-ink">{{ item.value }}</span>
          <svg
            class="flex-none w-12px h-12px text-muted transition-transform duration-150 motion-reduce:transition-none"
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
      <div
        :id="`creation-settings-${uid}-${item.key}`"
        role="dialog"
        :aria-label="item.ariaLabel ?? item.label"
        class="w-340px max-w-[calc(100vw-24px)] box-border rounded-10px border border-solid border-line bg-white shadow-[0_12px_24px_rgba(31,35,41,0.14),0_2px_6px_rgba(31,35,41,0.06)]"
        @keydown.esc="setOpen(item.key, false)"
      >
        <div class="flex items-center justify-between h-44px px-16px border-0 border-b border-solid border-line">
          <span class="text-14px font-600 leading-20px text-ink">{{ item.ariaLabel ?? item.label }}</span>
          <button
            type="button"
            aria-label="关闭"
            class="grid h-24px w-24px place-items-center rounded-6px border-none bg-transparent text-muted cursor-pointer hover:(bg-surface2 text-ink) outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)"
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
        <div class="p-16px">
          <slot :name="item.key" />
        </div>
      </div>
    </NPopover>
  </div>
</template>
