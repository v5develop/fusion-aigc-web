<script setup lang="ts">
/** 小字段：text / textarea / number / price / select / multiselect / switch / color（每种 type 一个分支，都只管长相，值走 v-model）。 */
import type { ISlot } from './slotTypes.ts'

defineProps<{ field: ISlot; disabled?: boolean; id: string }>()
const model = defineModel<unknown>({ required: true })
const emit = defineEmits<{ touch: [] }>()

const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'
const INPUT =
  'box-border h-36px w-full rounded-14px border border-solid border-control bg-surface px-12px text-13px text-ink outline-none placeholder:text-placeholder focus:(border-violet shadow-focus) disabled:opacity-60'

function toggleMulti(v: string) {
  const cur = Array.isArray(model.value) ? (model.value as string[]) : []
  model.value = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]
  emit('touch')
}
function onNumber(e: Event) {
  const t = (e.target as HTMLInputElement).value
  model.value = t === '' ? null : Number(t)
}
</script>

<template>
  <input
    v-if="field.type === 'text'"
    :id="id"
    :value="model as string"
    type="text"
    :maxlength="field.maxLength ? field.maxLength + 20 : undefined"
    :placeholder="field.placeholder"
    :disabled="disabled"
    :class="INPUT"
    @input="model = ($event.target as HTMLInputElement).value"
    @blur="emit('touch')"
  />
  <textarea
    v-else-if="field.type === 'textarea'"
    :id="id"
    :value="model as string"
    rows="3"
    :placeholder="field.placeholder"
    :disabled="disabled"
    :class="[INPUT, '!h-auto resize-y py-8px leading-20px']"
    @input="model = ($event.target as HTMLTextAreaElement).value"
    @blur="emit('touch')"
  />
  <div v-else-if="field.type === 'number' || field.type === 'price'" class="flex items-center gap-6px">
    <span v-if="field.type === 'price'" class="text-13px text-muted">¥</span>
    <input
      :id="id"
      :value="model == null ? '' : String(model)"
      type="number"
      inputmode="decimal"
      :min="field.min"
      :max="field.max"
      :step="field.step ?? (field.type === 'price' ? 0.01 : 1)"
      :placeholder="field.placeholder"
      :disabled="disabled"
      :class="[INPUT, 'max-w-160px']"
      @input="onNumber"
      @blur="emit('touch')"
    />
    <span v-if="field.unit" class="text-12px text-muted">{{ field.unit }}</span>
  </div>
  <div v-else-if="field.type === 'select'" class="flex flex-wrap gap-6px" role="radiogroup" :aria-labelledby="id + '-l'">
    <button
      v-for="o in field.options"
      :key="o.value"
      type="button"
      role="radio"
      :aria-checked="model === o.value"
      :disabled="disabled"
      :class="[
        'h-30px rounded-15px border border-solid px-12px text-12px cursor-pointer',
        model === o.value ? 'border-violet-line bg-violet-tint font-600 text-violet-ink' : 'border-soft-line bg-surface text-muted hover:text-ink',
        FOCUS,
      ]"
      @click="((model = o.value), emit('touch'))"
    >
      {{ o.label }}
    </button>
  </div>
  <div v-else-if="field.type === 'multiselect'" class="flex flex-wrap gap-6px" role="group" :aria-labelledby="id + '-l'">
    <button
      v-for="o in field.options"
      :key="o.value"
      type="button"
      :aria-pressed="Array.isArray(model) && (model as string[]).includes(o.value)"
      :disabled="disabled"
      :class="[
        'h-30px rounded-15px border border-solid px-12px text-12px cursor-pointer',
        Array.isArray(model) && (model as string[]).includes(o.value) ? 'border-violet-line bg-violet-tint font-600 text-violet-ink' : 'border-soft-line bg-surface text-muted hover:text-ink',
        FOCUS,
      ]"
      @click="toggleMulti(o.value)"
    >
      {{ o.label }}
    </button>
  </div>
  <button
    v-else-if="field.type === 'switch'"
    :id="id"
    type="button"
    role="switch"
    :aria-checked="!!model"
    :disabled="disabled"
    :class="['relative h-24px w-42px flex-none rounded-12px border-0 p-0 cursor-pointer [transition:background_.15s]', model ? 'bg-violet-solid' : 'bg-line-strong', FOCUS]"
    @click="((model = !model), emit('touch'))"
  >
    <i :class="['absolute top-2px h-20px w-20px rounded-full bg-white shadow-soft [transition:left_.15s]', model ? 'left-20px' : 'left-2px']" />
  </button>
  <div v-else-if="field.type === 'color'" class="flex items-center gap-8px">
    <input
      :id="id"
      type="color"
      :value="(model as string) || '#875f9a'"
      :disabled="disabled"
      class="h-32px w-44px cursor-pointer rounded-8px border border-solid border-control bg-surface p-2px"
      @input="((model = ($event.target as HTMLInputElement).value), emit('touch'))"
    />
    <span class="text-12px tabular-nums text-muted">{{ model || '未选' }}</span>
  </div>
</template>
