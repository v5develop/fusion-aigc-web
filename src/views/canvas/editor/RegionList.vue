<script setup lang="ts">
/**
 * 区域列表：序号 + 标签 + 描述；失败可重试、可删除。
 * editable = 图片编辑面板：标签可改（会拼进提示词），可把区域插入提示词。
 */
import EditorIcon from './EditorIcon.vue'
import type { IActionRegion } from './imageActions.ts'
import { identifyRegion, removeRegion } from './imageActions.ts'
import { ACTION_RING, REGION_BADGE, SPINNER } from './actionUi.ts'

defineProps<{
  regions: IActionRegion[]
  activeKey?: string
  editable?: boolean
  numberOf: (region: IActionRegion) => number
}>()

const emit = defineEmits<{ hover: [key: string]; insert: [region: IActionRegion] }>()

const ICON_BTN = `relative grid shrink-0 w-28px h-28px after:content-empty after:absolute after:-inset-3px p-0 place-items-center border border-solid border-transparent rounded-4px bg-transparent text-muted cursor-pointer hover:border-line hover:bg-surface2 hover:text-ink ${ACTION_RING}`
</script>

<template>
  <ul class="flex flex-col gap-6px m-0 p-0 list-none">
    <li
      v-for="region in regions"
      :key="region.key"
      class="flex items-start gap-8px px-8px py-7px rounded-8px border border-solid transition-colors duration-120"
      :class="activeKey === region.key ? 'border-violet-line bg-violet-soft' : 'border-line bg-white'"
      @pointerenter="emit('hover', region.key)"
      @pointerleave="emit('hover', '')"
      @focusin="emit('hover', region.key)"
      @focusout="emit('hover', '')"
    >
      <span :class="REGION_BADGE" class="mt-1px">{{ numberOf(region) }}</span>
      <div class="flex-1 min-w-0">
        <div v-if="region.status === 'pending'" class="flex items-center gap-6px h-18px text-muted text-12px">
          <span :class="SPINNER" class="!w-12px !h-12px" aria-hidden="true" />识别中…
        </div>
        <div v-else-if="region.status === 'error'" class="text-danger text-12px leading-18px">{{ region.error }}</div>
        <template v-else>
          <input
            v-if="editable"
            v-model="region.label"
            class="w-full h-28px px-6px border border-solid border-transparent rounded-4px bg-transparent text-ink text-13px font-600 hover:border-control focus:border-violet focus:bg-white focus:shadow-focus outline-none"
            maxlength="128"
            :aria-label="`区域 ${numberOf(region)} 的标签`"
          />
          <strong v-else class="block text-ink text-13px leading-18px font-600 break-all">{{
            region.label || '未命名主体'
          }}</strong>
          <p
            v-if="region.description"
            class="m-0 mt-2px text-muted text-12px leading-18px break-all"
            :class="editable ? 'px-6px' : ''"
          >
            {{ region.description }}
          </p>
        </template>
      </div>
      <button
        v-if="editable && region.status === 'done'"
        type="button"
        class="shrink-0 h-28px px-8px border border-solid border-violet-line rounded-4px bg-violet-soft text-violet-ink text-12px cursor-pointer hover:bg-violet-soft-2"
        :class="ACTION_RING"
        :aria-label="`把区域 ${numberOf(region)} 插入提示词`"
        @click="emit('insert', region)"
      >
        插入
      </button>
      <button
        v-if="region.status === 'error'"
        type="button"
        :class="ICON_BTN"
        title="重新识别"
        :aria-label="`重新识别区域 ${numberOf(region)}`"
        @click="identifyRegion(region)"
      >
        <EditorIcon name="refresh" :size="14" />
      </button>
      <button
        type="button"
        :class="ICON_BTN"
        title="删除区域"
        :aria-label="`删除区域 ${numberOf(region)}`"
        @click="removeRegion(region.url, region.key)"
      >
        <EditorIcon name="close" :size="13" />
      </button>
    </li>
  </ul>
</template>
