<script setup lang="ts">
/**
 * 二级细分 chip 行（EXPERIENCE §3.3）：「细分」标签 + 不限 + 各二级；选了二级，三个 Tab 都收窄到它。
 * 只有行业有 children 才渲染；释义（蓝V号 / 达人号是什么）取行业 hint，放在 chip 的 title 与行尾灰字里。
 */
import type { IIndustry } from '@/api/plaza.ts'
import { plazaIndustrySuggest } from '@/api/plaza.ts'
import { ref } from 'vue'

const props = defineProps<{ industry: IIndustry; sub: string }>()
const emit = defineEmits<{ select: [code: string] }>()

const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'

function chipClass(on: boolean) {
  return [
    'flex-none h-32px px-14px rounded-16px border border-solid text-12px whitespace-nowrap cursor-pointer select-none',
    '[transition:border-color_0.12s,background_0.12s,color_0.12s] motion-reduce:transition-none',
    on
      ? 'border-violet-line bg-[linear-gradient(var(--xq-surface),var(--xq-violet-tint))] font-600 text-violet-ink'
      : 'border-soft-line bg-surface text-muted hover:(border-control-hover text-ink)',
    FOCUS,
  ]
}

const sugOpen = ref(false)
const sugText = ref('')
const sugDone = ref(false)
function submit() {
  void plazaIndustrySuggest(sugText.value).catch(() => undefined)
  sugDone.value = true
  setTimeout(() => {
    sugOpen.value = false
    sugDone.value = false
    sugText.value = ''
  }, 4000)
}
const subNames = () => (props.industry.children ?? []).map((c) => c.name).join('、')
</script>

<template>
  <div v-if="industry.children?.length" class="mb-14px flex flex-col gap-6px">
    <div class="flex min-w-0 items-center gap-8px">
      <span class="flex-none text-12px text-placeholder">细分</span>
      <div
        class="flex min-w-0 flex-1 items-center gap-8px overflow-x-auto py-2px [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="group"
        aria-label="细分"
      >
        <button
          type="button"
          :aria-pressed="!sub"
          :title="`不限细分，含${subNames()}`"
          :class="chipClass(!sub)"
          @click="emit('select', '')"
        >
          不限
        </button>
        <button
          v-for="c in industry.children"
          :key="c.code"
          type="button"
          :aria-pressed="sub === c.code"
          :class="chipClass(sub === c.code)"
          @click="emit('select', c.code)"
        >
          {{ c.name }}
        </button>
        <button
          v-if="!sugOpen"
          type="button"
          class="m-0 flex-none border-0 bg-transparent px-6px py-6px text-12px text-violet-ink cursor-pointer hover:underline"
          :class="FOCUS"
          @click="sugOpen = true"
        >
          没有你的细分？告诉我们
        </button>
      </div>
    </div>
    <p v-if="industry.hint" class="m-0 text-11px leading-16px text-placeholder">{{ industry.hint }}</p>
    <div v-if="sugOpen" class="flex flex-wrap items-center gap-8px">
      <p v-if="sugDone" class="m-0 text-12px text-ink-2" role="status">收到了，谢谢！有新行业会在这里出现</p>
      <template v-else>
        <input
          v-model="sugText"
          maxlength="40"
          aria-label="你想要哪个细分"
          placeholder="你想要哪个细分？比如：烘焙、火锅、日料"
          class="box-border h-32px w-280px max-w-full rounded-16px border border-solid border-control bg-surface px-12px text-12px text-ink outline-none placeholder:text-placeholder focus:(border-violet shadow-focus)"
          @keydown.enter.prevent="submit"
        />
        <button type="button" class="sx-soft-btn sx-soft-btn-primary" @click="submit">告诉我们</button>
        <button type="button" class="sx-soft-btn" @click="sugOpen = false">先逛逛现有行业</button>
      </template>
    </div>
  </div>
</template>
