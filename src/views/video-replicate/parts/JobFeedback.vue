<script setup lang="ts">
/**
 * 成片反馈（CONTRACT §Z）：满意 / 不满意；不满意展开原因多选 + 可选段号 + 备注（≤200 字），提交后「谢谢，已记录」。
 * 独立页与智能体成片卡共用。后端同一用户同一任务同一段重复提交是覆盖更新，所以提交失败可直接重试。
 */
import { computed, ref } from 'vue'
import {
  REPLICATE_FEEDBACK_REASONS,
  replicateErrorText,
  replicateSubmitFeedback,
  type ReplicateFeedbackReason,
} from '@/api/replicate.ts'

const props = defineProps<{ jobId: number; segments?: { index: number }[] }>()

const NOTE_MAX = 200
type Phase = 'idle' | 'down' | 'done'
const phase = ref<Phase>('idle')
const busy = ref(false)
const error = ref('')
const reasons = ref<ReplicateFeedbackReason[]>([])
const segIndex = ref(0)
const note = ref('')
const segOptions = computed(() => (props.segments?.length ?? 0) > 1 ? props.segments! : [])

function toggle(k: ReplicateFeedbackReason) {
  const i = reasons.value.indexOf(k)
  if (i >= 0) reasons.value.splice(i, 1)
  else reasons.value.push(k)
}

async function send(rating: 'up' | 'down') {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await replicateSubmitFeedback(props.jobId, {
      rating,
      ...(rating === 'down'
        ? {
            ...(reasons.value.length ? { reasons: reasons.value } : {}),
            ...(segIndex.value ? { segIndex: segIndex.value } : {}),
            ...(note.value.trim() ? { note: note.value.trim() } : {}),
          }
        : {}),
    })
    phase.value = 'done'
  } catch (err) {
    error.value = replicateErrorText(err, { fallback: '没提交成功，请再试一次' })
  } finally {
    busy.value = false
  }
}
const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'
</script>

<template>
  <div class="flex flex-col gap-8px" aria-label="成片反馈">
    <p v-if="phase === 'done'" class="m-0 text-12px text-muted" role="status">谢谢，已记录</p>
    <template v-else>
      <div class="flex flex-wrap items-center gap-8px">
        <span class="text-12px text-muted">这条视频怎么样？</span>
        <button type="button" class="sx-btn !h-28px" aria-label="满意" :disabled="busy" @click="send('up')">满意</button>
        <button type="button" class="sx-btn !h-28px" :aria-pressed="phase === 'down'" aria-label="不满意" :disabled="busy" @click="phase = 'down'">不满意</button>
      </div>
      <div v-if="phase === 'down'" class="flex flex-col gap-8px rounded-12px bg-surface2 px-12px py-10px">
        <div class="flex flex-wrap gap-6px" role="group" aria-label="不满意的原因（可多选）">
          <button
            v-for="r in REPLICATE_FEEDBACK_REASONS"
            :key="r.key"
            type="button"
            :aria-pressed="reasons.includes(r.key)"
            :class="[
              'h-28px cursor-pointer rounded-14px border border-solid px-12px text-12px',
              reasons.includes(r.key) ? 'border-violet bg-violet-tint font-600 text-violet-ink' : 'border-line bg-transparent text-ink-2',
              FOCUS,
            ]"
            @click="toggle(r.key)"
          >
            {{ r.label }}
          </button>
        </div>
        <label v-if="segOptions.length" class="flex items-center gap-8px text-12px text-muted">
          哪一段
          <select v-model.number="segIndex" :class="['h-28px min-w-0 rounded-8px border border-solid border-line bg-surface px-8px text-12px text-ink', FOCUS]">
            <option :value="0">整条</option>
            <option v-for="s in segOptions" :key="s.index" :value="s.index">第 {{ s.index }} 段</option>
          </select>
        </label>
        <div>
          <textarea
            v-model="note"
            :maxlength="NOTE_MAX"
            rows="2"
            placeholder="还想补充点什么（选填）"
            aria-label="补充说明"
            :class="['box-border w-full resize-none rounded-10px border border-solid border-line bg-surface px-10px py-6px text-12px leading-18px text-ink', FOCUS]"
          />
          <small class="block text-right text-11px tabular-nums text-placeholder">{{ note.length }}/{{ NOTE_MAX }}</small>
        </div>
        <div class="flex items-center gap-8px">
          <button type="button" class="sx-btn-primary !h-30px" :disabled="busy" @click="send('down')">提交</button>
          <button type="button" class="sx-btn !h-30px" :disabled="busy" @click="phase = 'idle'">取消</button>
        </div>
      </div>
      <p v-if="error" class="m-0 text-12px text-warning" role="alert">{{ error }}</p>
    </template>
  </div>
</template>
