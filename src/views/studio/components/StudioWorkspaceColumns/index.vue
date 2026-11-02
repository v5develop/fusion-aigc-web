<script setup lang="ts">
/**
 * 商拍工作室三栏壳：**左操作 / 中历史 / 右预览**（三栏固定，边看结果边改参数）。
 *
 * <p>版式对齐官方参考包 shell/ToolWorkspaceColumns.vue：左列操作区自己滚 +
 * 底部固定提交条（#action），中列历史（点一条 → 右边预览它），右列预览吃剩下的宽度。
 * 历史数据源（useStudioHistory：游标分页 + 在跑批次 2s 轮询）由壳持有，
 * 页面只填 #operate / #action，提交成功后通过 ref 调 refresh() / openBatch(id)。
 *
 * <p>壳内置 abstract NConfigProvider + llTheme（页面根部不再需要额外 provider）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { NConfigProvider, useMessage } from 'naive-ui'
import { llTheme } from '@/views/local-life/theme.ts'
import type { StudioBatchDetail, StudioKind } from '@/api/studioTypes.ts'
import { useStudioHistory } from '../../hooks.ts'
import { isBatchTerminal } from '../../constants.ts'
import StudioHistoryColumn from '../StudioHistoryColumn/index.vue'
import StudioPreviewPanel from '../StudioPreviewPanel/index.vue'

const { kind = '', title = '' } = defineProps<{
  /** 固定的 kind 过滤；'' = 全部 */
  kind?: StudioKind | ''
  /** 左列标题 */
  title?: string
}>()

const emit = defineEmits<{
  /** 重新编辑：payload 已 JSON.parse，回填由页面负责 */
  reedit: [payload: Record<string, unknown>, detail: StudioBatchDetail]
}>()

const message = useMessage()
const ctl = useStudioHistory(kind, 20, 2000, () => message.warning('该批次已不存在或已被删除'))
onMounted(() => void ctl.reload())

// ---------------- 选中与预览 ----------------

const selectedId = ref<number | null>(null)
const detail = computed(() => ctl.items.value.find((d) => d.batch.id === selectedId.value) ?? null)
/** 选中但详情还没进已加载列表（提交后刷新的瞬间） */
const pending = computed(() => selectedId.value !== null && !detail.value)

/** 未选中时自动落到「最近批次」；选中的批次被删除后同样回落，空列表显示空态引导 */
watch(
  () => ctl.items.value.map((d) => d.batch.id).join(','),
  () => {
    if (detail.value) return
    selectedId.value = ctl.items.value[0]?.batch.id ?? null
  },
)

// 详情批次从非终态走到终态时给一次反馈（列表里其余批次静默，卡片上能看到状态）
watch(
  () => {
    const d = detail.value
    return d ? { id: d.batch.id, status: d.batch.status, reason: d.batch.error_reason } : null
  },
  (now, was) => {
    if (!now || !was || now.id !== was.id) return
    if (!isBatchTerminal(now.status) || isBatchTerminal(was.status)) return
    if (now.status === 4) message.success('批次已全部完成')
    else if (now.status === 5) message.error(now.reason || '批次生成失败，点数已退回')
    else if (now.status === 6) message.warning('批次部分成功，失败任务的点数已退回')
    else message.info('批次已取消')
  },
)

defineExpose({
  /** 提交成功后调用：刷新列表 */
  refresh: ctl.refresh,
  /** 打开某批次详情（提交成功后打开新批次用） */
  openBatch(id: number) {
    selectedId.value = id
  },
})
</script>

<template>
  <n-config-provider :theme-overrides="llTheme" abstract>
    <div class="relative h-full min-h-0">
      <!-- 连续网络失败后暂停轮询的提示条（正常时不出现） -->
      <div
        v-if="ctl.offline.value"
        role="alert"
        class="absolute left-1/2 top-0 z-10 flex -translate-x-1/2 items-center gap-12px rounded-b-8px bg-[#fff1f0] px-16px py-6px text-13px text-[#cf1322] shadow"
      >
        <span>网络异常，已暂停轮询</span>
        <button
          type="button"
          class="cursor-pointer rounded-4px border border-solid border-[#cf1322] bg-transparent px-8px py-2px text-12px text-[#cf1322]"
          @click="ctl.retryPolling()"
        >
          重试
        </button>
      </div>
      <div class="grid h-full min-h-0 gap-12px p-12px bg-page grid-cols-[400px_320px_minmax(0,1fr)]">
        <!-- 左：操作区（上传 + 参数，自己滚；底部提交条贴板底） -->
        <section class="ll-card flex min-h-0 flex-col overflow-hidden">
          <div v-if="title" class="flex-none pt-14px px-14px pb-2px">
            <h1 class="m-0 text-15px font-600 text-ink">{{ title }}</h1>
          </div>
          <div class="stu-scroll flex-1 min-h-0 pt-6px px-14px pb-14px overflow-y-auto [scrollbar-gutter:stable]">
            <slot name="operate" />
          </div>
          <div class="flex-none pt-10px px-14px pb-12px border-t border-solid border-line-soft">
            <slot name="action" />
          </div>
        </section>

        <!-- 中：历史列表 -->
        <section class="ll-card flex min-h-0 flex-col overflow-hidden">
          <StudioHistoryColumn
            :history="ctl"
            :selected-id="selectedId"
            @select="selectedId = $event.batch.id"
            @reedit="(p, d) => emit('reedit', p, d)"
          />
        </section>

        <!-- 右：预览区 -->
        <section class="ll-card flex min-h-0 flex-col overflow-hidden">
          <StudioPreviewPanel
            :history="ctl"
            :detail="detail"
            :pending="pending"
            @reedit="(p, d) => emit('reedit', p, d)"
          />
        </section>
      </div>
    </div>
  </n-config-provider>
</template>

<style scoped lang="less">
@import '@/assets/variables.less';

/* 滚动条 mixin 无法用原子类表达 */
.stu-scroll {
  .scrollbar-autohide(@width: 8px, @trackColor: #fff, @thumbColor: rgba(0, 0, 0, 0.1), @thumbWidth: 4px, @hoverColor: rgba(0, 0, 0, 0.35));
}
</style>
