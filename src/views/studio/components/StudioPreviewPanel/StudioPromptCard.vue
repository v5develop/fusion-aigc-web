<script setup lang="ts">
/**
 * 结果区 · 当前选中任务的提示词（姿势裂变交付包验收 C2 / C4 / C16）。
 *
 * <ul>
 *   <li>显示服务端下发的 `prompt_text`：实际送生图的全文，首行是图序（「图1 是原图，图2 是姿势参考图」），即每条都带图1 / 图2 对应；</li>
 *   <li>姿态复刻：提示词框可编辑、可滚动，高度明显小于图片区；「复制」只复制这一条，「复制全部」按「【姿势 N】」分段；
 *       「编辑后重新生成」= POST /tasks/{id}/regenerate，只重跑这一张，计费同重试（重新冻结 1 张点数）；</li>
 *   <li>商拍换装：只读 + 复制（提示词由反推生成，改提示词不在本期范围）。</li>
 * </ul>
 * 编辑中的草稿按任务号存在本组件里：轮询刷新不会冲掉；服务端提示词变了（重新生成后）且没有未提交的修改时跟着刷新。
 */
import { computed, reactive, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { studioRegenerateTask } from '@/api/studio.ts'
import { toApiError } from '@/api/index.ts'
import type { StudioBatchDetail, StudioTask } from '@/api/studio-types.ts'
import { unitPoints } from './compare.ts'
import { taskLibraryStatus } from '../../constants.ts'

const props = defineProps<{
  detail: StudioBatchDetail
  task: StudioTask
}>()

const emit = defineEmits<{
  /** 重新生成已提交（服务端已重新冻结点数），父级刷新批次 */
  regenerated: []
}>()

const message = useMessage()

const PROMPT_MAX = 3000

const isPose = computed(() => props.detail.batch.kind === 'pose')
const serverText = computed(() => props.task.promptText ?? '')

/** 草稿：task_id → 文本（只存改过的） */
const drafts = reactive<Record<string, string>>({})
const draft = computed({
  get: () => drafts[props.task.taskId] ?? serverText.value,
  set: (v: string) => {
    drafts[props.task.taskId] = v
  },
})
const dirty = computed(() => (drafts[props.task.taskId] ?? serverText.value).trim() !== serverText.value.trim())

// 服务端提示词换了（重新生成后的新提示词）：没有未提交修改的草稿跟着丢掉
watch(serverText, () => {
  if (!dirty.value) delete drafts[props.task.taskId]
})

/** 终态（成功 / 失败）才能重新生成；在跑的等它结束 */
const canRegenerate = computed(
  () => isPose.value && (props.task.status === 2 || props.task.status === 3) && !!draft.value.trim() && !busy.value,
)
const busy = ref(false)

async function copy(text: string, okText: string) {
  if (!text.trim()) return message.warning('还没有可复制的提示词')
  try {
    await navigator.clipboard.writeText(text)
    message.success(okText)
  } catch {
    // 非安全上下文 / 权限被拒：退回选中文本让用户手动复制
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    document.body.removeChild(ta)
    if (ok) message.success(okText)
    else message.error('复制失败，请手动选择文字复制')
  }
}

function copyOne() {
  const label = isPose.value ? `姿势 ${props.task.poseIndex + 1} 的提示词` : '提示词'
  return copy(draft.value, `已复制${label}`)
}

/** 复制全部（C16）：本批每个姿势一段，「【姿势 N】」开头；有草稿的用草稿 */
const allPoseText = computed(() =>
  [...props.detail.tasks]
    .filter((t) => (drafts[t.taskId] ?? t.promptText ?? '').trim())
    .sort((a, b) => a.poseIndex - b.poseIndex)
    .map((t) => `【姿势 ${t.poseIndex + 1}】\n${(drafts[t.taskId] ?? t.promptText ?? '').trim()}`),
)
function copyAll() {
  const parts = allPoseText.value
  if (!parts.length) return message.warning('还没有可复制的提示词')
  return copy(parts.join('\n\n'), `已复制 ${parts.length} 条提示词`)
}

function resetDraft() {
  delete drafts[props.task.taskId]
}

const confirmText = computed(() => {
  const unit = unitPoints(props.detail.batch)
  return `用${dirty.value ? '修改后的' : '当前'}提示词只重新生成姿势 ${props.task.poseIndex + 1} 这一张，会重新冻结 1 张的点数${
    unit ? `（约 ${unit} 点）` : ''
    // 入库中 / 未能入库（§4.6）的成品此刻不在素材库，不承诺「仍保留在素材库」
  }${props.task.status === 2 && !taskLibraryStatus(props.task) ? '；原来的成品仍保留在素材库' : ''}。确定？`
})

async function regenerate() {
  if (!canRegenerate.value) return
  const text = draft.value.trim()
  if (text.length > PROMPT_MAX) return message.warning(`提示词最多 ${PROMPT_MAX} 字`)
  // 请求期间可能切到别的任务：草稿 / 提示语都按发起时的任务算
  const taskId = props.task.taskId
  const poseNo = props.task.poseIndex + 1
  const edited = dirty.value
  busy.value = true
  try {
    await studioRegenerateTask(taskId, text)
  } catch (err) {
    const e = toApiError(err)
    // 业务失败（条件不满足 / 点数不足 / 审核不过）拦截器已 toast；只补接口不存在与传输层失败
    if (e?.httpStatus === 404 && e.code === -1) message.warning('编辑后重新生成暂未开放，可点「重新编辑」再提交')
    else if (!e || e.isNetwork) message.error('请求没有发出去，请检查网络后再试')
    busy.value = false
    return
  }
  delete drafts[taskId]
  message.success(`已按${edited ? '修改后的' : ''}提示词重新提交姿势 ${poseNo}，生成好会自动刷新`)
  emit('regenerated')
  busy.value = false
}
</script>

<template>
  <section
    v-if="serverText || isPose"
    class="flex-none flex flex-col gap-6px p-10px box-border border border-solid border-line rounded-lg bg-white"
    :aria-label="isPose ? `姿势 ${task.poseIndex + 1} 的提示词` : '提示词'"
  >
    <div class="flex items-center gap-6px min-w-0">
      <h3 class="m-0 text-12px font-600 text-ink">提示词</h3>
      <span v-if="isPose" class="text-11px text-muted">姿势 {{ task.poseIndex + 1 }}</span>
      <span v-if="task.promptEdited" class="ll-chip ll-chip-running">已编辑</span>
      <span v-if="isPose && dirty" class="text-11px text-warning">未提交的修改</span>
      <span class="ml-auto flex items-center gap-4px">
        <button
          type="button"
          class="sx-btn-ghost !text-violet-ink hover:!text-violet-press"
          :disabled="!draft"
          @click="copyOne"
        >
          复制
        </button>
        <button
          v-if="isPose && detail.tasks.length > 1"
          type="button"
          class="sx-btn-ghost !text-violet-ink hover:!text-violet-press"
          @click="copyAll"
        >
          复制全部
        </button>
      </span>
    </div>
    <p v-if="!serverText" class="m-0 text-11px leading-16px text-muted">提示词生成后会出现在这里，可直接编辑</p>
    <template v-else>
      <!-- C4：提示词区高度明显小于图片区，可编辑、可滚动 -->
      <label :for="`studio-prompt-${task.taskId}`" class="sr-only">提示词</label>
      <textarea
        :id="`studio-prompt-${task.taskId}`"
        v-model="draft"
        class="block w-full h-96px box-border m-0 px-8px py-6px resize-y overflow-y-auto overscroll-contain rounded-6px border border-solid text-12px leading-18px text-ink-2 outline-none"
        :class="isPose ? 'border-success-line bg-success-soft focus:border-violet' : 'border-line bg-surface2'"
        :readonly="!isPose"
        :maxlength="PROMPT_MAX + 200"
        spellcheck="false"
      />
      <div v-if="isPose" class="flex items-center gap-6px">
        <span class="text-11px leading-16px text-placeholder"
          >图1 原图，图2 本张姿势参考图；改完点右侧只重跑这一张</span
        >
        <button v-if="dirty" type="button" class="sx-btn-ghost ml-auto" @click="resetDraft">撤销修改</button>
        <n-popconfirm :disabled="!canRegenerate" @positive-click="regenerate">
          <template #trigger>
            <button type="button" class="sx-btn" :class="dirty ? '' : 'ml-auto'" :disabled="!canRegenerate">
              {{ busy ? '提交中…' : '编辑后重新生成' }}
            </button>
          </template>
          {{ confirmText }}
        </n-popconfirm>
      </div>
    </template>
  </section>
</template>
