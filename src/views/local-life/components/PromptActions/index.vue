<script setup lang="ts">
/**
 * 大输入框底行的两颗动作（原型 StudioTextCard `.studio-ai-btn`：高 28、内边距 0 10、gap 4、图标 14）：
 * 「AI帮写」用色调按钮（sx-btn-tint），「选择AI文案」用次按钮（sx-btn）；放在 PromptBox 的 #actions 里。
 */
const { loading = false, picker = true } = defineProps<{
  /** AI帮写进行中 */
  loading?: boolean
  /** 是否出「选择AI文案」 */
  picker?: boolean
}>()

const emit = defineEmits<{ ai: []; pick: [] }>()

const btn =
  '!h-28px !px-10px !gap-4px !text-12px transition-[background,border-color,color,opacity] duration-fast ease-sx motion-reduce:transition-none'
</script>

<template>
  <button
    type="button"
    :class="['sx-btn-tint disabled:(opacity-60 cursor-not-allowed)', btn]"
    :disabled="loading"
    :aria-busy="loading || undefined"
    @click="emit('ai')"
  >
    <svg
      class="w-14px h-14px flex-none"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path
        d="M9.94 15.5a2 2 0 0 0-1.44-1.44l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"
      />
    </svg>
    {{ loading ? 'AI帮写中…' : 'AI帮写' }}
  </button>
  <button v-if="picker" type="button" :class="['sx-btn', btn]" @click="emit('pick')">
    <svg
      class="w-14px h-14px flex-none"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </svg>
    选择AI文案
  </button>
</template>
