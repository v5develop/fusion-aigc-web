<script setup lang="ts">
/**
 * AI 帮写入口（原型 StudioTextCard 的「AI帮写」按钮：柔紫底 + 星芒图标 + 文案）+ 今日剩余免费次数。
 *
 * <p>点一下按 bizType 调 /api/v1/ai/prompt-write：
 * - user-skill（仅流式）：边生成边写进 v-model，见 END 才算完成；ERROR / 截断时还原成调用前的内容并提示原因；
 * - image-prompt（同步、纯文本）：结果直接写进 v-model，同时经 `result` 事件抛出；
 * - 其余业务（result 为 JSON 对象）：走同步口，不动 v-model，结果经 `result` 事件交给页面自行渲染。
 * 每次调用后刷新剩余次数。剩余 0 次不拦截——后端超额后每次扣 1 点，点数不足时由后端返回原因。
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import {
  PROMPT_WRITE_STREAM_ONLY,
  promptWrite,
  promptWriteQuota,
  promptWriteStream,
  type PromptWriteBizType,
  type PromptWriteLanguage,
  type PromptWriteRequest,
  type PromptWriteResult,
} from '@/api/promptWrite'

const props = withDefaults(
  defineProps<{
    bizType: PromptWriteBizType
    /** 作为 content 发送的原始需求；不传则用 v-model 当前值 */
    content?: string
    imageUrls?: string[]
    videoUrls?: string[]
    duration?: number
    language?: PromptWriteLanguage
    disabled?: boolean
    /** 按钮文案，默认「AI帮写」（照原型） */
    label?: string
    /** 是否显示今日剩余次数 */
    showQuota?: boolean
  }>(),
  {
    content: undefined,
    imageUrls: undefined,
    videoUrls: undefined,
    duration: undefined,
    language: undefined,
    disabled: false,
    label: 'AI帮写',
    showQuota: true,
  },
)

/** 文本结果写回的输入框值 */
const model = defineModel<string>({ default: '' })

const emit = defineEmits<{
  /** 同步口的完整响应（JSON 业务靠它拿结果） */
  result: [value: PromptWriteResult]
  /** 生成中状态变化（页面可据此锁输入框） */
  busy: [value: boolean]
}>()

const message = useMessage()
const loading = ref(false)
const remaining = ref<number | null>(null)
let abortStream: (() => void) | null = null

watch(loading, (v) => emit('busy', v))

async function refreshQuota() {
  if (!props.showQuota) return
  try {
    const res = await promptWriteQuota(props.bizType)
    remaining.value = typeof res.data?.remaining === 'number' ? res.data.remaining : null
  } catch {
    remaining.value = null
  }
}

watch(
  () => [props.bizType, props.showQuota] as const,
  () => void refreshQuota(),
  { immediate: true },
)

function buildRequest(): PromptWriteRequest {
  const body: PromptWriteRequest = { bizType: props.bizType, content: props.content ?? model.value ?? '' }
  if (props.imageUrls?.length) body.imageUrls = props.imageUrls
  if (props.videoUrls?.length) body.videoUrls = props.videoUrls
  if (props.duration) body.duration = props.duration
  if (props.language) body.language = props.language
  return body
}

/** user-skill 正文上限（与「我的技能」提示词的 10000 字保存上限一致）：流式超出即截断并停止接收 */
const STREAM_MAX_CHARS = 10000

function runStream(body: PromptWriteRequest) {
  const original = model.value
  let acc = ''
  let settled = false
  const finish = (truncated: boolean) => {
    settled = true
    abortStream = null
    loading.value = false
    model.value = acc
    message.success(truncated ? `AI 帮写已填入，内容超过 ${STREAM_MAX_CHARS} 字已截断` : 'AI 帮写已填入，可直接修改')
    void refreshQuota()
  }
  abortStream = promptWriteStream(body, {
    onChunk(text) {
      if (settled) return
      if (acc.length + text.length > STREAM_MAX_CHARS) {
        acc = (acc + text).slice(0, STREAM_MAX_CHARS)
        model.value = acc
        abortStream?.()
        finish(true)
        return
      }
      acc += text
      model.value = acc
    },
    onEnd() {
      if (settled) return
      finish(false)
    },
    onError(reason) {
      if (settled) return
      settled = true
      abortStream = null
      loading.value = false
      model.value = original
      message.error(reason)
      void refreshQuota()
    },
  })
}

async function runSync(body: PromptWriteRequest) {
  try {
    const res = await promptWrite(body)
    const data = res.data
    if (!data) return
    if (data.responseType === 'text' && typeof data.result === 'string') {
      model.value = data.result
      message.success('AI 帮写已填入，可直接修改')
    }
    emit('result', data)
  } catch {
    // 业务失败的原因由请求拦截器统一提示
  } finally {
    loading.value = false
    void refreshQuota()
  }
}

function onClick() {
  if (props.disabled || loading.value) return
  loading.value = true
  const body = buildRequest()
  if (PROMPT_WRITE_STREAM_ONLY.includes(props.bizType)) runStream(body)
  else void runSync(body)
}

onBeforeUnmount(() => abortStream?.())

defineExpose({ refreshQuota })
</script>

<template>
  <span class="inline-flex items-center gap-8px">
    <button
      type="button"
      class="sx-focus inline-flex items-center gap-4px h-28px px-10px rounded-lg border-none bg-violet-soft text-12px font-500 text-violet-ink cursor-pointer select-none transition-colors hover:bg-violet-soft-2 disabled:(opacity-55 cursor-not-allowed)"
      :disabled="disabled || loading"
      :aria-busy="loading"
      @click="onClick"
    >
      <svg
        v-if="loading"
        class="w-14px h-14px animate-spin motion-reduce:animate-none"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity="0.25" stroke-width="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
      </svg>
      <svg v-else class="w-14px h-14px" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path
          d="M10 3l1.9 5.1L17 10l-5.1 1.9L10 17l-1.9-5.1L3 10l5.1-1.9L10 3zm8 10l.95 2.05L21 16l-2.05.95L18 19l-.95-2.05L15 16l2.05-.95L18 13z"
        />
      </svg>
      {{ label }}
    </button>
    <span v-if="showQuota && remaining !== null" class="text-11px leading-16px tabular-nums text-placeholder">
      剩余 {{ remaining }} 次
    </span>
  </span>
</template>
