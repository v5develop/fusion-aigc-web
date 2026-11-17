<script setup lang="ts">
/**
 * 画面连贯度分段按钮（CONTRACT §Y）：「更快 · 约X分钟」/「更连贯 · 约Y分钟」。
 * 只在多段方案且后端同时给出 eta.fast / eta.smooth 时显示；时间文案全取后端，不推算。选择由父组件处理（发消息 / 改方案）。
 */
import { computed } from 'vue'
import type { ReplicateContinuity, ReplicatePlan } from '@/api/replicate.ts'

const props = defineProps<{ plan: ReplicatePlan; disabled?: boolean }>()
const emit = defineEmits<{ (e: 'select', v: ReplicateContinuity): void }>()

const show = computed(() => (props.plan.timeline?.segments?.length ?? 0) > 1 && !!props.plan.eta?.fast && !!props.plan.eta?.smooth)
const current = computed<ReplicateContinuity>(() => (props.plan.continuity === 'smooth' ? 'smooth' : 'fast'))
/** 「预计 4–6 分钟」→「约 4–6 分钟」 */
const approx = (t?: string) => (t ?? '').replace(/^预计\s*/, '约 ')
const options = computed(() => [
  { key: 'fast' as const, label: '更快', time: approx(props.plan.eta.fast?.text) },
  { key: 'smooth' as const, label: '更连贯', time: approx(props.plan.eta.smooth?.text) },
])
</script>

<template>
  <div v-if="show" class="flex flex-col gap-6px" aria-label="画面连贯度">
    <span class="text-12px font-600 text-ink">画面连贯度</span>
    <div class="flex gap-6px" role="radiogroup" aria-label="画面连贯度">
      <button
        v-for="o in options"
        :key="o.key"
        type="button"
        role="radio"
        :aria-checked="current === o.key"
        :disabled="disabled"
        :class="[
          'min-w-0 flex-1 cursor-pointer rounded-10px border border-solid px-8px py-6px text-12px leading-16px disabled:cursor-not-allowed disabled:opacity-50',
          current === o.key ? 'border-violet bg-violet-tint font-600 text-violet-ink' : 'border-line bg-transparent text-ink-2 enabled:hover:bg-surface3',
          'focus-visible:(outline outline-2 outline-violet outline-offset-2)',
        ]"
        @click="o.key !== current && emit('select', o.key)"
      >
        {{ o.label }} · {{ o.time }}
      </button>
    </div>
    <small class="text-11px leading-16px text-placeholder">更连贯：后一段用上一段的最后一帧衔接，等得更久，价格一样</small>
  </div>
</template>
