<script setup lang="ts">
/**
 * 参考图条 · 原来的样子（与 ReferenceStrip.vue 同 props / 事件，契约见 ./referenceStrip.ts）。
 *
 * <p>计数行：min-h 24、gap 8；计数 11/16 等宽 placeholder；书本钮视觉 24、r8、悬停 surface3、命中 ≥32（sx-hit）。
 * 计数行下 8 是叠片行：StudioImageUpload picker 模式的 78×130 白边叠片（悬停 500ms 摊开、离开 2s 收回、
 * 下方大图面板）；资产入口是叠片右下角外沿的 20 圆云钮（2026-11-10 起取代旁边的「从资产库添加」文字钮，
 * 与原型同一处置；摊开时云钮在「+ 点击添加」格内）。
 */
import { computed, ref } from 'vue'
import BookOutlineIcon from '@/components/Icons/BookOutlineIcon.vue'
import StudioImageUpload from '@/views/studio/components/StudioImageUpload/index.vue'
import type { ReferenceStripEmits, ReferenceStripProps } from './reference-strip'

const props = defineProps<ReferenceStripProps>()
const emit = defineEmits<ReferenceStripEmits>()

/** 云钮（叠片右下角外沿 -12/-12；摊开时在「点击添加」格内）：读屏 / 悬停「从资产库添加」 */
function onCloud() {
  if (props.disabled || props.uploading) return
  emit('asset')
}
const countText = computed(() => props.headText ?? `${props.urls.length}/${props.max}`)
const bookEl = ref<HTMLButtonElement | null>(null)

const bookBtnCls =
  'sx-hit sx-squircle flex-none inline-grid place-items-center w-24px h-24px box-border p-0 rounded-8px border border-solid border-transparent bg-transparent text-muted cursor-pointer ' +
  '[transition:background_110ms,border-color_110ms,color_110ms] motion-reduce:transition-none hover:(border-line bg-surface3 text-ink) sx-focus disabled:(opacity-50 cursor-not-allowed)'
</script>

<template>
  <div class="min-w-0">
    <div v-if="head" class="flex-none flex items-center gap-8px min-h-24px">
      <span class="text-11px leading-16px tabular-nums text-placeholder" :title="headTitle || undefined">{{
        countText
      }}</span>
      <span class="flex-1" aria-hidden="true"></span>
      <button
        v-if="library"
        ref="bookEl"
        type="button"
        :class="bookBtnCls"
        aria-haspopup="dialog"
        :aria-expanded="!!libraryOpen"
        title="我的提示词"
        aria-label="我的提示词"
        :disabled="disabled"
        @click="bookEl && emit('open-library', bookEl)"
      >
        <BookOutlineIcon />
      </button>
    </div>
    <div class="relative flex flex-wrap items-end gap-8px min-w-0" :class="head ? 'mt-8px' : ''">
      <StudioImageUpload
        :model-value="urls"
        picker
        :max="max"
        :multiple="max > 1"
        :disabled="disabled"
        label=""
        :name="label"
        :hint="uploading ? '上传中…' : ''"
        :on-drop-files="onDropFiles"
        :on-cloud="asset ? onCloud : undefined"
        @pick="emit('pick')"
        @remove="(_url: string, index: number) => emit('remove', index)"
        @replace="(index: number) => emit('replace', index)"
        @clear="emit('clear')"
      />
    </div>
  </div>
</template>
