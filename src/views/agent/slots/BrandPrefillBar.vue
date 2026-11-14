<script setup lang="ts">
/**
 * 做同款表单顶部的「品牌档案已带入」提示条：已按档案「XX店」填好 N 项，可修改；可切换档案、可「不用档案」；
 * 没有档案时给「建一个品牌档案，下次自动填」入口。恢复「我的模板」时只提示一句，不覆盖。
 */
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { NSwitch } from 'naive-ui'
import type { useBrandPrefill } from './useBrandPrefill.ts'

const props = defineProps<{ brand: ReturnType<typeof useBrandPrefill>; disabled?: boolean }>()
const b = props.brand
const state = computed(() => b.state.value)
const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'
function onPick(e: Event) {
  b.choose(Number((e.target as HTMLSelectElement).value))
}
</script>

<template>
  <div
    v-if="state !== 'hidden'"
    class="flex flex-wrap items-center gap-x-10px gap-y-6px rounded-12px border border-violet-line border-solid bg-violet-soft px-12px py-8px text-12px leading-18px text-ink-2"
    data-testid="brand-prefill-bar"
  >
    <template v-if="state === 'loading'">
      <span class="text-muted">正在找你的品牌档案…</span>
    </template>
    <template v-else-if="state === 'none'">
      <span class="min-w-0 flex-1">没有品牌档案，门头、Logo、店名都要自己放。</span>
      <RouterLink to="/local-life" :class="['font-600 text-violet-ink no-underline hover:underline', FOCUS]">
        建一个品牌档案，下次自动填
      </RouterLink>
    </template>
    <template v-else-if="state === 'restored'">
      <span class="min-w-0 flex-1">已按你保存的内容填好，没有用品牌档案覆盖。</span>
    </template>
    <template v-else>
      <span class="min-w-0 flex-1" role="status">
        <template v-if="b.enabled.value && b.filledCount.value > 0">
          已按你的品牌档案「{{ b.current.value?.title }}」填好 {{ b.filledCount.value }} 项，可修改
        </template>
        <template v-else-if="b.enabled.value">品牌档案「{{ b.current.value?.title }}」里没有这个模板用得上的内容</template>
        <template v-else>没有使用品牌档案</template>
      </span>
      <label v-if="b.profiles.value.length > 1" class="flex items-center gap-4px text-muted">
        档案
        <select
          :value="b.profileId.value ?? undefined"
          :disabled="disabled"
          aria-label="切换品牌档案"
          :class="['h-24px max-w-140px rounded-6px border border-line border-solid bg-white px-4px text-12px text-ink', FOCUS]"
          @change="onPick"
        >
          <option v-for="p in b.profiles.value" :key="p.id" :value="p.id">{{ p.title }}</option>
        </select>
      </label>
      <label class="flex cursor-pointer items-center gap-6px text-muted">
        不用档案
        <NSwitch
          size="small"
          :value="!b.enabled.value"
          :disabled="disabled"
          aria-label="不用品牌档案"
          @update:value="(v: boolean) => b.setEnabled(!v)"
        />
      </label>
    </template>
  </div>
</template>
