<script setup lang="ts">
/**
 * 字体显示：字号档位 + 字体（预设 / 本机已安装字体），改动立即全站生效，按账号存本机。
 * 机制与取舍见 src/utils/textPrefs.ts；本机字体列举见 src/utils/localFonts.ts。
 */
import { computed, h, onMounted, ref, watch, type VNodeChild } from 'vue'
import type { SelectOption } from 'naive-ui'
import {
  DEFAULT_TEXT_PREFS,
  ROUNDED_CJK_FAMILIES,
  SITE_FONT_STACK,
  TEXT_SCALES,
  fontStackOf,
  quoteFamily,
  resetTextPrefs,
  setTextPrefs,
  textPrefs,
  type TextFont,
  type TextScale,
} from '@/utils/textPrefs.ts'
import {
  detectCuratedFonts,
  hasCjkRoundedFont,
  loadLocalFonts,
  supportsLocalFontAccess,
  type LocalFontOption,
} from '@/utils/localFonts.ts'

const FONT_CHOICES: { value: TextFont; label: string; desc: string }[] = [
  { value: 'default', label: '默认', desc: '站点字体' },
  { value: 'system', label: '系统字体', desc: '与系统界面一致' },
  { value: 'readable', label: '更易读', desc: '字面清楚、字距加宽' },
  { value: 'rounded', label: '圆体', desc: '本机圆体，笔画圆润' },
  { value: 'local', label: '本机字体', desc: '从已安装字体中选' },
]

/** 界面上选中的字体项：选「本机字体」但还没挑具体字体时先不生效，所以和已生效的偏好分开 */
const fontChoice = ref<TextFont>(textPrefs.value.font)
// 已生效的字体被别处改掉（另一个标签页、换号后路由重读）时跟上；sync 刷新，pickFamily(null) 随后把「本机字体」待选态写回
watch(
  () => textPrefs.value.font,
  (font) => {
    fontChoice.value = font
  },
  { flush: 'sync' },
)

const fonts = ref<LocalFontOption[]>([])
const fontsSource = ref<'api' | 'fallback' | ''>('')
const fontsNotice = ref('')
const loadingFonts = ref(false)
const apiSupported = supportsLocalFontAccess()
const cjkRounded = ref(true)

onMounted(() => {
  // 清单探测只量几十个字体，同步做完；完整列表要用户点按钮（API 需要用户手势与授权）
  fonts.value = detectCuratedFonts()
  fontsSource.value = 'fallback'
  cjkRounded.value = hasCjkRoundedFont(ROUNDED_CJK_FAMILIES)
})

async function readLocalFonts() {
  if (loadingFonts.value) return
  loadingFonts.value = true
  try {
    const r = await loadLocalFonts()
    fonts.value = r.fonts
    fontsSource.value = r.source
    fontsNotice.value = r.notice ?? ''
  } finally {
    loadingFonts.value = false
  }
}

function pickScale(v: TextScale) {
  setTextPrefs({ scale: v })
}

function pickFont(v: TextFont) {
  fontChoice.value = v
  if (v === 'local') {
    // 之前选过本机字体就直接恢复；否则等用户在下拉里挑
    if (textPrefs.value.family) setTextPrefs({ font: 'local' })
    return
  }
  setTextPrefs({ font: v, family: '' })
}

function pickFamily(family: string | null) {
  if (!family) {
    setTextPrefs({ font: 'default', family: '' })
    fontChoice.value = 'local'
    return
  }
  setTextPrefs({ font: 'local', family })
}

function onReset() {
  resetTextPrefs()
  fontChoice.value = DEFAULT_TEXT_PREFS.font
}

const isDefault = computed(
  () => textPrefs.value.scale === DEFAULT_TEXT_PREFS.scale && textPrefs.value.font === DEFAULT_TEXT_PREFS.font,
)

const familyValue = computed(() => (textPrefs.value.font === 'local' ? textPrefs.value.family : null))

const familyOptions = computed<SelectOption[]>(() => {
  const list = fonts.value.map((f) => ({ label: f.label, value: f.family, rounded: f.rounded }))
  const cur = textPrefs.value.family
  // 已保存的字体不在当前列表里（还没读完整列表）：补一项，下拉里能看到当前值
  if (cur && !list.some((o) => o.value === cur)) list.unshift({ label: cur, value: cur, rounded: false })
  return list
})

function renderFamilyLabel(option: SelectOption): VNodeChild {
  const family = String(option.value ?? '')
  return h('span', { class: 'inline-flex items-center gap-6px min-w-0' }, [
    h(
      'span',
      { class: 'truncate', style: { fontFamily: `${quoteFamily(family)}, ${SITE_FONT_STACK}` } },
      String(option.label ?? family),
    ),
    option.rounded ? h('span', { class: 'sx-chip shrink-0 bg-violet-soft text-violet-ink' }, '圆体') : null,
  ])
}

function filterFamily(pattern: string, option: SelectOption): boolean {
  const q = pattern.trim().toLowerCase()
  if (!q) return true
  return `${option.label ?? ''} ${option.value ?? ''}`.toLowerCase().includes(q)
}

/** 预览卡跟随已生效的偏好（全站同时生效，这里只是给一块固定的样张） */
const previewFont = computed(() => fontStackOf(textPrefs.value) || SITE_FONT_STACK)
const showRoundedNote = computed(() => textPrefs.value.font === 'rounded' && !cjkRounded.value)

const segItem = (on: boolean) => [
  'relative inline-flex items-center justify-center min-w-56px h-32px px-12px rounded-sm text-13px cursor-pointer select-none',
  'border border-solid transition-colors duration-150 motion-reduce:transition-none',
  'uc-seg-item',
  on ? 'sx-grad-tint border-violet-line text-violet-ink font-600' : 'border-transparent text-ink-2 hover:text-ink',
]
</script>

<template>
  <section aria-labelledby="uc-display-title" class="flex flex-col gap-24px">
    <div class="flex items-center justify-between gap-12px">
      <h2 id="uc-display-title" class="m-0 sx-title-section">字体显示</h2>
      <button type="button" class="sx-btn" :disabled="isDefault" @click="onReset">恢复默认</button>
    </div>

    <fieldset class="m-0 p-0 border-0 flex flex-col gap-8px min-w-0">
      <legend class="p-0 mb-8px text-13px font-500 text-ink-2">字体大小</legend>
      <div role="radiogroup" aria-label="字体大小" class="sx-seg self-start flex-wrap">
        <label v-for="s in TEXT_SCALES" :key="s.value" :class="segItem(textPrefs.scale === s.value)">
          <input
            type="radio"
            name="uc-text-scale"
            class="sr-only"
            :value="s.value"
            :checked="textPrefs.scale === s.value"
            @change="pickScale(s.value)"
          />
          {{ s.label }}
        </label>
      </div>
      <p class="m-0 sx-hint">
        只放大或缩小文字，按钮与布局尺寸不变；画布节点里的文字随画布缩放，不受此项影响。需要整体放大可配合浏览器缩放（Ctrl
        / ⌘ +）。
      </p>
    </fieldset>

    <fieldset class="m-0 p-0 border-0 flex flex-col gap-8px min-w-0">
      <legend class="p-0 mb-8px text-13px font-500 text-ink-2">字体</legend>
      <div role="radiogroup" aria-label="字体" class="sx-seg self-start flex-wrap">
        <label v-for="f in FONT_CHOICES" :key="f.value" :class="segItem(fontChoice === f.value)" :title="f.desc">
          <input
            type="radio"
            name="uc-text-font"
            class="sr-only"
            :value="f.value"
            :checked="fontChoice === f.value"
            @change="pickFont(f.value)"
          />
          {{ f.label }}
        </label>
      </div>
      <p class="m-0 sx-hint">
        {{ FONT_CHOICES.find((f) => f.value === fontChoice)?.desc }}；只使用本机已安装的字体，不会下载字体文件。
      </p>

      <div v-if="fontChoice === 'local'" class="flex flex-col gap-8px max-w-420px">
        <div class="flex items-center gap-8px">
          <n-select
            class="min-w-0 flex-1"
            :value="familyValue"
            :options="familyOptions"
            :render-label="renderFamilyLabel"
            :filter="filterFamily"
            filterable
            clearable
            placeholder="搜索或选择本机字体"
            aria-label="本机字体"
            @update:value="pickFamily"
          />
          <button
            v-if="apiSupported && fontsSource !== 'api'"
            type="button"
            class="sx-btn shrink-0"
            :disabled="loadingFonts"
            @click="readLocalFonts"
          >
            {{ loadingFonts ? '读取中…' : '读取本机字体' }}
          </button>
        </div>
        <p class="m-0 sx-hint" role="status">
          <template v-if="fontsNotice">{{ fontsNotice }}</template>
          <template v-else-if="fontsSource === 'api'"
            >已读取本机全部字体（{{ fonts.length }} 个），中文字体排在前面</template
          >
          <template v-else>
            当前列出本机已安装的常见字体（{{ fonts.length }} 个）{{
              apiSupported ? '；点「读取本机字体」并允许授权可列出全部字体' : ''
            }}
          </template>
        </p>
      </div>
    </fieldset>

    <div class="flex flex-col gap-8px">
      <span class="text-13px font-500 text-ink-2">预览</span>
      <div class="p-16px rounded-xl border border-solid border-line bg-surface2" :style="{ fontFamily: previewFont }">
        <p class="m-0 text-16px font-600 leading-24px text-ink">夏日清凉 · 新品上市</p>
        <p class="mt-6px mb-0 text-13px leading-20px text-ink-2">
          上传商品图后选择场景与风格，AI 会生成多张主图供你挑选。The quick brown fox jumps over the lazy dog. 0123456789
        </p>
        <div class="mt-12px flex items-center gap-8px">
          <span class="sx-btn-primary pointer-events-none" aria-hidden="true">立即生成</span>
          <span class="text-12px text-muted">消耗 20 点数 · 约 30 秒</span>
        </div>
        <p v-if="showRoundedNote" class="mt-10px mb-0 text-12px text-warning">
          本机未安装中文圆体，中文将使用默认字体显示
        </p>
      </div>
      <p class="m-0 sx-hint">设置立即生效，保存在本机并按账号区分；换一台设备需要重新设置。</p>
    </div>
  </section>
</template>

<style scoped>
/* 单选框视觉隐藏在 label 里：键盘聚焦时把焦点环画到整个分段项上（方向键在组内切换是原生 radio 行为） */
.uc-seg-item:has(input:focus-visible) {
  outline: 2px solid #875f9a;
  outline-offset: 2px;
}
</style>
