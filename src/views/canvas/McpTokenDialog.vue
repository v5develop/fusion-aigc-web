<script setup lang="ts">
/**
 * 画布 MCP 访问令牌管理：生成（明文只显示一次 + 复制 + MCP 客户端配置示例）、列表、吊销。
 * 接口见 src/api/canvas-mcp-token.ts；服务端只存哈希，关掉弹窗后明文无法再取回。
 */
import { computed, ref, watch } from 'vue'
import { useDialog, useMessage } from 'naive-ui'
import { toApiError } from '@/api/index.ts'
import {
  MCP_TOKEN_TTL_DAYS,
  mcpClientConfig,
  mcpEndpointUrl,
  mcpTokenCreate,
  mcpTokenList,
  mcpTokenRevoke,
} from '@/api/canvas-mcp-token.ts'
import type { IMcpToken, IMcpTokenCreated, McpTokenScope, McpTokenTtlDays } from '@/api/canvas-mcp-token.ts'

const show = defineModel<boolean>('show', { required: true })

const message = useMessage()
const dialog = useDialog()

const loading = ref(false)
const loadError = ref('')
const tokens = ref<IMcpToken[]>([])
const activeCount = ref(0)
const maxActive = ref(10)

const name = ref('')
const ttl = ref<McpTokenTtlDays>(30)
const scope = ref<McpTokenScope>('canvas_rw')
const creating = ref(false)
/** 刚生成的令牌（明文只在这里出现一次；关闭弹窗即清掉） */
const created = ref<IMcpTokenCreated | null>(null)
const revoking = ref<string>('')

const ttlOptions = MCP_TOKEN_TTL_DAYS.map((d) => ({ label: `${d} 天`, value: d }))
const scopeLabel: Record<McpTokenScope, string> = {
  canvas_rw: '画布读写',
  canvas_rw_generate: '画布读写 + 生成',
}

const endpoint = computed(() => mcpEndpointUrl(created.value?.mcpPath || undefined))
const configJson = computed(() => (created.value ? mcpClientConfig(created.value.plainToken, endpoint.value) : ''))
const full = computed(() => activeCount.value >= maxActive.value)
const canCreate = computed(() => !!name.value.trim() && !creating.value && !full.value)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await mcpTokenList()
    tokens.value = res.data?.tokens ?? []
    activeCount.value = res.data?.activeCount ?? 0
    maxActive.value = res.data?.maxActive || 10
  } catch (e) {
    loadError.value = toApiError(e)?.message || '加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

watch(show, (v) => {
  if (v) {
    void load()
    return
  }
  // 关闭即丢弃明文，避免留在内存 / 下次打开还看得到
  created.value = null
  name.value = ''
})

async function create() {
  if (!canCreate.value) return
  creating.value = true
  try {
    const res = await mcpTokenCreate({ name: name.value.trim(), expiresInDays: ttl.value, scope: scope.value })
    // 请求期间弹窗已关闭：丢弃明文，不留在内存里
    if (!show.value) {
      void load()
      return
    }
    if (res.data?.plainToken) {
      created.value = res.data
      name.value = ''
      void load()
    }
  } catch {
    // 业务错误由全局拦截器提示（如已达 10 个上限）
  } finally {
    creating.value = false
  }
}

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    message.success(`${what}已复制`)
  } catch {
    // 非安全上下文 / 无剪贴板权限：退回 execCommand
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    if (ok) message.success(`${what}已复制`)
    else message.warning('复制失败，请手动选中复制')
  }
}

function revoke(t: IMcpToken) {
  dialog.warning({
    title: '吊销令牌',
    content: `吊销「${t.name}」（${t.tokenPrefix}…）后，使用它的 MCP 客户端会立即失去访问权限，且无法恢复。`,
    positiveText: '吊销',
    negativeText: '取消',
    onPositiveClick: async () => {
      revoking.value = t.id
      try {
        await mcpTokenRevoke(t.id)
        message.success('已吊销')
        if (created.value?.token.id === t.id) created.value = null
        await load()
      } catch {
        // 全局拦截器已提示
      } finally {
        revoking.value = ''
      }
    },
  })
}

function fmt(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
</script>

<template>
  <n-modal v-model:show="show" preset="card" title="MCP 访问令牌" :auto-focus="false" style="width: 640px; max-width: calc(100vw - 32px)">
    <p class="m-0 mb-12px text-12px leading-[1.7] text-muted">
      给 Claude Desktop、Cursor 等外部 MCP 客户端操作你的画布用。令牌等同于你的账号对画布的权限，请勿分享；不用时及时吊销。
    </p>

    <!-- 刚生成：明文只显示这一次 -->
    <div v-if="created" class="mb-16px p-12px rounded-8px border border-solid border-line bg-surface2">
      <n-alert type="warning" :show-icon="false" class="mb-10px">
        令牌只显示这一次，关闭后无法再查看。请立即复制并妥善保存。
      </n-alert>
      <div class="text-12px text-muted mb-4px">令牌（{{ created.token.name }} · {{ scopeLabel[created.token.scope] }}）</div>
      <div class="flex items-center gap-8px">
        <n-input :value="created.plainToken" readonly size="small" class="font-mono" />
        <n-button size="small" type="primary" @click="copy(created.plainToken, '令牌')">复制</n-button>
      </div>
      <div class="flex items-center justify-between mt-12px mb-4px">
        <span class="text-12px text-muted">MCP 客户端配置示例</span>
        <n-button size="tiny" quaternary @click="copy(configJson, '配置')">复制配置</n-button>
      </div>
      <pre class="m-0 p-10px rounded-6px bg-white border border-solid border-line text-12px leading-[1.6] overflow-auto max-h-200px">{{ configJson }}</pre>
      <div class="mt-6px text-12px text-muted">
        入口：<span class="font-mono">{{ endpoint }}</span>（Streamable HTTP，请求头 Authorization: Bearer &lt;令牌&gt;）
      </div>
    </div>

    <!-- 生成 -->
    <div class="mb-16px">
      <div class="text-13px text-ink mb-8px font-600">生成新令牌</div>
      <div class="flex flex-wrap items-center gap-8px">
        <n-input v-model:value="name" size="small" :maxlength="50" placeholder="名称，如：Claude Desktop" style="flex: 1 1 180px" />
        <n-select v-model:value="ttl" size="small" :options="ttlOptions" style="width: 96px" />
        <n-button size="small" type="primary" :loading="creating" :disabled="!canCreate" @click="create()">生成</n-button>
      </div>
      <n-radio-group v-model:value="scope" size="small" class="mt-8px">
        <n-radio value="canvas_rw">仅画布读写</n-radio>
        <n-radio value="canvas_rw_generate">画布读写 + 生成（会冻结点数）</n-radio>
      </n-radio-group>
      <div v-if="full" class="mt-6px text-12px text-[#d03050]">已有 {{ activeCount }} 个生效中的令牌（上限 {{ maxActive }}），请先吊销不用的。</div>
    </div>

    <!-- 列表 -->
    <div class="flex items-center justify-between mb-8px">
      <span class="text-13px text-ink font-600">我的令牌</span>
      <span class="text-12px text-muted">生效中 {{ activeCount }} / {{ maxActive }}</span>
    </div>
    <n-spin :show="loading">
      <div v-if="loadError" class="py-16px text-center text-12px text-muted">
        {{ loadError }}
        <n-button size="tiny" text type="primary" class="ml-6px" @click="load()">重试</n-button>
      </div>
      <div v-else-if="!tokens.length && !loading" class="py-16px text-center text-12px text-muted">还没有令牌</div>
      <ul v-else class="m-0 p-0 list-none">
        <li
          v-for="t in tokens"
          :key="t.id"
          class="flex items-center gap-10px py-8px border-b border-b-solid border-line last:border-b-0"
        >
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-6px">
              <span class="text-13px text-ink truncate">{{ t.name }}</span>
              <n-tag size="tiny" :bordered="false">{{ scopeLabel[t.scope] ?? t.scope }}</n-tag>
              <n-tag v-if="t.expired" size="tiny" type="error" :bordered="false">已过期</n-tag>
            </div>
            <div class="mt-2px text-12px text-muted">
              <span class="font-mono">{{ t.tokenPrefix }}…</span>
              · 到期 {{ fmt(t.expiresAt) }}
              · 最后使用 {{ t.lastUsedAt ? `${fmt(t.lastUsedAt)}${t.lastUsedIp ? `（${t.lastUsedIp}）` : ''}` : '从未' }}
            </div>
          </div>
          <n-button size="tiny" type="error" ghost :loading="revoking === t.id" @click="revoke(t)">吊销</n-button>
        </li>
      </ul>
    </n-spin>
  </n-modal>
</template>
