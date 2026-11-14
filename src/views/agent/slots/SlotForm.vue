<script setup lang="ts">
/**
 * 通用入参表单：按 order 排、按 group 分组、visibleWhen 条件显示；每种 type 一个小字段。
 * 错误就地提示（碰过的字段才显示，免得一进来满屏红）；总的「还差什么」由调用方（发送按钮旁）用 validateSlots 同口径给出。
 */
import { computed, reactive } from 'vue'
import FieldBits from './FieldBits.vue'
import ImageSlot from './ImageSlot.vue'
import OverlayHint from '../overlay/OverlayHint.vue'
import { hasOverlayLayout } from '../overlay/overlayLayout.ts'
import { isVisible, validateSlots, type ISlot, type SlotValues } from './slotTypes.ts'

const props = defineProps<{ items: ISlot[]; disabled?: boolean; serverErrors?: Record<string, string>; textOverlay?: boolean }>()
const values = defineModel<SlotValues>({ required: true })

const touched = reactive<Record<string, boolean>>({})
const errors = computed(() => validateSlots(props.items, values.value))
const visible = computed(() => props.items.filter((s) => isVisible(s, values.value)))

/** 无 group 的在前，其余按首次出现的顺序成组 */
const groups = computed(() => {
  const out: { name: string; slots: ISlot[] }[] = []
  for (const s of visible.value) {
    const name = s.group ?? ''
    let g = out.find((x) => x.name === name)
    if (!g) out.push((g = { name, slots: [] }))
    g.slots.push(s)
  }
  return out.sort((a, b) => (a.name ? 1 : 0) - (b.name ? 1 : 0))
})

/** 第一个带版式的文字位旁放开关 */
const firstOverlayKey = computed(() => (props.textOverlay ? visible.value.find(hasOverlayLayout)?.key : undefined))

const uid = Math.random().toString(36).slice(2, 7)
const fid = (s: ISlot) => `slot-${uid}-${s.key}`
const set = (k: string, v: unknown) => (values.value = { ...values.value, [k]: v })
const err = (s: ISlot) => props.serverErrors?.[s.key] || (touched[s.key] ? errors.value[s.key] : '')
</script>

<template>
  <div class="flex flex-col gap-12px" role="group" aria-label="做同款所需内容">
    <fieldset v-for="g in groups" :key="g.name" class="m-0 flex min-w-0 flex-col gap-12px border-0 p-0">
      <legend v-if="g.name" class="mb-2px p-0 text-12px font-600 text-ink-2">{{ g.name }}</legend>
      <div v-for="s in g.slots" :key="s.key" class="flex min-w-0 flex-col gap-4px">
        <div class="flex items-baseline gap-6px">
          <label :id="fid(s) + '-l'" :for="fid(s)" class="text-13px font-600 text-ink">{{ s.label }}</label>
          <span v-if="s.required" class="text-11px text-placeholder">必填</span>
          <span v-else class="text-11px text-placeholder">选填</span>
        </div>
        <ImageSlot
          v-if="s.type === 'image' || s.type === 'video'"
          :model-value="(values[s.key] as string[]) ?? []"
          :field="s"
          :disabled="disabled"
          @update:model-value="set(s.key, $event)"
          @touch="touched[s.key] = true"
        />
        <FieldBits
          v-else
          :id="fid(s)"
          :model-value="values[s.key]"
          :field="s"
          :disabled="disabled"
          @update:model-value="set(s.key, $event)"
          @touch="touched[s.key] = true"
        />
        <OverlayHint v-if="textOverlay && hasOverlayLayout(s)" :first="firstOverlayKey === s.key" :disabled="disabled" />
        <p v-if="s.help && !err(s)" class="m-0 text-11px leading-16px text-muted">{{ s.help }}</p>
        <p v-if="err(s)" class="m-0 text-11px leading-16px text-danger" role="alert">{{ err(s) }}</p>
      </div>
    </fieldset>
  </div>
</template>
