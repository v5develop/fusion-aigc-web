<script setup lang="ts">
/**
 * 三栏工作台 · 中列历史列表（批次卡片）。
 *
 * <p>批次卡片：封面 / 状态 chip / 进度 / 成功失败数 / 时间，点击选中批次交给右列预览；
 * 游标分页（滚动触底自动加载 + 兜底按钮）；在跑批次由 useStudioHistory 自动轮询。
 * 操作：重新编辑（parse payload 后上抛）/ 取消（非终态）/ 删除（终态，二次确认）。
 */
import { ref } from 'vue'
import { useMessage } from 'naive-ui'
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

// ---------------- 触底加载 ----------------

const listEl = ref<HTMLElement | null>(null)

function onScroll() {
  const el = listEl.value
  if (!el || !ctl.hasMore.value || ctl.loadingMore.value || ctl.loading.value) return
  if (el.scrollTop + el.clientHeight < el.scrollHeight - 120) return
  void ctl.loadMore()
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <CreationHistoryHeader :count="ctl.items.value.length" @refresh="ctl.reload()" />

    <div
      ref="listEl"
      class="stu-scroll flex-1 min-h-0 px-12px pb-12px overflow-y-auto [scrollbar-gutter:stable]"
      v-loading="ctl.loading.value"
      @scroll="onScroll"
    >
      <div
        v-for="d in ctl.items.value"
        :key="d.batch.id"
        class="flex gap-10px items-start p-10px mb-8px border border-solid rounded-8px shadow-[0_1px_2px_rgba(31,35,41,0.04)] cursor-pointer transition-[border-color,background-color] duration-180 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
        :class="
          d.batch.id === selectedId
            ? 'border-violet-line bg-#f8f4fb'
            : 'border-line bg-white hover:border-#d9dde2 hover:bg-#fbfcfc'
        "
        @click="emit('select', d)"
      >
        <div
          class="flex w-48px h-48px flex-[0_0_48px] items-center justify-center overflow-hidden rounded-6px bg-violet-soft"
        >
          <img v-if="d.batch.cover_url" :src="d.batch.cover_url" alt="" class="block w-full h-full object-cover" />
          <span v-else class="text-11px text-violet-ink">{{ (KIND_LABEL[d.batch.kind] ?? '批次').slice(0, 2) }}</span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex gap-8px items-center justify-between">
            <span class="overflow-hidden text-12px font-600 text-ink whitespace-nowrap text-ellipsis"
              >{{ KIND_LABEL[d.batch.kind] ?? d.batch.kind }} · {{ d.batch.task_total }}张</span
            >
            <span class="ll-chip" :class="batchChip(d.batch.status).cls">{{ batchChip(d.batch.status).label }}</span>
          </div>
          <div class="mt-3px text-11px text-muted">
            成功 {{ d.batch.task_done }} · 失败 {{ d.batch.task_failed }} · {{ d.batch.estimated_points }}点
          </div>
          <div v-if="!isBatchTerminal(d.batch.status)" class="h-4px mt-6px overflow-hidden rounded-999px bg-line-soft">
            <div
              class="h-full rounded-999px bg-[linear-gradient(90deg,#8a639f,#7a548c)] transition-[width] duration-240 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
              :style="{ width: batchProgress(d.batch) + '%' }"
            />
          </div>
          <div
            v-else-if="d.batch.error_reason"
            class="mt-4px overflow-hidden text-11px text-danger whitespace-nowrap text-ellipsis"
            :title="d.batch.error_reason"
          >
            {{ d.batch.error_reason }}
          </div>
          <div class="flex gap-8px items-center justify-between mt-6px">
            <span class="text-10px text-placeholder">{{ formatTime(d.batch.created_at) }}</span>
            <span class="flex gap-10px" @click.stop>
              <span class="text-11px text-violet cursor-pointer hover:text-violet-press" @click="reedit(d)">编辑</span>
              <n-popconfirm v-if="!isBatchTerminal(d.batch.status)" @positive-click="cancelBatch(d)">
                <template #trigger
                  ><span class="text-11px text-violet cursor-pointer hover:text-violet-press">取消</span></template
                >
                只会取消还没开始的任务，已开始的继续跑完，确定取消？
              </n-popconfirm>
              <n-popconfirm v-else @positive-click="removeBatch(d)">
                <template #trigger><span class="text-11px ll-danger-link">删除</span></template>
                删除后历史里不再显示（已入素材库的成品图不受影响），确定删除？
              </n-popconfirm>
            </span>
          </div>
        </div>
      </div>

      <div v-if="!ctl.loading.value && !ctl.items.value.length" class="py-40px px-12px text-center">
        <p class="m-0 text-13px font-600 text-ink-2">还没有生成记录</p>
        <p class="mt-6px mb-0 mx-0 text-11px leading-17px text-placeholder">
          左侧传好素材、点底部按钮提交，每次生成都会在这一列留一条
        </p>
      </div>
      <div v-if="ctl.loadingMore.value" class="pt-8px pb-2px text-11px text-center">加载中…</div>
      <div
        v-else-if="ctl.hasMore.value && ctl.items.value.length"
        class="ll-link pt-8px pb-2px !text-11px text-center"
        @click="ctl.loadMore()"
      >
        加载更多
      </div>
      <div v-else-if="ctl.items.value.length" class="pt-8px pb-2px text-11px text-center text-placeholder">
        没有更多了
      </div>
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
