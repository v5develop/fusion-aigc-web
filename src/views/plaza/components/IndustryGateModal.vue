<script setup lang="ts">
/** 重开行业门的对话框壳（与智能体页模板浏览同款：Esc / × / 遮罩可关；行业选择仍由 IndustryGate 承担） */
import { NModal } from 'naive-ui'
import type { IIndustry } from '@/api/plaza.ts'
import IndustryGate from '@/views/agent/industry/IndustryGate.vue'

defineProps<{ show: boolean; industries: IIndustry[]; current?: string }>()
const emit = defineEmits<{ 'update:show': [v: boolean]; select: [code: string] }>()

const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'
</script>

<template>
  <NModal :show="show" :auto-focus="false" trap-focus @update:show="(v: boolean) => emit('update:show', v)">
    <div
      class="sx-squircle relative w-[min(640px,94vw)] rounded-20px border border-solid border-soft-line bg-surface shadow-pop"
      role="dialog"
      aria-label="换个行业"
    >
      <button
        type="button"
        class="absolute right-8px top-8px z-3 grid h-44px w-44px place-items-center rounded-full border-0 bg-transparent text-ink-2 cursor-pointer hover:text-ink"
        :class="FOCUS"
        aria-label="关闭"
        @click="emit('update:show', false)"
      >
        <svg class="h-16px w-16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      <IndustryGate dismissible :industries="industries" :current="current" @select="(c) => emit('select', c)" @close="emit('update:show', false)" />
    </div>
  </NModal>
</template>
