<script setup lang="ts">
/**
 * 商拍工作室三栏壳：**左操作 / 中历史 / 右预览**（三栏固定，边看结果边改参数）。
 *
 * <p>版式对齐官方参考包 shell/ToolWorkspaceColumns.vue：左列操作区自己滚 +
 * 底部固定提交条（#action），中列历史（点一条 → 右边预览它），右列预览吃剩下的宽度。
 * 历史数据源（useStudioHistory：游标分页 + 在跑批次 2s 轮询）由壳持有，
 * 页面只填 #operate / #action，提交成功后通过 ref 调 refresh() / openBatch(id)。
 * 右列无结果时的「功能介绍」默认按 feature（缺省 = kind）查 StudioPreviewPanel/intro.ts，
 * 页面可传 intro / scenes 或 #intro 插槽覆盖。
 *
 * <p>壳内置 abstract NConfigProvider + llTheme（页面根部不再需要额外 provider）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import IconButton from '@/components/IconButton/index.vue'
import { NConfigProvider, NPopover, useMessage } from 'naive-ui'
import { llTheme } from '@/views/local-life/theme.ts'
import type { StudioBatchDetail, StudioKind } from '@/api/studioTypes.ts'
import { useStudioHistory } from '../../hooks.ts'
import { isBatchTerminal } from '../../constants.ts'
import StudioHistoryColumn from '../StudioHistoryColumn/index.vue'
import StudioPreviewPanel from '../StudioPreviewPanel/index.vue'
import { tools } from '@/views/home/tools.ts'

const {
  kind = '',
  title = '',
  feature,
  intro,
  scenes,
} = defineProps<{
  /** 固定的 kind 过滤；'' = 全部 */
  kind?: StudioKind | ''
  /** 左列顶部功能卡的功能名（原型 FunctionSwitcher ml：缩略 56×40 + 功能名 15 + 说明 11 + 切换箭头） */
  title?: string
  /** 右列功能介绍的文案键（查 StudioPreviewPanel/intro.ts）；不传取 kind，再不行取路由名去掉 `studio-` */
  feature?: string
  /** 右列功能介绍正文；传了覆盖默认文案 */
  intro?: string
  /** 右列适用场景；传了覆盖默认文案 */
  scenes?: string[]
}>()

const emit = defineEmits<{
  /** 重新编辑：payload 已 JSON.parse，回填由页面负责 */
  reedit: [payload: Record<string, unknown>, detail: StudioBatchDetail]
}>()

const message = useMessage()
const router = useRouter()
const route = useRoute()

/** 右列功能介绍的文案键 */
const introFeature = computed(() => feature || kind || String(route.name ?? '').replace(/^studio-/, ''))

/**
 * 功能卡缩略块里的线性图标：取原型 qi-tool-icons（change-clothes / pose / generate），
 * 与首页工具箱同一份 SVG 片段（views/home/tools.ts），按工具 id 查，不另抄一份路径。
 */
const HEAD_ICON_TOOL: Record<StudioKind, string> = {
  tryon: 'ai-digital-model',
  pose: 'ai-posture-fission',
  imagegen: 'image-generate',
}
function iconOf(k: StudioKind | '') {
  const id = k ? HEAD_ICON_TOOL[k] : HEAD_ICON_TOOL.imagegen
  return tools.find((t) => t.id === id)?.icon ?? ''
}
const headIcon = computed(() => iconOf(kind))

/** 功能卡切换面板里的三件套；说明取原型 next-directory TOOL_DESC 的 4–5 字短说明 */
const SWITCH_ENTRIES: { kind: StudioKind; name: string; desc: string; path: string }[] = [
  { kind: 'tryon', name: '商拍换装', desc: '整套换装', path: '/studio/ai-digital-model' },
  { kind: 'pose', name: '姿态复刻', desc: '同人换姿势', path: '/studio/ai-posture-fission' },
  { kind: 'imagegen', name: '图片生成', desc: '提示词生图', path: '/studio/image-generate' },
]
const currentEntry = computed(() => SWITCH_ENTRIES.find((e) => e.kind === kind) ?? null)
const switchOpen = ref(false)
function onSwitch(path: string) {
  switchOpen.value = false
  if (route.path !== path) void router.push(path)
}

/** 返回：有站内上一页就退回，否则回工作室首页 */
function back() {
  if (window.history.state?.back) router.back()
  else void router.push({ name: 'studio' })
}

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
    <div class="relative flex h-full min-h-0 flex-col bg-page">
      <!-- 连续网络失败后暂停轮询的提示条（正常时不出现）；配色走 .sx-alert--danger（danger-soft 底 / #8f4b47 字） -->
      <div
        v-if="ctl.offline.value"
        role="alert"
        class="absolute left-1/2 top-0 z-10 flex -translate-x-1/2 items-center gap-12px rounded-b-lg border border-t-0 border-solid border-danger-line bg-danger-soft px-16px py-6px text-13px text-alert-danger shadow-toast"
      >
        <span>网络异常，已暂停轮询</span>
        <button
          type="button"
          class="h-32px box-border cursor-pointer rounded-sm border border-solid border-danger-line bg-white px-12px text-13px font-500 text-alert-danger hover:border-danger sx-focus"
          @click="ctl.retryPolling()"
        >
          重试
        </button>
      </div>

      <!-- 三栏（原型 ToolWorkspaceColumns ml 档实测：460 / 224 / 1fr，列间 16，四周 16；
           原型无整宽页头，功能名 / 切换 / 返回收进左列顶部的功能卡） -->
      <div class="grid min-h-0 flex-1 grid-cols-[460px_224px_minmax(0,1fr)] gap-16px p-16px">
        <!-- 左：一块白板（原型 .studio-split__operate.sx-card：1px line / r10 / 白底 / shadow-panel），
             板内三段：功能卡（外缘 12，不滚）→ 操作区（内边距 12、段距 12，板内唯一滚动区）→ 设置行 + 主按钮（0 12 12） -->
        <section
          class="flex min-h-0 flex-col overflow-hidden rounded-10px border border-solid border-line bg-white shadow-panel"
          aria-label="操作区"
        >
          <!-- 功能卡（原型 FunctionSwitcher ml：高 64、内边距 12 14、r10、#e9dff2 描边、白→#fbf7fe 渐变；
               缩略 56×40 r6 / 功能名 15·600·20 / 说明 11·16 / 箭头 14 贴右）；返回按钮按产品要求保留为左侧小按钮 -->
          <h1 v-if="title" class="sr-only">{{ title }}</h1>
          <NPopover
            raw
            trigger="manual"
            width="trigger"
            placement="bottom-start"
            :show="switchOpen"
            :show-arrow="false"
            :animated="false"
            @clickoutside="switchOpen = false"
          >
            <template #trigger>
              <div
                class="relative mx-12px mt-12px flex h-64px box-border flex-none items-center gap-8px rounded-10px border border-solid border-#e9dff2 bg-[linear-gradient(180deg,#ffffff_0%,#fbf7fe_100%)] pl-8px pr-14px py-12px shadow-[0_1px_2px_rgba(31,35,41,0.05)]"
              >
                <IconButton label="返回AI 商拍" variant="quiet" @click="back">
<svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M19 12H5M11 18l-6-6 6-6" />
                  </svg>
</IconButton>
                <button
                  type="button"
                  class="flex h-40px min-w-0 flex-1 cursor-pointer items-center gap-12px border-none bg-transparent p-0 text-left hover:opacity-82 sx-focus"
                  aria-haspopup="dialog"
                  :aria-expanded="switchOpen"
                  @click="switchOpen = !switchOpen"
                >
                  <!-- 缩略 56×40（原型 .fn-switch__thumb：r6、1px line、135° 淡紫渐变、顶部 1px 白内高光） -->
                  <span
                    class="grid h-40px w-56px flex-none place-items-center rounded-6px border border-solid border-line bg-[linear-gradient(135deg,#f6effa,#efe6f5)] text-violet shadow-[inset_0_1px_0_#fff]"
                  >
                    <svg
                      class="h-20px w-20px"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.6"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      aria-hidden="true"
                      :innerHTML="headIcon"
                    />
                  </span>
                  <span class="flex min-w-0 flex-col items-start justify-center gap-2px">
                    <span v-if="title" class="max-w-full truncate text-15px font-600 leading-20px text-ink">{{
                      title
                    }}</span>
                    <small
                      v-if="currentEntry"
                      class="max-w-full truncate text-11px font-400 leading-16px tracking-[0.01em] text-muted"
                      >{{ currentEntry.desc }}</small
                    >
                  </span>
                  <svg
                    class="ml-auto h-14px w-14px flex-none text-muted transition-transform duration-150 motion-reduce:transition-none"
                    :class="switchOpen ? 'rotate-180' : ''"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              </div>
            </template>
            <!-- 切换面板（原型 .fn-switch__pop：卡片正下方 8、与卡同宽、头 44 + 0.8px 刻线、r10）；
                 出现动效同原型 op-pop：淡入 + 4px 上移 120ms ease（关 naive 自带缩放动画，关键帧见文件底部） -->
            <div class="mt-8px animate-[stu-switch-in_120ms_ease_both] motion-reduce:animate-none">
              <div
                role="dialog"
                aria-label="切换功能"
                class="flex flex-col overflow-hidden rounded-10px border border-solid border-line bg-white shadow-[0_12px_24px_rgba(31,35,41,0.14),0_2px_6px_rgba(31,35,41,0.06)]"
                @keydown.esc="switchOpen = false"
              >
                <div
                  class="flex h-44px flex-none items-center justify-between pl-14px pr-8px shadow-[inset_0_-0.8px_0_#e5e7eb]"
                >
                  <span class="text-13px font-600 leading-20px text-muted">切换功能</span>
                  <IconButton label="关闭" variant="quiet" @click="switchOpen = false">
<svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    >
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
</IconButton>
                </div>
                <div class="grid grid-cols-3 gap-2px px-8px pb-16px pt-4px">
                  <button
                    v-for="entry in SWITCH_ENTRIES"
                    :key="entry.kind"
                    type="button"
                    class="flex h-32px min-w-0 cursor-pointer items-center gap-6px rounded-6px border border-solid px-6px text-left sx-focus"
                    :class="
                      entry.kind === kind
                        ? 'border-violet-line bg-[linear-gradient(#ffffff,#f3edf8)] text-violet-ink'
                        : 'border-transparent bg-transparent text-ink-2 hover:bg-surface3'
                    "
                    :aria-current="entry.kind === kind ? 'page' : undefined"
                    :title="entry.desc"
                    @click="onSwitch(entry.path)"
                  >
                    <span
                      class="grid h-22px w-22px flex-none place-items-center rounded-5px border border-solid border-line bg-[linear-gradient(135deg,#f6effa,#efe6f5)] text-violet shadow-[inset_0_1px_0_#fff]"
                    >
                      <svg
                        class="h-13px w-13px"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.7"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                        :innerHTML="iconOf(entry.kind)"
                      />
                    </span>
                    <span class="min-w-0 truncate text-13px font-500">{{ entry.name }}</span>
                  </button>
                </div>
              </div>
            </div>
          </NPopover>
          <!-- 操作区：子项 flex-col 段距 12；min-h-full 让页面的素材卡 flex-1 撑到设置行上沿（原型 .tool-op 内提示词框吃剩余高度） -->
          <div class="stu-scroll min-h-0 flex-1 overflow-y-auto">
            <div class="flex min-h-full flex-col gap-12px box-border p-12px">
              <slot name="operate" />
            </div>
          </div>
          <div class="flex-none px-12px pb-12px">
            <slot name="action" />
          </div>
        </section>

        <!-- 中：历史列表（原型 .v3-hist.sx-card：r10 = --sx-r-5，影 0 2 4 -1 .08 + 0 10 18 -10 .22 = shadow-panel） -->
        <section
          class="flex min-h-0 flex-col overflow-hidden rounded-10px border border-solid border-line bg-white shadow-panel"
          aria-label="历史记录"
        >
          <StudioHistoryColumn
            :history="ctl"
            :selected-id="selectedId"
            @select="selectedId = $event.batch.id"
            @reedit="(p, d) => emit('reedit', p, d)"
          />
        </section>

        <!-- 右：预览区 -->
        <section
          class="flex min-h-0 flex-col overflow-hidden rounded-10px border border-solid border-line bg-white shadow-panel"
          aria-label="生成结果"
        >
          <StudioPreviewPanel
            :history="ctl"
            :detail="detail"
            :pending="pending"
            :feature="introFeature"
            :intro="intro"
            :scenes="scenes"
            @reedit="(p, d) => emit('reedit', p, d)"
          >
            <template v-if="$slots.intro" #intro><slot name="intro" /></template>
          </StudioPreviewPanel>
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

<style>
/*
 * 只留 @keyframes：功能切换面板的出现动效（原型 .op-pop：opacity 0 + translateY(4px) → 1 / none，120ms ease）。
 * UnoCSS 的 animate-[…] 只引用名字，关键帧本身写不成原子类；不加 scoped（scoped 会给名字加哈希，原子类对不上），
 * 名字带 stu- 前缀避免撞名。
 */
@keyframes stu-switch-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
</style>
