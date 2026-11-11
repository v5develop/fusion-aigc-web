<script setup lang="ts">
/**
 * 外观：浅色 / 深色 / 跟随系统 / 按时间。改动立即全站生效（短交叉淡入），按账号存本机。
 * 机制见 src/utils/themePrefs.ts；色板见 src/theme/tokens.ts。
 *
 * <p>四张选项卡的缩略图是「活的」：每张里的小界面用 data-theme 锁定成浅色或深色，
 * 用的就是全站同一套令牌——这里看到的就是切过去以后的样子。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import {
  THEME_MODES,
  activeTheme,
  isDaytime,
  setThemePrefs,
  themePrefs,
  type ThemeMode,
} from '@/utils/themePrefs.ts'
import ThemePreviewMini from './ThemePreviewMini.vue'

const pick = (mode: ThemeMode) => setThemePrefs({ mode })

/** 时间输入：原生 type=time（键盘可输、深色下系统选择器自动跟随 color-scheme）；非法 / 清空时不写 */
function onTime(field: 'dayStart' | 'nightStart', e: Event) {
  const v = (e.target as HTMLInputElement).value
  if (/^\d{2}:\d{2}$/.test(v)) setThemePrefs({ [field]: v })
}

/** 状态行里的「现在」每分钟走一格，按时间模式的说明随之更新 */
const now = ref(new Date())
const tick = window.setInterval(() => (now.value = new Date()), 30_000)
onBeforeUnmount(() => window.clearInterval(tick))

const status = computed(() => {
  const p = themePrefs.value
  const cur = activeTheme.value === 'dark' ? '深色' : '浅色'
  switch (p.mode) {
    case 'system':
      return `系统当前为${cur}外观，站点跟着用${cur}；系统切换时自动跟随。`
    case 'schedule': {
      if (p.dayStart === p.nightStart) return '开始时间相同，全天使用浅色。'
      const day = isDaytime(p, now.value)
      return day
        ? `现在是白天，使用浅色；${p.nightStart} 自动切到深色。`
        : `现在是夜间，使用深色；${p.dayStart} 自动切回浅色。`
    }
    default:
      return THEME_MODES.find((m) => m.value === p.mode)?.desc ?? ''
  }
})

const optionClass = (on: boolean) => [
  'group relative flex flex-col gap-8px p-8px rounded-xl border border-solid text-left cursor-pointer select-none',
  'transition-colors duration-150 motion-reduce:transition-none uc-theme-opt',
  on ? 'border-violet bg-violet-tint' : 'border-line bg-surface hover:border-control-hover',
]
</script>

<template>
  <fieldset class="m-0 p-0 border-0 flex flex-col gap-10px min-w-0">
    <legend class="p-0 mb-8px text-13px font-500 text-ink-2">外观</legend>
    <div role="radiogroup" aria-label="外观" class="grid grid-cols-2 md:grid-cols-4 gap-12px max-w-720px">
      <label v-for="m in THEME_MODES" :key="m.value" :class="optionClass(themePrefs.mode === m.value)">
        <input
          type="radio"
          name="uc-theme-mode"
          class="sr-only"
          :value="m.value"
          :checked="themePrefs.mode === m.value"
          @change="pick(m.value)"
        />
        <!-- 缩略图：浅 / 深各一张；跟随系统、按时间是左右两半拼起来 -->
        <div class="relative aspect-[16/10] overflow-hidden rounded-lg border border-solid border-line">
          <ThemePreviewMini v-if="m.value !== 'dark'" theme="light" class="absolute inset-0" />
          <ThemePreviewMini
            v-if="m.value !== 'light'"
            theme="dark"
            :class="['absolute inset-0', m.value === 'dark' ? '' : 'uc-theme-half']"
          />
          <span
            v-if="m.value === 'schedule'"
            class="absolute left-6px bottom-6px inline-flex items-center gap-4px px-6px h-18px rounded-pill text-11px font-600 bg-[var(--xq-glass)] text-ink"
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
            {{ themePrefs.dayStart }}
          </span>
          <span
            v-if="m.value === 'schedule'"
            data-theme="dark"
            class="absolute right-6px bottom-6px inline-flex items-center gap-4px px-6px h-18px rounded-pill text-11px font-600 bg-[var(--xq-glass)] text-ink"
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
            </svg>
            {{ themePrefs.nightStart }}
          </span>
        </div>
        <span class="flex items-center justify-between gap-6px px-2px">
          <span :class="['text-13px', themePrefs.mode === m.value ? 'font-600 text-violet-ink' : 'font-500 text-ink']">
            {{ m.label }}
          </span>
          <span
            v-if="themePrefs.mode === m.value"
            class="grid place-items-center w-16px h-16px rounded-full bg-violet text-on-accent"
            aria-hidden="true"
          >
            <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3.5 8.2l3 3 6-6.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
        </span>
      </label>
    </div>

    <div v-if="themePrefs.mode === 'schedule'" class="flex flex-wrap items-center gap-x-16px gap-y-8px">
      <label class="inline-flex items-center gap-8px text-13px text-ink-2">
        浅色开始
        <input
          type="time"
          class="sx-input w-112px tabular-nums"
          :value="themePrefs.dayStart"
          aria-label="浅色开始时间"
          @change="onTime('dayStart', $event)"
        />
      </label>
      <label class="inline-flex items-center gap-8px text-13px text-ink-2">
        深色开始
        <input
          type="time"
          class="sx-input w-112px tabular-nums"
          :value="themePrefs.nightStart"
          aria-label="深色开始时间"
          @change="onTime('nightStart', $event)"
        />
      </label>
    </div>

    <p class="m-0 sx-hint" role="status">{{ status }}</p>
  </fieldset>
</template>

<style scoped>
/* 单选框视觉隐藏在 label 里：键盘聚焦时把焦点环画到整张卡上 */
.uc-theme-opt:has(input:focus-visible) {
  outline: 2px solid var(--xq-focus);
  outline-offset: 2px;
}
/* 跟随系统 / 按时间：深色那张只露右半（斜切，读起来是「一半一半」） */
.uc-theme-half {
  clip-path: polygon(58% 0, 100% 0, 100% 100%, 42% 100%);
}
</style>
