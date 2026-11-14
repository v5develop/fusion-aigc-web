<!--
  画布合并冲突弹窗：本地有未保存改动、对方（画布助手 / 其他窗口）又改了同一节点同一字段（或删除 vs 修改）时，
  逐项选「保留我的 / 用对方的」，默认保留我的。没有「强制覆盖」：不冲突的部分已自动合并，这里只决定冲突项。
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { fieldLabel, nodeTitleIn, previewValue, type IMergeConflict, type MergeSide } from './merge.ts'
import type { ICanvasMergePending } from './useCanvasEditor.ts'

const props = defineProps<{ pending: ICanvasMergePending | null }>()
const emit = defineEmits<{ resolve: [choices: Record<string, MergeSide>]; discard: [] }>()

const choices = ref<Record<string, MergeSide>>({})
const busy = ref(false)

watch(
  () => props.pending?.conflicts,
  (list) => {
    // 新出现的冲突默认保留我的；已选过的保留选择
    const next: Record<string, MergeSide> = {}
    for (const conflict of list ?? []) next[conflict.key] = choices.value[conflict.key] ?? 'ours'
    choices.value = next
    busy.value = false
  },
  { immediate: true },
)

const show = computed(() => !!props.pending)

const who = computed(() => {
  const source = props.pending?.source
  if (source === 'agent') return '画布助手'
  if (source === 'run') return '生成任务'
  return '其他窗口'
})

interface IGroup {
  key: string
  title: string
  items: IMergeConflict[]
}

const groups = computed<IGroup[]>(() => {
  const pending = props.pending
  if (!pending) return []
  const map = new Map<string, IGroup>()
  for (const conflict of pending.conflicts) {
    const key = conflict.scope === 'title' ? 'title' : `${conflict.scope}:${conflict.id}`
    let group = map.get(key)
    if (!group) {
      const title =
        conflict.scope === 'title'
          ? '画布标题'
          : conflict.scope === 'edge'
            ? '连线'
            : `节点「${nodeTitleIn(conflict.id, pending.ours, pending.theirs, pending.base)}」`
      group = { key, title, items: [] }
      map.set(key, group)
    }
    group.items.push(conflict)
  }
  return [...map.values()]
})

function kindHint(conflict: IMergeConflict): string {
  if (conflict.kind === 'delete-ours') return `你删除了它，${who.value}修改了它`
  if (conflict.kind === 'delete-theirs') return `${who.value}删除了它，你修改了它`
  return `双方都改了${fieldLabel(conflict.field)}`
}

function oursText(conflict: IMergeConflict): string {
  if (conflict.kind === 'delete-ours') return '删除'
  if (conflict.kind === 'delete-theirs') return '保留（含我的修改）'
  return previewValue(conflict.ours, conflict.field)
}
function theirsText(conflict: IMergeConflict): string {
  if (conflict.kind === 'delete-ours') return '保留（含对方的修改）'
  if (conflict.kind === 'delete-theirs') return '删除'
  return previewValue(conflict.theirs, conflict.field)
}

function setAll(side: MergeSide) {
  const next: Record<string, MergeSide> = {}
  for (const key of Object.keys(choices.value)) next[key] = side
  choices.value = next
}

const theirsCount = computed(() => Object.values(choices.value).filter((v) => v === 'theirs').length)

function confirm() {
  if (busy.value) return
  busy.value = true
  emit('resolve', { ...choices.value })
}

function discard() {
  if (busy.value) return
  busy.value = true
  emit('discard')
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    :mask-closable="false"
    :close-on-esc="false"
    :closable="false"
    :bordered="false"
    style="width: 640px; max-width: calc(100vw - 32px)"
    :title="`${who}也修改了画布`"
    aria-label="画布合并冲突"
  >
    <p class="m-0 mb-12px text-13px leading-20px text-muted">
      不冲突的改动已自动合并。下面 {{ pending?.conflicts.length ?? 0 }} 处你和{{
        who
      }}改了同一个地方，请逐项选择，默认保留你的。
    </p>
    <div class="flex flex-col gap-10px max-h-[56vh] overflow-y-auto pr-4px">
      <section
        v-for="group in groups"
        :key="group.key"
        class="rounded-12px border border-solid border-line bg-surface2 p-10px"
      >
        <h4 class="m-0 mb-8px text-13px font-600 text-ink">{{ group.title }}</h4>
        <div v-for="item in group.items" :key="item.key" class="mb-8px last:mb-0">
          <div class="mb-6px text-12px text-muted">{{ kindHint(item) }}</div>
          <div
            class="grid grid-cols-2 gap-8px"
            role="radiogroup"
            :aria-label="`${group.title} ${fieldLabel(item.field)}`"
          >
            <button
              type="button"
              role="radio"
              class="merge-choice"
              :class="choices[item.key] === 'ours' && 'is-on'"
              :aria-checked="choices[item.key] === 'ours'"
              @click="choices[item.key] = 'ours'"
            >
              <span class="merge-choice__head">保留我的</span>
              <span class="merge-choice__val">{{ oursText(item) }}</span>
            </button>
            <button
              type="button"
              role="radio"
              class="merge-choice"
              :class="choices[item.key] === 'theirs' && 'is-on'"
              :aria-checked="choices[item.key] === 'theirs'"
              @click="choices[item.key] = 'theirs'"
            >
              <span class="merge-choice__head">用{{ who }}的</span>
              <span class="merge-choice__val">{{ theirsText(item) }}</span>
            </button>
          </div>
        </div>
      </section>
    </div>
    <template #footer>
      <div class="flex flex-wrap items-center gap-8px">
        <button type="button" class="merge-btn" @click="setAll('ours')">全部保留我的</button>
        <button type="button" class="merge-btn" @click="setAll('theirs')">全部用{{ who }}的</button>
        <button type="button" class="merge-btn merge-btn--quiet" :disabled="busy" @click="discard">放弃我的修改</button>
        <button type="button" class="merge-btn merge-btn--primary ml-auto" :disabled="busy" @click="confirm">
          {{ busy ? '正在合并…' : theirsCount ? `合并（采用对方 ${theirsCount} 处）` : '合并并保存' }}
        </button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.merge-choice {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--xq-line, #e5e6eb);
  border-radius: 10px;
  background: var(--xq-surface, #fff);
  color: var(--xq-ink, #1f2329);
  text-align: left;
  cursor: pointer;
}
.merge-choice:hover {
  border-color: var(--xq-violet-line, #c9b6d6);
}
.merge-choice.is-on {
  border-color: var(--xq-violet, #6a487b);
  background: var(--xq-violet-soft, #f4eef7);
  box-shadow: 0 0 0 1px var(--xq-violet, #6a487b) inset;
}
.merge-choice:focus-visible,
.merge-btn:focus-visible {
  outline: 2px solid var(--xq-violet, #6a487b);
  outline-offset: 2px;
}
.merge-choice__head {
  font-size: 12px;
  font-weight: 600;
}
.merge-choice__val {
  overflow: hidden;
  font-size: 12px;
  line-height: 18px;
  color: var(--xq-muted, #646a73);
  word-break: break-all;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}
.merge-btn {
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--xq-line, #e5e6eb);
  border-radius: 8px;
  background: var(--xq-surface, #fff);
  color: var(--xq-ink, #1f2329);
  font-size: 13px;
  cursor: pointer;
}
.merge-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.merge-btn--quiet {
  border-color: transparent;
  background: transparent;
  color: var(--xq-danger, #d4380d);
}
.merge-btn--primary {
  border-color: var(--xq-violet, #6a487b);
  background: var(--xq-violet, #6a487b);
  color: var(--xq-on-accent, #fff);
}
</style>
