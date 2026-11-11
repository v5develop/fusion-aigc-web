<script setup lang="ts">
/**
 * 「重新存入素材库」（画布 run 契约 3.4.3 / 商拍任务 §5.2.3）：只在 libraryStatus=failed 时由调用方渲染。
 *
 * - action 由调用方给（调接口 + 把返回的 pending 状态写回 + 接上原有的入库轮询）；本组件只管加载态与失败提示。
 * - 4002 = 距上次失败不到 1 分钟（或这条已无法再转存）：展示后端原话，按钮保持可点，用户稍后再试。
 * - 加载中用 aria-busy + 文案变化表达，不用 pointer-events-none（点击不能穿透到外层卡片 / 画布节点）。
 */
import { ref } from 'vue'
import { useMessage } from 'naive-ui'
import { libraryRetryErrorText } from '@/utils/library-retry'

const props = withDefaults(
  defineProps<{
    action: () => Promise<unknown>
    /** sm：画布节点 / 列表行内（高 24，命中区伪元素补到 32）；md：预览区（高 28） */
    size?: 'sm' | 'md'
  }>(),
  { size: 'md' },
)

const message = useMessage()
const loading = ref(false)

async function onClick() {
  if (loading.value) return
  loading.value = true
  try {
    await props.action()
  } catch (err) {
    // 空串 = 登录失效，拦截器已提示并跳登录
    const text = libraryRetryErrorText(err)
    if (text) message.warning(text)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <button
    type="button"
    class="nodrag sx-hit inline-flex items-center gap-4px shrink-0 box-border border border-solid border-violet-line rounded-6px bg-surface text-violet font-500 whitespace-nowrap cursor-pointer transition-colors duration-fast hover:(bg-violet-tint border-violet) sx-focus"
    :class="[size === 'sm' ? 'h-24px px-8px text-12px' : 'h-28px px-10px text-12px', loading ? 'cursor-wait' : '']"
    :aria-busy="loading || undefined"
    :aria-disabled="loading || undefined"
    title="重新把这条产物存入素材库，不扣点数"
    @click.stop="onClick"
    @pointerdown.stop
  >
    <span
      v-if="loading"
      class="shrink-0 w-10px h-10px box-border border-[1.5px] border-solid border-violet-line border-t-violet rounded-full animate-spin animate-duration-1000 motion-reduce:animate-none"
      aria-hidden="true"
    />
    <svg v-else class="shrink-0" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89M13.5 2.5v3h-3"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    {{ loading ? '正在重新存入…' : '重新存入素材库' }}
  </button>
</template>
