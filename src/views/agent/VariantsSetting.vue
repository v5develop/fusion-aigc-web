<script setup lang="ts">
/**
 * 「更多设置」里的「一次出几版」（1–4，每档标点数）。
 * 档位点数 = 单价 × 版数（登录用户另加一轮对话费，与版数无关），只是同一份报价的乘法；真正的价格以发送钮旁的报价为准。
 * 超过 maxVariants 的档位置灰并写明原因。
 */
import { computed, ref } from 'vue'
import { NPopover } from 'naive-ui'
import { plazaQuote, quoteTierPoints, type IPlazaQuote, type PlazaResolution } from '@/api/plaza.ts'

const props = defineProps<{
  modelValue: number
  maxVariants: number
  quote: IPlazaQuote | null
  disabled?: boolean
  /** 清晰度（1k 默认）；档位点数各取一次 /quote（按所选版数与参考图张数），不自己算价格 */
  resolution: PlazaResolution
  scope: { industry: string; subIndustry?: string; templateId: number } | null
  refImageCount?: number
}>()
const emit = defineEmits<{ 'update:modelValue': [n: number]; 'update:resolution': [r: PlazaResolution] }>()

const RES: { value: PlazaResolution; label: string }[] = [
  { value: '1k', label: '标准' },
  { value: '2k', label: '高清' },
  { value: '4k', label: '超清' },
]
const resQuotes = ref<Partial<Record<PlazaResolution, IPlazaQuote | null>>>({})
let resKey = ''
/** 打开面板时按（模板 / 参考图张数）各取一次三档价；取不到的档位只写文字，不编造数字 */
function loadResQuotes(show: boolean) {
  const sc = props.scope
  if (!show || !sc) return
  const key = `${sc.industry}|${sc.subIndustry ?? ''}|${sc.templateId}|${props.refImageCount ?? ''}`
  if (key === resKey) return
  resKey = key
  resQuotes.value = {}
  for (const r of RES) {
    plazaQuote({ ...sc, variants: 1, refImageCount: props.refImageCount, resolution: r.value })
      .then((res) => {
        if (key === resKey) resQuotes.value = { ...resQuotes.value, [r.value]: res.data ?? null }
      })
      .catch(() => {
        if (key === resKey) resQuotes.value = { ...resQuotes.value, [r.value]: null }
      })
  }
}
const resTiers = computed(() =>
  RES.map((r) => {
    const q = resQuotes.value[r.value] ?? (r.value === props.resolution ? props.quote : null)
    return { ...r, points: q ? quoteTierPoints(q, Math.max(props.modelValue, 1)) : null }
  }),
)

const tiers = computed(() =>
  [1, 2, 3, 4].map((n) => ({
    n,
    points: props.quote ? quoteTierPoints(props.quote, n) : null,
    off: n > props.maxVariants,
  })),
)
const hint = computed(() => (props.maxVariants <= 1 ? '这个模板一次出 1 版' : ''))
</script>

<template>
  <n-popover trigger="click" placement="top-start" :show-arrow="false" :disabled="disabled" raw @update:show="loadResQuotes">
    <template #trigger>
      <button
        type="button"
        aria-haspopup="dialog"
        :disabled="disabled"
        class="sx-soft-btn !px-11px"
        data-testid="plaza-more-settings"
      >
        更多设置<template v-if="modelValue > 1"> · {{ modelValue }} 版</template
        ><template v-if="resolution !== '1k'"> · {{ resolution }}</template>
      </button>
    </template>
    <div
      role="dialog"
      aria-label="更多设置"
      class="agent-pop sx-squircle mb-8px w-280px max-w-[calc(100vw-48px)] rounded-14px border border-solid border-soft-line sx-soft-bg p-10px shadow-[0_18px_40px_rgba(31,35,41,0.14),inset_0_1px_0_#fff]"
    >
      <div class="px-4px pb-6px text-12px font-600 leading-18px text-ink">清晰度</div>
      <div class="grid grid-cols-3 gap-6px pb-10px" role="radiogroup" aria-label="清晰度">
        <button
          v-for="r in resTiers"
          :key="r.value"
          type="button"
          role="radio"
          :aria-checked="resolution === r.value"
          :class="[
            'sx-squircle flex flex-col items-center gap-2px rounded-12px border border-solid px-4px py-6px text-12px leading-16px cursor-pointer sx-focus',
            resolution === r.value
              ? 'border-violet-line bg-violet-soft font-600 text-violet-ink'
              : 'border-soft-line bg-transparent text-ink-2 hover:border-violet-line',
          ]"
          :data-testid="`plaza-resolution-${r.value}`"
          @click="emit('update:resolution', r.value)"
        >
          <span>{{ r.label }} {{ r.value }}</span>
          <span class="text-11px tabular-nums text-placeholder">{{ r.points != null ? `${r.points} 点` : '—' }}</span>
        </button>
      </div>
      <div class="px-4px pb-6px text-12px font-600 leading-18px text-ink">一次出几版</div>
      <div class="grid grid-cols-4 gap-6px" role="radiogroup" aria-label="一次出几版">
        <button
          v-for="t in tiers"
          :key="t.n"
          type="button"
          role="radio"
          :aria-checked="modelValue === t.n"
          :disabled="t.off"
          :title="t.off ? '这个模板一次只能出 1 版' : undefined"
          :class="[
            'sx-squircle flex flex-col items-center gap-2px rounded-12px border border-solid px-4px py-6px text-12px leading-16px cursor-pointer disabled:(cursor-not-allowed opacity-45) sx-focus',
            modelValue === t.n
              ? 'border-violet-line bg-violet-soft font-600 text-violet-ink'
              : 'border-soft-line bg-transparent text-ink-2 enabled:hover:border-violet-line',
          ]"
          :data-testid="`plaza-variants-${t.n}`"
          @click="emit('update:modelValue', t.n)"
        >
          <span>{{ t.n }} 版</span>
          <span class="text-11px tabular-nums text-placeholder">{{ t.points != null ? `${t.points} 点` : '—' }}</span>
        </button>
      </div>
      <div v-if="hint" class="px-4px pt-6px text-11px leading-16px text-placeholder">{{ hint }}</div>
      <div v-else class="px-4px pt-6px text-11px leading-16px text-placeholder">选好后点发送才会开始，默认 1 版</div>
    </div>
  </n-popover>
</template>
