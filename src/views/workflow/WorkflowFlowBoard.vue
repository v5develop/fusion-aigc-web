<script setup lang="ts">
/**
 * 工作流操作区（原型 components/WorkflowFlowBoard.vue:71-164）：上面图、下面文本框，两张竖排的卡。
 *   ① 素材：按模板需要的输入逐项往下排（0–4 项，各带名字与上限标签），每项一个插槽 #input-{index}；
 *   ② 这一步做什么 + 模板选项：插槽 #tool。
 * 卡片内边距 10、圆角 8（产品定），素材占位最小高 132；纯展示，不碰上传 / 校验 / 提交。
 */
export interface WorkflowFlowInput {
  label: string
  kind: 'image' | 'video'
  max: number
  /** 带逐张备注（SKU替换「特殊需求」）：上限标签要说明这一点 */
  withNote?: boolean
}

defineProps<{
  inputs: WorkflowFlowInput[]
  actionLabel: string
  actionHint: string
  templateLabel: string
}>()

const card =
  'min-w-0 box-border p-10px rounded-8px border border-solid border-line bg-white ' +
  'shadow-[inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)]'
const head = 'flex items-baseline gap-8px mb-10px'
const title = 'm-0 text-13px font-600 leading-18px text-ink'
const meta = 'text-11px leading-16px text-placeholder'
</script>

<template>
  <div class="flex min-w-0 flex-col gap-12px">
    <!-- ① 素材：上面图 -->
    <section v-if="inputs.length" :class="card" aria-labelledby="wf-board-inputs">
      <header :class="head">
        <h2 id="wf-board-inputs" :class="title">素材</h2>
        <span :class="meta">模板需要 {{ inputs.length }} 项</span>
      </header>
      <div
        v-for="(input, index) in inputs"
        :key="`${input.label}-${index}`"
        :class="index ? 'mt-12px pt-12px border-0 border-t border-solid border-line-soft' : ''"
      >
        <div class="flex items-center gap-6px mb-8px">
          <b class="text-12px font-600 leading-18px text-ink-2">{{ input.label }}</b>
          <span
            v-if="input.kind === 'video'"
            class="ml-auto px-5px rounded-3px border border-solid border-warning-line bg-warning-soft text-11px leading-16px text-warning"
            >视频</span
          >
          <span
            v-else-if="input.max > 1"
            class="ml-auto px-5px rounded-3px border border-solid border-violet-line bg-violet-soft text-11px leading-16px text-violet-ink"
          >
            最多 {{ input.max }} 张{{ input.withNote ? '，可逐张填特殊需求' : '' }}
          </span>
        </div>
        <div class="min-h-132px min-w-0">
          <slot :name="`input-${index}`" />
        </div>
      </div>
    </section>

    <!-- ② 这一步 + 模板选项：下面文本框 -->
    <section :class="card" aria-labelledby="wf-board-tool">
      <header :class="head">
        <h2 id="wf-board-tool" :class="title">{{ actionLabel }}</h2>
        <span :class="meta">{{ templateLabel }}</span>
      </header>
      <p class="-mt-4px mb-10px mx-0 text-11px leading-16px text-muted">{{ actionHint }}</p>
      <slot name="tool" />
    </section>
  </div>
</template>
