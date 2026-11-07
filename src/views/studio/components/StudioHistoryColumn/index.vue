<script setup lang="ts">
/**
 * 三栏工作台 · 中列历史列表（批次卡片）。
 *
 * <p>批次卡片：封面 / 状态 chip / 进度 / 成功失败数 / 时间，点击选中批次交给右列预览；
 * 顶部「搜索提示词」按已加载批次的提示词本地过滤，底部翻页（原型 .v3-hist__pager「1 / 1」）：
 * 每页 20 条在已加载列表上切片，翻到最后一页且后端还有游标时「下一页」先拉下一批；
 * 列表末尾保留「加载更多」按钮（拉后端下一批游标，追加到已加载列表；原型无触底自动加载，故只留按钮）/「没有更多了」；
 * 在跑批次由 useStudioHistory 自动轮询。
 * 操作：重新编辑（parse payload 后上抛）/ 取消（非终态）/ 删除（终态，二次确认）。
 */
import { computed, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import IconButton from '@/components/IconButton/index.vue'
import CreationHistoryHeader from '@/components/creation/CreationHistoryHeader.vue'
import { studioCancelBatch, studioDeleteBatch } from '@/api/studio.ts'
import type { StudioBatchDetail } from '@/api/studioTypes.ts'
import type { useStudioHistory } from '../../hooks.ts'
import { KIND_LABEL, batchChip, batchProgress, formatTime, isBatchTerminal } from '../../constants.ts'

const props = defineProps<{
  /** useStudioHistory 实例（游标分页 + 在跑批次轮询） */
  history: ReturnType<typeof useStudioHistory>
  /** 当前选中的批次 id（右列在预览的那条） */
  selectedId: number | null
}>()

const emit = defineEmits<{
  select: [detail: StudioBatchDetail]
  /** 重新编辑：payload 已 JSON.parse，回填由页面负责 */
  reedit: [payload: Record<string, unknown>, detail: StudioBatchDetail]
}>()

const message = useMessage()
const ctl = props.history

/** 头部「N 个进行中」 */
const runningCount = computed(() => ctl.items.value.filter((d) => !isBatchTerminal(d.batch.status)).length)


// ---------------- 操作 ----------------

const acting = ref(false)

async function cancelBatch(d: StudioBatchDetail) {
  if (acting.value) return
  acting.value = true
  try {
    const res = await studioCancelBatch(d.batch.id)
    message.success(`已取消 ${res.data?.canceled_tasks ?? 0} 个未开始任务，点数原路退回`)
    await ctl.refresh()
  } finally {
    acting.value = false
  }
}

async function removeBatch(d: StudioBatchDetail) {
  await studioDeleteBatch(d.batch.id)
  message.success('已删除')
  await ctl.refresh()
}

function reedit(d: StudioBatchDetail) {
  let payload: Record<string, unknown>
  try {
    const parsed = JSON.parse(d.batch.payload || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad payload')
    payload = parsed as Record<string, unknown>
  } catch {
    message.error('该记录没有可回填的参数')
    return
  }
  emit('reedit', payload, d)
}

// ---------------- 搜索 + 翻页（原型 .v3-hist__tools / .v3-hist__pager） ----------------

const PAGE_SIZE = 20
const query = ref('')
const page = ref(1)

/** 一条批次可被搜到的提示词：提交快照里的 prompt / global_prompt / pose_prompts + 各任务 prompt_summary */
function promptTextOf(d: StudioBatchDetail): string {
  const parts: string[] = []
  try {
    const p = JSON.parse(d.batch.payload || '{}') as Record<string, unknown>
    if (typeof p.prompt === 'string') parts.push(p.prompt)
    if (typeof p.global_prompt === 'string') parts.push(p.global_prompt)
    if (p.pose_prompts && typeof p.pose_prompts === 'object') {
      for (const v of Object.values(p.pose_prompts as Record<string, unknown>)) {
        if (typeof v === 'string') parts.push(v)
      }
    }
  } catch {
    // payload 不是合法 JSON：只按任务摘要搜
  }
  for (const t of d.tasks) if (t.prompt_summary) parts.push(t.prompt_summary)
  return parts.join('\n').toLowerCase()
}

const filtered = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  if (!keyword) return ctl.items.value
  return ctl.items.value.filter((d) => promptTextOf(d).includes(keyword))
})
const pages = computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)))
const paged = computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))
/** 最后一页且后端还有下一批（不搜索时才拉，搜索只在已加载的记录里找） */
const canFetchMore = computed(() => !query.value.trim() && page.value >= pages.value && ctl.hasMore.value)

watch(query, () => {
  page.value = 1
})
watch(pages, (total) => {
  if (page.value > total) page.value = total
})

const listEl = ref<HTMLElement | null>(null)

async function nextPage() {
  if (page.value < pages.value) page.value += 1
  else if (canFetchMore.value && !ctl.loadingMore.value) {
    await ctl.loadMore()
    if (page.value < pages.value) page.value += 1
  } else return
  listEl.value?.scrollTo({ top: 0 })
}

function prevPage() {
  if (page.value <= 1) return
  page.value -= 1
  listEl.value?.scrollTo({ top: 0 })
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <CreationHistoryHeader :count="ctl.items.value.length" :running="runningCount" />

    <!-- 搜索（原型 .v3-hist__tools：高 30、左 10 放 13 放大镜、字 11；只在有记录时出现） -->
    <div v-if="ctl.items.value.length" class="relative flex flex-none items-center px-12px pb-8px">
      <svg
        class="pointer-events-none absolute left-22px h-13px w-13px text-placeholder"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        v-model="query"
        type="search"
        placeholder="搜索提示词"
        aria-label="搜索历史记录"
        class="h-34px w-full box-border rounded-15px border border-solid border-line bg-white pl-27px pr-8px text-13px text-ink outline-none placeholder:text-placeholder hover:border-control focus:(border-violet shadow-[0_0_0_2px_rgba(138,99,159,0.16)])"
      />
    </div>

    <div
      ref="listEl"
      class="stu-scroll flex-1 min-h-0 px-12px overflow-y-auto [scrollbar-gutter:stable]"
      v-loading="ctl.loading.value"
    >
      <!-- 卡片列表（原型 .v3-hist__list.is-cards：gap 8，内边距 2 0 10） -->
      <div class="flex flex-col gap-8px pt-2px pb-10px">
        <div
          v-for="d in paged"
          :key="d.batch.id"
          class="sx-squircle flex flex-none gap-10px items-center min-h-74px box-border p-10px border border-solid rounded-18px cursor-pointer transition-[border-color,background-color,box-shadow] duration-fast"
          :class="
            d.batch.id === selectedId
              ? 'border-violet-line bg-gradient-to-b from-white to-#faf4fd shadow-[0_1px_2px_rgba(31,35,41,0.05),inset_0_1px_0_#fff]'
              : 'border-line bg-white hover:(border-control shadow-[0_1px_2px_rgba(31,35,41,0.05)])'
          "
          @click="emit('select', d)"
        >
          <!-- 缩略图 44 / r6（原型 .v3-hist__stack） -->
          <div
            class="flex w-44px h-44px flex-[0_0_44px] box-border items-center justify-center overflow-hidden border border-solid border-line rounded-14px bg-surface3"
          >
            <img
              v-if="d.batch.cover_url"
              :src="d.batch.cover_url"
              alt=""
              class="block w-full h-full rounded-13px object-cover"
            />
            <span v-else class="text-11px text-placeholder">{{
              (KIND_LABEL[d.batch.kind] ?? '批次').slice(0, 2)
            }}</span>
          </div>
          <div class="flex flex-1 min-w-0 flex-col gap-6px">
            <div class="flex gap-6px items-start justify-between">
              <p class="m-0 min-w-0 line-clamp-1 text-13px leading-18px text-ink">
                {{ KIND_LABEL[d.batch.kind] ?? d.batch.kind }} · {{ d.batch.task_total }}张 · 成功
                {{ d.batch.task_done }} · 失败 {{ d.batch.task_failed }} · {{ d.batch.estimated_points }}点
              </p>
              <span class="ll-chip" :class="batchChip(d.batch.status).cls">{{ batchChip(d.batch.status).label }}</span>
            </div>
            <div v-if="!isBatchTerminal(d.batch.status)" class="h-4px overflow-hidden rounded-pill bg-line-soft">
              <div
                class="h-full rounded-pill sx-grad-progress transition-[width] duration-slow ease-sx"
                :style="{ width: batchProgress(d.batch) + '%' }"
              />
            </div>
            <div
              v-else-if="d.batch.error_reason"
              class="overflow-hidden text-12px leading-16px text-danger whitespace-nowrap text-ellipsis"
              :title="d.batch.error_reason"
            >
              {{ d.batch.error_reason }}
            </div>
            <!-- 时间 + 操作钮（间距 4） -->
            <div class="flex min-w-0 items-center gap-4px" @click.stop>
              <span class="flex-none text-11px leading-16px text-muted tabular-nums whitespace-nowrap">{{
                formatTime(d.batch.created_at)
              }}</span>
              <span class="ml-auto flex items-center gap-8px">
                <IconButton label="重新编辑" size="sm" @click="reedit(d)">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.8"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 20h4L19 9l-4-4L4 16z" />
                    <path d="M13.5 6.5l4 4" />
                  </svg>
                </IconButton>
                <n-popconfirm v-if="!isBatchTerminal(d.batch.status)" @positive-click="cancelBatch(d)">
                  <template #trigger>
                    <IconButton label="取消批次" size="sm">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <circle cx="12" cy="12" r="8.5" />
                        <path d="M9 9l6 6M15 9l-6 6" />
                      </svg>
                    </IconButton>
                  </template>
                  只会取消还没开始的任务，已开始的继续跑完，确定取消？
                </n-popconfirm>
                <n-popconfirm v-else @positive-click="removeBatch(d)">
                  <template #trigger>
                    <IconButton label="删除批次" size="sm" variant="danger">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5M10.5 11v5M13.5 11v5" />
                      </svg>
                    </IconButton>
                  </template>
                  删除后历史里不再显示（已入素材库的成品图不受影响），确定删除？
                </n-popconfirm>
              </span>
            </div>
          </div>
        </div>

        <!-- 空态 = 一张历史卡大小（原型 .v3-hist__empty.sx-empty：高 65、内边距 0 10、28 圆图标在左） -->
        <div
          v-if="!ctl.loading.value && !ctl.items.value.length"
          class="flex h-65px flex-none items-center gap-8px box-border px-10px border border-dashed border-line-strong rounded-lg bg-gradient-to-b from-white to-surface2 text-left"
        >
          <span
            class="grid w-28px h-28px flex-[0_0_28px] box-border place-items-center border border-solid border-line rounded-full bg-white text-violet-ink"
            aria-hidden="true"
          >
            <svg
              class="w-16px h-16px"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="8.5" />
              <path d="M12 7.5V12l3 2" />
            </svg>
          </span>
          <span class="flex min-w-0 flex-1 flex-col gap-1px overflow-hidden">
            <b class="text-13px font-600 leading-18px text-ink-2">还没有生成记录</b>
            <span
              class="overflow-hidden text-11px leading-15px text-muted whitespace-nowrap text-ellipsis"
              title="左边传好素材、点底部按钮提交，每次生成都会在这一列留一条"
              >左边传好素材、点底部按钮提交，每次生成都会在这一列留一条</span
            >
          </span>
        </div>
        <!-- 搜索无结果（原型：没有匹配的记录 / 换个关键词再试） -->
        <div
          v-if="ctl.items.value.length && !paged.length"
          class="flex flex-col gap-2px box-border px-10px py-12px border border-dashed border-line-strong rounded-lg bg-gradient-to-b from-white to-surface2 text-center"
        >
          <b class="text-13px font-600 leading-18px text-ink-2">没有匹配的记录</b>
          <span class="text-11px leading-15px text-muted">换个关键词再试</span>
        </div>

        <!-- 列表底部：「加载更多」向后端拉下一批（游标 ctl.hasMore / ctl.loadMore），拉回的记录追加进
             已加载列表；下方翻页只在已加载的记录上切片。只在最后一页（列表真正的末尾）出现。 -->
        <template v-if="ctl.items.value.length && page >= pages">
          <div v-if="ctl.loadingMore.value" class="pt-8px pb-2px text-11px text-center">加载中…</div>
          <div
            v-else-if="ctl.hasMore.value"
            class="ll-link py-8px !text-13px text-center"
            @click="ctl.loadMore()"
          >
            加载更多
          </div>
          <div v-else class="pt-8px pb-2px text-11px text-center text-placeholder">没有更多了</div>
        </template>
      </div>
    </div>

    <!-- 翻页（原型 .v3-hist__pager：26 方钮 + 「页 / 总页」11 muted，上 8 下 2） -->
    <div
      v-if="ctl.items.value.length"
      class="flex flex-none items-center justify-center gap-10px px-12px pt-8px pb-10px"
    >
      <IconButton label="上一页" :disabled="page <= 1" @click="prevPage">
        <svg
                    viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </IconButton>
      <span class="text-12px leading-16px text-muted tabular-nums" aria-live="polite">{{ page }} / {{ pages }}</span>
      <IconButton label="下一页" :disabled="(page >= pages && !canFetchMore) || ctl.loadingMore.value" @click="nextPage">
        <svg
                    viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </IconButton>
    </div>
  </div>
</template>

<style scoped lang="less">
@import '@/assets/variables.less';

/* 滚动条 mixin 无法用原子类表达 */
.stu-scroll {
  .scrollbar-autohide(@width: 8px, @trackColor: #fff, @thumbColor: rgba(0, 0, 0, 0.1), @thumbWidth: 4px, @hoverColor: rgba(0, 0, 0, 0.35));
}
</style>
