<script setup lang="ts">
/**
 * 结果卡上单张图的叠字状态条：叠字中 / 无字版·叠字版切换 + 改文字 / 失败提示 + 重试。
 * 只管展示与事件，状态与请求在 useTextOverlay。
 */
import { computed, reactive, ref } from 'vue'
import { NInput, NModal } from 'naive-ui'
import type { IOverlayEntry } from './useTextOverlay.ts'
import type { IOverlayField } from './overlayLayout.ts'

const props = defineProps<{
  entry: IOverlayEntry
  fields: IOverlayField[]
}>()
const emit = defineEmits<{
  original: [v: boolean]
  retry: []
  edit: [values: Record<string, string>, done: (ok: boolean) => void]
}>()

const CHIP =
  'rounded-9px bg-white/88 px-6px py-2px text-11px leading-14px text-violet-ink shadow-[0_1px_3px_rgba(0,0,0,0.14)] backdrop-blur-4px'
const BTN =
  'cursor-pointer rounded-9px border-none bg-transparent px-6px py-2px text-11px leading-14px text-violet-ink sx-focus disabled:cursor-default disabled:opacity-60'

const ok = computed(() => props.entry.overlay?.status === 'ok' && !!props.entry.overlay.renderedUrl)
const failed = computed(() => !props.entry.phase && !ok.value && (props.entry.overlay?.status === 'failed' || props.entry.requestFailed))
const busy = computed(() => !!props.entry.phase)

const editing = ref(false)
const saving = ref(false)
const draft = reactive<Record<string, string>>({})
const editError = ref('')

function openEdit() {
  const cur = props.entry.overlay?.values ?? {}
  for (const k of Object.keys(draft)) delete draft[k]
  for (const f of props.fields) draft[f.key] = cur[f.key] ?? ''
  editError.value = ''
  editing.value = true
}
function submitEdit() {
  if (saving.value) return
  const values: Record<string, string> = {}
  for (const f of props.fields) values[f.key] = (draft[f.key] ?? '').trim()
  saving.value = true
  emit('edit', values, (done) => {
    saving.value = false
    if (done) editing.value = false
    else editError.value = '没改成功，请稍后再试'
  })
}
</script>

<template>
  <div class="pointer-events-none absolute inset-x-6px top-6px z-3 flex flex-wrap justify-end gap-4px">
    <span v-if="busy" :class="[CHIP, 'pointer-events-auto']" role="status">
      {{ entry.phase === 'creating' ? '正在加文字…' : entry.phase === 'retrying' ? '重新加字中…' : '正在改文字…' }}
    </span>
    <template v-else-if="ok">
      <span :class="[CHIP, 'pointer-events-auto inline-flex items-center gap-2px']">
        <button type="button" :class="[BTN, !entry.showOriginal && 'font-600']" :aria-pressed="entry.showOriginal" @click="emit('original', true)">
          无字版
        </button>
        <button type="button" :class="[BTN, entry.showOriginal ? '' : 'font-600']" :aria-pressed="!entry.showOriginal" @click="emit('original', false)">
          叠字版
        </button>
        <button v-if="fields.length" type="button" :class="BTN" @click="openEdit">改文字</button>
      </span>
    </template>
    <span v-else-if="failed" :class="[CHIP, 'pointer-events-auto inline-flex items-center gap-4px !text-alert-danger']" role="status">
      文字没加上
      <button type="button" :class="BTN" @click="emit('retry')">重试</button>
    </span>
  </div>
  <NModal v-model:show="editing" preset="card" title="改文字" style="width: 360px; max-width: 92vw" :mask-closable="!saving">
    <div class="flex flex-col gap-10px">
      <label v-for="f in fields" :key="f.key" class="flex flex-col gap-4px text-12px text-ink-2">
        {{ f.label }}
        <NInput v-model:value="draft[f.key]" :maxlength="f.maxLength" :disabled="saving" />
      </label>
      <p v-if="editError" class="m-0 text-12px text-danger" role="alert">{{ editError }}</p>
      <div class="flex justify-end gap-8px">
        <button type="button" :class="BTN" :disabled="saving" @click="editing = false">取消</button>
        <button type="button" :class="BTN" :disabled="saving" @click="submitEdit">{{ saving ? '处理中…' : '确定' }}</button>
      </div>
    </div>
  </NModal>
</template>
