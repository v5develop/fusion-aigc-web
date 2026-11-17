<script setup lang="ts">
/**
 * 对话卡片：发布文案（CONTRACT §N，免费）。纯展示 + 复制到剪贴板，不调任何接口。
 */
import { computed } from 'vue'
import { useMessage } from 'naive-ui'
import type { ReplicatePublishCopy } from '@/api/replicate.ts'

const props = defineProps<{ view: ReplicatePublishCopy }>()
const message = useMessage()

const PLATFORM: Record<string, string> = { douyin: '抖音', kuaishou: '快手', xiaohongshu: '小红书', shipinhao: '视频号' }
const platform = computed(() => PLATFORM[props.view.platform] ?? '短视频平台')
const titles = computed(() => props.view.titles ?? [])
const tags = computed(() => props.view.hashtags ?? [])
const left = computed(() => Math.max(0, (props.view.quotaTotal || 0) - (props.view.quotaUsed || 0)))
const coverSec = computed(() => (Number.isFinite(props.view.coverAtSec) ? Number(props.view.coverAtSec.toFixed(1)) : null))

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    message.success('已复制')
  } catch {
    message.error('复制失败，请手动选择文本复制')
  }
}
</script>

<template>
  <section class="sx-squircle w-full max-w-520px rounded-18px sx-soft px-16px py-14px" aria-label="发布文案">
    <h3 class="vr-h3">{{ platform }}发布文案</h3>
    <p class="vr-sub">3 个标题任选，话题和描述点一下就能复制</p>

    <ul class="m-0 flex list-none flex-col gap-6px p-0">
      <li v-for="(t, i) in titles" :key="i" class="flex items-start gap-8px rounded-10px border border-solid border-line bg-surface2 px-10px py-8px">
        <span class="min-w-0 flex-1 break-words text-13px leading-20px text-ink">{{ t }}</span>
        <button type="button" class="sx-btn !h-26px flex-none !px-10px !text-12px" :aria-label="`复制标题 ${i + 1}`" @click="copy(t)">复制</button>
      </li>
    </ul>

    <div v-if="tags.length" class="mt-10px">
      <div class="flex flex-wrap gap-6px">
        <span v-for="h in tags" :key="h" class="rounded-full bg-violet-tint px-10px py-2px text-12px leading-20px text-ink-2">{{ h }}</span>
      </div>
      <button type="button" class="sx-btn mt-8px !h-28px !px-12px !text-12px" @click="copy(tags.join(' '))">复制全部话题</button>
    </div>

    <div v-if="view.description" class="mt-10px flex items-start gap-8px rounded-10px border border-solid border-line bg-surface2 px-10px py-8px">
      <span class="min-w-0 flex-1 whitespace-pre-wrap break-words text-13px leading-20px text-ink-2">{{ view.description }}</span>
      <button type="button" class="sx-btn !h-26px flex-none !px-10px !text-12px" aria-label="复制描述" @click="copy(view.description)">复制</button>
    </div>

    <p v-if="coverSec !== null" class="m-0 mt-10px text-12px leading-18px text-muted">建议封面：第 {{ coverSec }} 秒的画面</p>
    <p class="m-0 mt-4px text-12px leading-18px text-muted" role="status">今天还能生成 {{ left }} 次</p>
  </section>
</template>
