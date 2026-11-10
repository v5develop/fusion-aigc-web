<script setup lang="ts">
/**
 * 创作页提示词 / 补充说明一体框（原型 OperatePanel `.op-prompt__field` ml 版，2026-11-06 材质对齐）：
 *
 * - 框：r18 squircle、1px 控制描边、`#fbfcfc→#fff` 底；内凹影两档——静止
 *   `inset 0 0 10px .085 + 顶 1px .04`，聚焦加深为 `0 0 16px .12`（不改描边、无紫色环）。
 * - 框最小高 220（视口 <1440 时 320），文字在 textarea 里自己滚，不再拖拽改高。
 * - 底行：左 = 计数（11/16 等宽）+「AI帮写」胶囊（传 helpBizType 时出现，22 高 sm 档）；
 *   右 = 可选「输入润色」液态开关（34×20，schema 的 rewritePrompt 字段挪进框内时用）。
 * - 标签行右侧：可选「我的提示词」书本钮 → 打开 400 宽提示词库浮层，点卡片整条插入（按上限截断）。
 *
 * <p>`variant="ml"`（原型 tool-op.is-ml 一体框）：可见标签收进读屏（必填信息照样读出）；框内顶部一行
 * = `#top-head` 插槽（如参考图计数「0/9」）+ 右侧「我的提示词」书本钮（视觉 24、命中 ≥32），下面是 `#top` 插槽
 * （参考图槽）；框 flex-1 吃满父级余高（父级须是 flex 列）；内边距 12、正文上 8、底行 24 + 上 6。
 *
 * <p>传了 label 就渲染 ll-label 标签行（label for 关联）；不传时页面自己写分组标题，
 * 须给 ariaLabel 作为无障碍名称。
 */
import { computed, ref, useId, useSlots } from 'vue'
import BookOutlineIcon from '@/components/Icons/BookOutlineIcon.vue'
import PromptWriteButton from '@/components/PromptWrite/PromptWriteButton.vue'
import PromptLibraryFlyout from '@/components/Creation/PromptLibraryFlyout.vue'
import type { PromptWriteBizType } from '@/api/prompt-write.ts'

const {
  modelValue = '',
  maxLength = 3000,
  placeholder = '',
  rows = 4,
  label = '',
  required = false,
  ariaLabel,
  disabled = false,
  id,
  helpBizType,
  library = false,
  showRewrite = false,
  rewriteHint = '',
  variant = 'default',
  headInTop = false,
} = defineProps<{
  modelValue?: string
  maxLength?: number
  placeholder?: string
  rows?: number
  label?: string
  required?: boolean
  ariaLabel?: string
  disabled?: boolean
  /** textarea 的 id；不传自动生成 */
  id?: string
  /** 传了就显示「AI帮写」胶囊，并作为 prompt-write 的业务类型 */
  helpBizType?: PromptWriteBizType
  /** 显示「我的提示词」入口与提示词库浮层 */
  library?: boolean
  /** 显示「输入润色」开关（页面把 schema 的 rewritePrompt 字段挪进框内时置 true） */
  showRewrite?: boolean
  /** 「输入润色」的说明（悬停提示 + 读屏描述） */
  rewriteHint?: string
  /** ml = 原型一体框（见文件头）；default = 原来的标签行 + 框 */
  variant?: 'default' | 'ml'
  /**
   * ml：框顶行（计数 + 书本钮）交给 `#top` 插槽里的参考图条自己画（ReferenceStrip / ReferenceStripClassic 的 head），
   * 本组件不再画顶行；插槽拿到 `{ libraryOpen, toggleLibrary }`，书本钮点了调 toggleLibrary(按钮元素)，浮层吸附该按钮
   */
  headInTop?: boolean
}>()

/** 「输入润色」开关值（可选；页面把 rewritePrompt 字段挪进框内时绑定） */
const rewrite = defineModel<boolean>('rewrite', { default: false })

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

defineSlots<{
  top?: (props: { libraryOpen: boolean; toggleLibrary: (anchor: HTMLElement) => void }) => unknown
  'top-head'?: () => unknown
}>()
const slots = useSlots()

const autoId = `creation-prompt-${useId()}`
const fieldId = computed(() => id || autoId)
const countId = computed(() => `${fieldId.value}-count`)
const rewriteHintId = computed(() => `${fieldId.value}-rewrite-hint`)
const length = computed(() => (modelValue ?? '').length)
const ml = computed(() => variant === 'ml')
/** ml 一体框的顶行：有图槽插槽或书本钮时出现 */
const hasTopRow = computed(() => ml.value && !headInTop && (library || !!slots['top-head'] || !!slots.top))

const libraryOpen = ref(false)
const libraryAnchor = ref<HTMLElement | null>(null)
/** 顶行交给参考图条时，书本钮在插槽里：浮层吸附那颗按钮 */
const slotAnchor = ref<HTMLElement | null>(null)
function toggleLibrary(anchor: HTMLElement) {
  slotAnchor.value = anchor
  libraryOpen.value = !libraryOpen.value
}
const textareaRef = ref<HTMLTextAreaElement | null>(null)

/** 提示词库选中：整条插入，按上限截断 */
function onLibraryPick(item: { prompt: string }) {
  const base = modelValue ?? ''
  const merged = (base ? `${base}${base.endsWith('\n') ? '' : '\n'}` : '') + item.prompt
  emit('update:modelValue', merged.slice(0, maxLength))
}

/** 页面进页自动聚焦用（preventScroll，不把整页滚走） */
function focus() {
  textareaRef.value?.focus({ preventScroll: true })
}
defineExpose({ focus })

const bookBtnCls =
  'sx-hit sx-squircle flex-none inline-grid place-items-center w-24px h-24px box-border p-0 rounded-8px border border-solid border-transparent bg-transparent text-muted cursor-pointer ' +
  '[transition:background_110ms,border-color_110ms,color_110ms] motion-reduce:transition-none hover:(border-line bg-surface3 text-ink) sx-focus disabled:(opacity-50 cursor-not-allowed)'
</script>

<template>
  <div :class="ml ? 'flex flex-col flex-[1_1_auto] min-h-[220px] max-[1439px]:min-h-[320px]' : ''">
    <div v-if="!ml && (label || library)" class="ll-label">
      <label v-if="label" :for="fieldId"
        >{{ label }}<span v-if="required" class="text-danger" aria-hidden="true"> *</span></label
      >
      <!-- 我的提示词（原型 MlReferenceHead 右上书本钮）：24×22、r6、悬停 surface3 -->
      <button
        v-if="library"
        ref="libraryAnchor"
        type="button"
        class="ml-auto inline-flex items-center gap-4px h-32px px-8px rounded-8px border border-solid border-transparent bg-transparent text-12px text-muted cursor-pointer hover:(border-line bg-surface3 text-ink)"
        :aria-haspopup="'dialog'"
        :aria-expanded="libraryOpen"
        title="我的提示词"
        aria-label="我的提示词"
        :disabled="disabled"
        @click="libraryOpen = !libraryOpen"
      >
        <BookOutlineIcon :size="14" />
        提示词
      </button>
    </div>
    <div
      class="sx-squircle relative flex flex-col box-border min-h-[220px] max-[1439px]:min-h-[320px] rounded-18px border border-solid border-#c9cfd6 bg-[linear-gradient(#fbfcfc,#ffffff)] shadow-[inset_0_0_10px_rgba(31,35,41,0.085),inset_0_1px_0_rgba(31,35,41,0.04)] [transition:box-shadow_160ms] motion-reduce:transition-none focus-within:shadow-[inset_0_0_16px_rgba(31,35,41,0.12),inset_0_1px_0_rgba(31,35,41,0.05)]"
      :class="[disabled ? 'bg-none bg-surface3 cursor-not-allowed' : '', ml ? 'flex-1 p-12px' : 'p-10px']"
    >
      <!-- ml：字段名只给读屏（必填照读），视觉上不单占一行 -->
      <label v-if="ml && label" :for="fieldId" class="sr-only"
        >{{ label }}<template v-if="required">（必填）</template></label
      >
      <div v-if="hasTopRow" class="flex-none flex items-center gap-8px min-h-24px">
        <slot name="top-head" />
        <span class="flex-1" aria-hidden="true"></span>
        <button
          v-if="library"
          ref="libraryAnchor"
          type="button"
          :class="bookBtnCls"
          aria-haspopup="dialog"
          :aria-expanded="libraryOpen"
          title="我的提示词"
          aria-label="我的提示词"
          :disabled="disabled"
          @click="libraryOpen = !libraryOpen"
        >
          <BookOutlineIcon />
        </button>
      </div>
      <div v-if="ml && $slots.top" class="flex-none" :class="headInTop ? '' : 'mt-8px'">
        <slot name="top" v-bind="{ libraryOpen, toggleLibrary }" />
      </div>
      <textarea
        :id="fieldId"
        ref="textareaRef"
        :value="modelValue ?? ''"
        :rows="rows"
        :maxlength="maxLength"
        :placeholder="placeholder"
        :disabled="disabled"
        :aria-label="label ? undefined : ariaLabel"
        :aria-describedby="countId"
        :aria-required="required || undefined"
        class="block flex-1 w-full min-h-0 box-border m-0 resize-none overflow-y-auto overscroll-contain [field-sizing:fixed] border-none bg-transparent px-0 pb-0 text-13px leading-20px text-ink outline-none placeholder:text-placeholder disabled:(cursor-not-allowed text-placeholder)"
        :class="ml ? 'pt-8px' : 'pt-4px'"
        @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      />
      <div
        class="flex-none flex items-center gap-8px pl-2px pr-2px"
        :class="ml ? 'h-24px mt-6px' : 'min-h-24px mt-4px'"
      >
        <span
          :id="countId"
          class="text-11px leading-16px tabular-nums select-none"
          :class="length >= maxLength ? 'text-warning' : 'text-placeholder'"
          :aria-live="length >= maxLength ? 'polite' : undefined"
          >{{ length >= maxLength ? '已达字数上限 · ' : '' }}{{ length }} / {{ maxLength }}</span
        >
        <PromptWriteButton
          v-if="helpBizType"
          :model-value="modelValue"
          :biz-type="helpBizType"
          size="sm"
          :show-quota="false"
          :disabled="disabled"
          @update:model-value="(value: string) => emit('update:modelValue', value.slice(0, maxLength))"
        />
        <span class="flex-1" aria-hidden="true"></span>
        <!-- 输入润色（原型 .op-prompt__rewrite）：11px muted + 34×20 液态开关 -->
        <span
          v-if="showRewrite"
          class="flex flex-none items-center gap-6px text-11px leading-16px text-muted"
          :title="rewriteHint || undefined"
        >
          <span>输入润色</span>
          <span v-if="rewriteHint" :id="rewriteHintId" class="sr-only">{{ rewriteHint }}</span>
          <button
            type="button"
            role="switch"
            :aria-checked="rewrite"
            aria-label="输入润色"
            :aria-describedby="rewriteHint ? rewriteHintId : undefined"
            :disabled="disabled"
            class="relative after:(content-empty absolute -inset-x-4px -inset-y-6px rounded-[inherit]) [@media(pointer:coarse)]:after:-inset-y-10px flex-none w-34px h-20px box-border p-0 rounded-full border border-solid cursor-pointer [transition:background_180ms_cubic-bezier(0.2,0.7,0.2,1),border-color_180ms_cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none"
            :class="
              rewrite
                ? 'border-violet-border bg-[linear-gradient(#8a639f,#7a548c)]'
                : 'border-#c9cfd6 bg-[linear-gradient(#f3f4f5,#fafbfc)] shadow-[inset_0_1px_2px_rgba(31,35,41,0.055)]'
            "
            @click="rewrite = !rewrite"
          >
            <span
              class="absolute top-2px w-14px h-14px rounded-full bg-white shadow-[0_1px_3px_rgba(31,35,41,0.2)] [transition:left_180ms_cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none"
              :class="rewrite ? 'left-16px' : 'left-2px'"
              aria-hidden="true"
            />
          </button>
        </span>
      </div>
    </div>

    <PromptLibraryFlyout
      v-if="library"
      v-model:show="libraryOpen"
      :anchor="headInTop ? slotAnchor : libraryAnchor"
      @select="onLibraryPick"
    />
  </div>
</template>
