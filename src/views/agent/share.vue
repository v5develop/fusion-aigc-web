<script setup lang="ts">
/**
 * 智能体会话分享页（免登录）：GET /api/v1/agent/messages/share?token=，返回所选轮次的消息数组。
 * 只读展示：用户消息 + 助手回复（正文 / 执行清单 / 错误），帧归并与对话页共用 replyFromFrames。
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { NConfigProvider, NImage, NSpin } from 'naive-ui'
import { renderMiniMarkdown } from '@/utils/mini-markdown.ts'
import { llTheme } from '@/views/local-life/theme.ts'
import { agentSharedMessages, replyFromFrames } from '@/api/agent.ts'
import type { IAgentMessage, IAgentReply } from '@/api/agent.ts'

defineOptions({ name: 'agent-share' })

interface ShareItem {
  key: string
  role: 'user' | 'assistant'
  text: string
  images: string[]
  reply: IAgentReply | null
}

const route = useRoute()
const token = computed(() => String(route.query.token ?? ''))
const loading = ref(true)
const error = ref('')
const items = ref<ShareItem[]>([])

function toItem(m: IAgentMessage): ShareItem | null {
  if (m.role === 'user') {
    if (m.hidden) return null
    return {
      key: `m${m.id}`,
      role: 'user',
      text: typeof m.content === 'string' ? m.content : '',
      images: (m.imageUrls ?? []).filter(Boolean),
      reply: null,
    }
  }
  if (m.role === 'assistant') {
    const reply = replyFromFrames(m.sseEvents)
    if (!m.sseEvents && typeof m.content === 'string') reply.text = m.content
    return { key: `m${m.id}`, role: 'assistant', text: '', images: [], reply }
  }
  return null
}

onMounted(async () => {
  if (!token.value) {
    error.value = '分享链接无效'
    loading.value = false
    return
  }
  try {
    const res = await agentSharedMessages(token.value)
    items.value = (res.data ?? []).map(toItem).filter((x): x is ShareItem => !!x)
  } catch (err) {
    error.value = err instanceof Error && err.message ? err.message : '分享内容加载失败'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <n-config-provider :theme-overrides="llTheme" abstract>
    <main class="min-h-100vh bg-page px-16px py-24px text-ink">
      <section
        class="mx-auto flex max-w-780px flex-col rounded-8px border border-solid border-line bg-white shadow-card"
        aria-labelledby="agent-share-title"
      >
        <header class="flex h-52px flex-none items-center gap-8px border-b border-solid border-line px-18px">
          <h1 id="agent-share-title" class="m-0 text-15px font-600 leading-20px text-ink">智能体对话分享</h1>
          <span v-if="items.length" class="text-11px text-muted tabular-nums">{{ items.length }} 条消息</span>
        </header>

        <div v-if="loading" class="flex justify-center py-48px" role="status" aria-label="加载中">
          <n-spin size="small" />
        </div>
        <p v-else-if="error" role="alert" class="m-0 px-18px py-48px text-center text-13px text-muted">{{ error }}</p>
        <p v-else-if="!items.length" class="m-0 px-18px py-48px text-center text-13px text-muted">暂无分享内容</p>

        <div v-else role="log" class="flex flex-col gap-16px px-20px py-16px">
          <template v-for="item in items" :key="item.key">
            <div
              v-if="item.role === 'user'"
              class="max-w-520px self-end rounded-[10px_10px_3px_10px] border border-solid border-violet-soft-line bg-[linear-gradient(var(--xq-violet-tint),var(--xq-violet-tint-hover))] px-12px py-9px text-13px leading-20px text-ink"
            >
              <div class="whitespace-pre-wrap break-words">{{ item.text }}</div>
              <div v-if="item.images.length" class="mt-6px flex gap-4px">
                <n-image
                  v-for="(url, i) in item.images.slice(0, 4)"
                  :key="i"
                  :src="url"
                  :width="38"
                  :height="50"
                  object-fit="cover"
                  class="overflow-hidden rounded-3px border border-solid border-white"
                />
              </div>
            </div>
            <div v-else-if="item.reply" class="flex flex-col gap-8px">
              <ul
                v-if="item.reply.tools.length"
                class="m-0 list-none rounded-6px border border-solid border-line-soft bg-sunk-bottom px-12px py-8px"
                aria-label="执行清单"
              >
                <li
                  v-for="(t, i) in item.reply.tools"
                  :key="i"
                  class="flex h-26px items-center gap-8px text-12px text-ink-2"
                >
                  <span class="min-w-0 flex-1 truncate">{{ t.name }}</span>
                  <span :class="['flex-none text-11px', t.status === 'failed' ? 'text-danger' : 'text-placeholder']">{{
                    t.status === 'completed' ? '已完成' : t.status === 'failed' ? t.message || '失败' : '进行中'
                  }}</span>
                </li>
              </ul>
              <div
                v-if="item.reply.text"
                class="md-body break-words text-13px leading-21px text-ink-2"
                v-html="renderMiniMarkdown(item.reply.text)"
              ></div>
              <span v-if="item.reply.error" class="ll-chip ll-chip-error self-start">{{ item.reply.error }}</span>
            </div>
          </template>
        </div>
      </section>
    </main>
  </n-config-provider>
</template>
