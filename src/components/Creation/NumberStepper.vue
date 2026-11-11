<script setup lang="ts">
/**
 * 数字步进器（原型 `.numstep`）：34 高、r8；值格 64 在左，后接 − / + 两个 32 宽按钮（「值 | − | +」，可点区域 ≥32×32）。
 *
 * <p>值格可点改成输入态（聚焦全选、失焦 / 回车提交、Esc 还原），越界自动夹取；
 * 数字提交时带 140ms 的位移动画（原型数字 ink 动效），± 步长 1。
 * 禁用态整条降透明。label / for 关联由页面自理（aria-label 必传或给 ariaLabelledby）。
 */
import { computed, nextTick, ref, watch } from 'vue'

const {
  min = 0,
  max = 99,
  disabled = false,
  ariaLabel,
  ariaLabelledby,
} = defineProps<{
  min?: number
  max?: number
  disabled?: boolean
  ariaLabel?: string
  ariaLabelledby?: string
}>()

const value = defineModel<number>({ required: true })

const editing = ref(false)
const draft = ref('')
const inputRef = ref<HTMLInputElement>()
/** 值格数字的入场动画 key：值变化时 +1，模板里用它重放动画 */
const tick = ref(0)

const clamped = computed(() => Math.min(max, Math.max(min, Math.round(Number(value.value) || min))))

watch(clamped, () => {
  tick.value += 1
})

/**
 * 显示的数必须就是模型里的数：模型为空 / 非整数 / 越界时（如页面没给默认值），把夹取后的值写回模型，
 * 不出现「格子里显示 1、提交体里却没有这个字段」。禁用时也写（只是对齐，不是用户操作）。
 */
watch(
  [() => value.value, () => min, () => max],
  () => {
    const v = value.value
    if (typeof v !== 'number' || v !== clamped.value) value.value = clamped.value
  },
  { immediate: true },
)

function clampInput(next: number) {
  value.value = Math.min(max, Math.max(min, Math.round(Number.isFinite(next) ? next : min)))
}

function step(delta: number) {
  if (disabled) return
  clampInput(clamped.value + delta)
}

function startEdit() {
  if (disabled) return
  draft.value = String(clamped.value)
  editing.value = true
  void nextTick(() => {
    inputRef.value?.select()
    inputRef.value?.focus()
  })
}

function commitEdit() {
  if (!editing.value) return
  editing.value = false
  const parsed = Number(draft.value.trim())
  if (draft.value.trim() !== '' && Number.isFinite(parsed)) clampInput(parsed)
}

function cancelEdit() {
  editing.value = false
}
</script>

<template>
  <!-- 原型 tool/NumberStepper：值格在左（64，点改）| − | +（各 32，原型 30，按可点区域 ≥32 放宽），34 高、r8 -->
  <span
    class="sx-squircle inline-flex h-34px items-stretch box-border rounded-8px border border-solid border-line bg-white shadow-[inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)]"
    :class="disabled ? 'opacity-55 bg-surface3' : ''"
  >
    <!-- 值格：点改；输入态换原味 input，数字提交带 140ms 位移动画 -->
    <span class="relative grid w-64px place-items-center overflow-hidden rounded-l-8px">
      <input
        v-if="editing"
        ref="inputRef"
        v-model="draft"
        type="text"
        inputmode="numeric"
        class="absolute inset-0 m-0 box-border w-full border-none bg-white px-4px text-center text-13px leading-32px tabular-nums text-ink outline-none shadow-[inset_0_0_0_1px_rgba(217,199,227,1)]"
        :aria-label="ariaLabel"
        :aria-labelledby="ariaLabelledby"
        :disabled="disabled"
        @blur="commitEdit"
        @keydown.enter.prevent="commitEdit"
        @keydown.esc.prevent="cancelEdit"
      />
      <button
        v-else
        type="button"
        class="w-full h-full border-none bg-transparent p-0 text-13px leading-32px tabular-nums text-ink cursor-text sx-focus"
        :class="disabled ? 'cursor-not-allowed' : ''"
        :aria-label="`${ariaLabel ? `${ariaLabel}：` : ''}${clamped}，点击编辑`"
        :aria-labelledby="ariaLabelledby"
        :disabled="disabled"
        @click="startEdit"
      >
        <span
          :key="tick"
          class="inline-block [animation:numstep-ink_140ms_cubic-bezier(0.2,0.65,0.3,1)] motion-reduce:[animation-duration:1ms]"
          >{{ clamped }}</span
        >
      </button>
    </span>
    <span class="w-px my-7px bg-line" aria-hidden="true"></span>
    <button
      type="button"
      class="grid w-32px place-items-center border-none bg-transparent p-0 text-ink-2 cursor-pointer [transition:background_110ms,color_110ms] motion-reduce:transition-none hover:enabled:(bg-surface3 text-ink) active:enabled:(bg-sunken shadow-[inset_0_1px_2px_rgba(31,35,41,0.12)]) disabled:(cursor-not-allowed text-placeholder) sx-focus"
      :disabled="disabled || clamped <= min"
      :aria-label="`减少${ariaLabel ?? ''}，最小 ${min}`"
      @click="step(-1)"
    >
      <svg
        class="h-12px w-12px"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <path d="M5 12h14" />
      </svg>
    </button>
    <button
      type="button"
      class="grid w-32px place-items-center border-none bg-transparent p-0 text-ink-2 cursor-pointer [transition:background_110ms,color_110ms] motion-reduce:transition-none rounded-r-8px hover:enabled:(bg-surface3 text-ink) active:enabled:(bg-sunken shadow-[inset_0_1px_2px_rgba(31,35,41,0.12)]) disabled:(cursor-not-allowed text-placeholder) sx-focus"
      :disabled="disabled || clamped >= max"
      :aria-label="`增加${ariaLabel ?? ''}，最大 ${max}`"
      @click="step(1)"
    >
      <svg
        class="h-12px w-12px"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  </span>
</template>

<style>
/* 数字入场（原型 .numstep 的 ink 动效）：放全局帧名，UnoCSS 的 animate-[…] 引不到本组件 scoped 哈希 */
@keyframes numstep-ink {
  from {
    opacity: 0.2;
    transform: translateY(2px) scale(0.94);
    filter: blur(0.6px);
  }
  to {
    opacity: 1;
    transform: none;
    filter: none;
  }
}
</style>
