<script setup lang="ts">
import { modelLabelOf } from '@/utils/model-label'
/**
 * 画布详情侧抽屉：基础信息（title / revision / 节点数 / 封面 / 更新时间）
 * + 快照节点数 + 运行历史（最近 50 条，状态徽标）。
 * 只读展示：画布编辑器规划中，本抽屉不做节点编辑。
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { canvasGet, canvasRunGet, canvasRunLibraryRetry, canvasRuns } from '@/api/canvas-home.ts'
import type { ICanvasDetail, ICanvasRunResult } from '@/api/canvas-home.ts'
import LibraryStatusHint from './editor/LibraryStatusHint.vue'

const show = defineModel<boolean>('show', { required: true })

const props = defineProps<{
  /** 当前查看的画布 id；null 时不拉取 */
  canvasId: string | null
}>()

const detail = ref<ICanvasDetail | null>(null)
const runs = ref<ICanvasRunResult[]>([])
const loading = ref(false)

watch(show, (v) => {
  stopLibraryPolls()
  session++
  if (!v) return
  detail.value = null
  runs.value = []
  if (props.canvasId) void load(props.canvasId)
})

async function load(id: string) {
  loading.value = true
  try {
    const [d, r] = await Promise.all([canvasGet(id), canvasRuns(id, 50)])
    detail.value = d.data ?? null
    runs.value = r.data?.items ?? []
  } catch {
    // 业务失败拦截器已 toast；抽屉显示「不存在或已删除」兜底
  } finally {
    loading.value = false
  }
}

// ---------------- 重新存入素材库（契约 3.4.3） ----------------

/** requestId → 轮询定时器：重试后 pending 期间每 3 秒查一次，直到状态变空 / 再次 failed、抽屉关闭 */
const libraryPolls = new Map<string, ReturnType<typeof setTimeout>>()
/** 抽屉每开 / 关一次 +1：重试请求在途时关掉（或换了画布）的，回来不再写回、不再起轮询 */
let session = 0
const LIBRARY_POLL_MS = 3000
/** 跟 10 分钟还是 pending 就不跟了（抽屉里只是展示，重新打开会拿到最新状态） */
const LIBRARY_POLL_LIMIT = 10 * 60_000

function stopLibraryPolls() {
  for (const t of libraryPolls.values()) clearTimeout(t)
  libraryPolls.clear()
}
onBeforeUnmount(stopLibraryPolls)

function patchRun(next: ICanvasRunResult) {
  const at = runs.value.findIndex((r) => r.requestId === next.requestId)
  if (at >= 0) runs.value[at] = { ...runs.value[at], ...next }
}

function pollLibrary(requestId: string, startedAt = Date.now()) {
  const prev = libraryPolls.get(requestId)
  if (prev) clearTimeout(prev)
  libraryPolls.set(
    requestId,
    setTimeout(async () => {
      if (!libraryPolls.has(requestId)) return
      let status: string | undefined = 'pending'
      // 页面在后台不查，下一轮再看（不计入额外时长：仍按 startedAt 封顶 10 分钟）
      if (document.visibilityState === 'hidden') {
        if (Date.now() - startedAt < LIBRARY_POLL_LIMIT) pollLibrary(requestId, startedAt)
        else libraryPolls.delete(requestId)
        return
      }
      const mine = session
      try {
        const res = await canvasRunGet(requestId)
        if (mine !== session || !libraryPolls.has(requestId)) return
        if (res.data) {
          patchRun(res.data)
          status = res.data.libraryStatus
        }
      } catch {
        // 查询失败下一轮再试
      }
      // 请求在途时抽屉关了 / 重开：不能再把定时器挂回去
      if (mine !== session || !libraryPolls.has(requestId)) return
      if (status === 'pending' && Date.now() - startedAt < LIBRARY_POLL_LIMIT) pollLibrary(requestId, startedAt)
      else libraryPolls.delete(requestId)
    }, LIBRARY_POLL_MS),
  )
}

/** 按钮回调：失败原样抛给按钮提示（4002 = 太频繁） */
async function retryLibrary(r: ICanvasRunResult) {
  if (!r.requestId) throw new Error('找不到这条运行记录，请刷新后再试')
  const mine = session
  const res = await canvasRunLibraryRetry(r.requestId)
  if (mine !== session || !show.value || !res.data) return
  patchRun(res.data)
  if (res.data.libraryStatus === 'pending') pollLibrary(r.requestId)
}

/** 快照里的节点数（snapshot 为前端私有 JSON，结构不保证，解析失败就不展示） */
function snapshotNodeCount(): number | null {
  const nodes = detail.value?.snapshot?.nodes
  return Array.isArray(nodes) ? nodes.length : null
}

/** 状态 → 徽标。未认识的状态按 warning 兜底展示原文 */
const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  submitting: { label: '提交中', cls: 'll-chip-running' },
  queued: { label: '排队中', cls: 'll-chip-running' },
  running: { label: '生成中', cls: 'll-chip-running' },
  succeeded: { label: '已完成', cls: 'll-chip-success' },
  failed: { label: '失败', cls: 'll-chip-error' },
  cancelled: { label: '已取消', cls: 'll-chip-warning' },
}

function statusChip(status?: string) {
  return STATUS_MAP[status ?? ''] ?? { label: status || '未知', cls: 'll-chip-warning' }
}

function formatTime(ms?: number) {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
</script>

<template>
  <n-drawer v-model:show="show" :width="520">
    <n-drawer-content title="画布详情" closable>
      <div class="min-h-200px" v-loading="loading">
        <template v-if="detail">
          <div class="h-180px rounded-10px overflow-hidden bg-violet-soft border border-violet-line mb-14px">
            <img v-if="detail.coverUrl" :src="detail.coverUrl" alt="" class="block w-full h-full object-cover" />
            <div v-else class="h-full flex items-center justify-center text-13px text-violet-ink">暂无封面</div>
          </div>

          <div class="mb-16px">
            <div
              class="flex items-baseline gap-12px py-7px border-b border-dashed border-line text-13px last:border-b-0"
            >
              <span class="shrink-0 w-60px text-muted">标题</span>
              <span class="text-ink break-all">{{ detail.title || '未命名画布' }}</span>
            </div>
            <div
              class="flex items-baseline gap-12px py-7px border-b border-dashed border-line text-13px last:border-b-0"
            >
              <span class="shrink-0 w-60px text-muted">版本</span>
              <span
                class="break-all text-12px text-violet-ink [font-family:SFMono-Regular,Consolas,'Liberation_Mono',Menlo,monospace]"
                >{{ detail.revision }}</span
              >
            </div>
            <div
              class="flex items-baseline gap-12px py-7px border-b border-dashed border-line text-13px last:border-b-0"
            >
              <span class="shrink-0 w-60px text-muted">节点数</span>
              <span class="text-ink break-all">{{ detail.nodeCount }}（快照 {{ snapshotNodeCount() ?? '-' }}）</span>
            </div>
            <div
              class="flex items-baseline gap-12px py-7px border-b border-dashed border-line text-13px last:border-b-0"
            >
              <span class="shrink-0 w-60px text-muted">创建时间</span>
              <span class="text-ink break-all">{{ formatTime(detail.createdAt) }}</span>
            </div>
            <div
              class="flex items-baseline gap-12px py-7px border-b border-dashed border-line text-13px last:border-b-0"
            >
              <span class="shrink-0 w-60px text-muted">更新时间</span>
              <span class="text-ink break-all">{{ formatTime(detail.updatedAt) }}</span>
            </div>
          </div>

          <div class="text-14px font-600 text-ink mb-10px">运行历史（最近 {{ runs.length }} 条）</div>
          <div v-if="runs.length" class="flex flex-col gap-8px">
            <div v-for="r in runs" :key="r.runId" class="bg-surface2 border border-line rounded-8px px-12px py-10px">
              <div class="flex items-center gap-10px text-12px">
                <span class="ll-chip" :class="statusChip(r.status).cls">{{ statusChip(r.status).label }}</span>
                <span class="text-ink-2 overflow-hidden text-ellipsis whitespace-nowrap">{{
                  modelLabelOf(r.model) || '未指定模型'
                }}</span>
                <span class="ml-auto shrink-0 text-placeholder">{{ formatTime(r.createdAt) }}</span>
                <span v-if="r.status === 'running' || r.status === 'queued'" class="shrink-0 text-violet-ink"
                  >{{ r.progress }}%</span
                >
              </div>
              <div v-if="r.status === 'failed' && r.error" class="mt-6px text-12px text-danger leading-18px break-all">
                {{ r.error }}
              </div>
              <LibraryStatusHint
                v-if="r.status === 'succeeded'"
                :status="r.libraryStatus"
                :retry="() => retryLibrary(r)"
              />
            </div>
          </div>
          <div v-else class="ll-empty py-40px">还没有运行记录</div>
        </template>

        <div v-else-if="!loading" class="ll-empty py-40px">画布不存在或已删除</div>
      </div>

      <template #footer>
        <div class="text-center text-12px text-muted w-full">画布编辑器规划中，当前支持画布管理与运行历史查看</div>
      </template>
    </n-drawer-content>
  </n-drawer>
</template>
