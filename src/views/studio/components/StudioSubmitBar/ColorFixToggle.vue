<script setup lang="ts">
/**
 * 「默认校色」开关（原型 AiDigitalModel `.dm-notes__cf`：补充说明框底行右侧，12/16 muted 文字 + 液态开关）。
 *
 * <p>绑定 useColorFix().enabled（页面传进来），提交时页面把它作为 color_fix 下发；这里只管外观。
 * 开关视觉 34×20（与图片生成页「输入润色」同一套），伪元素外扩到 42×32（触屏 42×40）；
 * 整个 label 可点（label 会把点击转给里面的 button）。
 */
const enabled = defineModel<boolean>({ required: true })
const { disabled = false } = defineProps<{ disabled?: boolean }>()
</script>

<template>
  <label
    class="flex flex-none items-center gap-6px text-12px leading-16px text-muted whitespace-nowrap select-none"
    :class="disabled ? 'cursor-not-allowed' : 'cursor-pointer'"
    title="出图后按校色的默认参数自动校一遍，结果里还能再调"
  >
    <span>默认校色</span>
    <button
      type="button"
      role="switch"
      :aria-checked="enabled"
      :disabled="disabled"
      class="relative flex-none w-34px h-20px box-border p-0 rounded-full border border-solid cursor-pointer after:(content-empty absolute -inset-x-4px -inset-y-6px rounded-[inherit]) [@media(pointer:coarse)]:after:-inset-y-10px [transition:background_180ms_cubic-bezier(0.2,0.7,0.2,1),border-color_180ms_cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none sx-focus disabled:(opacity-50 cursor-not-allowed)"
      :class="
        enabled
          ? 'border-violet-border bg-[linear-gradient(#8a639f,#7a548c)]'
          : 'border-#c9cfd6 bg-[linear-gradient(#f3f4f5,#fafbfc)] shadow-[inset_0_1px_2px_rgba(31,35,41,0.055)]'
      "
      @click="enabled = !enabled"
    >
      <span
        class="absolute top-2px w-14px h-14px rounded-full bg-white shadow-[0_1px_3px_rgba(31,35,41,0.2)] [transition:left_180ms_cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none"
        :class="enabled ? 'left-16px' : 'left-2px'"
        aria-hidden="true"
      />
    </button>
  </label>
</template>
