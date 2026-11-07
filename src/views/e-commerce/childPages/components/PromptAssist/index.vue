<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId } from 'vue'
import { optimizePromptStream } from '@/api/methods.ts'

interface IProps {
  placeholder?: string
  params: {
    // ai_writing:商品套图、a+商品详情、爆款视频、复刻视频  ai_writing_background:人像换背景  aiMergeClothes:搭配融图
    prompt: 'ai_writing' | 'ai_writing_background' | 'aiMergeClothes'
    imageUrls: string[]
  }
  validate: () => boolean // 验证是否可提交，true可，false不可
  ariaLabel?: string // 输入框无障碍名称（分组标题不是 label 元素）
}
const { placeholder, params, validate, ariaLabel = '描述与要求' } = defineProps<IProps>()
const countId = `ec-prompt-count-${useId()}`
const value = defineModel<string>('value', { required: true })

// 提示词、描述类统一上限 3000（规范 §5.4 PROMPT_LIMITS.standard）；到上限时计数变警告色并写明
const MAX_LENGTH = 3000
const atLimit = computed(() => value.value.length >= MAX_LENGTH)

const loading = ref(false)
let abort: (() => void) | null = null

// 将 \n 转为换行符，让 placeholder 支持多行
const placeholderText = computed(() => placeholder?.replace(/\\n/g, '\n'))

const getPrompt = () => {
  if (!validate()) return
  if (loading.value) return

  const userInput = value.value
  loading.value = true
  value.value = '' // 清空后由流式增量逐段填充

  abort = optimizePromptStream(
    { ...params, userInput },
    {
      onDelta: (delta) => {
        value.value += delta
      },
      onDone: (fullText) => {
        loading.value = false
        abort = null
        // 以整段字节权威解码的全文为准覆盖增量结果，纠正部分宿主 webview 增量解码的丢字/乱码
        if (fullText) value.value = fullText
        // 流式无任何输出时（模型不可用/模板缺失），回退用户原输入，避免清空丢失
        if (!value.value) value.value = userInput
      },
      onError: () => {
        loading.value = false
        abort = null
        value.value = userInput
      },
    },
  )
}

onBeforeUnmount(() => abort?.())
</script>

<template>
  <!-- 原型提示词框（规范 §5.4）：r6、line 描边、常驻内影；聚焦时只加深内影，不改描边、不加外环 -->
  <div
    class="flex flex-col p-12px rounded-md border border-solid border-line bg-white shadow-well transition-shadow duration-mid ease-sx motion-reduce:transition-none focus-within:border-violet focus-within:shadow-[inset_0_0_16px_rgba(31,35,41,0.18),inset_0_1px_0_rgba(31,35,41,0.08)]"
  >
    <n-spin :show="loading">
      <textarea
        v-model="value"
        class="block w-full h-162px box-border m-0 p-0 resize-none border-none outline-none bg-transparent text-13px leading-20px text-ink placeholder:text-placeholder"
        :maxlength="MAX_LENGTH"
        :placeholder="placeholderText"
        :aria-label="ariaLabel"
        :aria-describedby="countId"
      ></textarea>
    </n-spin>

    <div class="flex items-center justify-between gap-8px min-h-32px mt-6px">
      <button
        type="button"
        class="sx-btn-tint !h-32px !px-12px !text-12px"
        :aria-busy="loading || undefined"
        @click="getPrompt"
      >
        AI帮写
      </button>

      <div class="flex items-center gap-4px min-w-0">
        <span
          :id="countId"
          class="text-11px leading-16px tabular-nums select-none whitespace-nowrap"
          :class="atLimit ? 'text-warning' : 'text-placeholder'"
          >{{ atLimit ? '已达字数上限 · ' : '' }}{{ value.length }} / {{ MAX_LENGTH }}</span
        >
        <span class="sr-only" aria-live="polite">{{ atLimit ? '已达字数上限' : '' }}</span>
        <button
          type="button"
          class="sx-btn-ghost !w-32px !h-32px !p-0 !text-14px"
          aria-label="清空内容"
          @click="value = ''"
        >
          <i class="icon-ic_ds_Delete1" aria-hidden="true"></i>
        </button>
      </div>
    </div>
  </div>
</template>
