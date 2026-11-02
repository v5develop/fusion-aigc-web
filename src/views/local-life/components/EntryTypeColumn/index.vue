<script setup lang="ts">
/**
 * 全案设计 · 单个图种列（还原原型 LocalLifeTypeCard 的「未启用」态）。
 *
 * 全案生成还没有后端接口，图种列只做展示：整列 40% 灰、不可点、对读屏隐藏表单骨架，
 * 与原型未选档案时的样子一致。尺寸照原型：列头 52 高、列身 padding 12 14 14、最高 420 内滚，
 * 设计要求 73 高、素材框 120 高 2px 虚线、「添加」40 高 2px 虚线。
 */
defineProps<{
  title: string
  /** 原型 multiItem：推荐菜限 1 条，没有「添加」 */
  multiItem: boolean
  maxImages: number
  maxLength: number
}>()

const uploadIcon = ['M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4 4 0 0 1-.5 7.97', 'M12 12v8', 'M9 15l3-3 3 3']
</script>

<template>
  <article class="min-w-0 flex flex-col overflow-hidden border border-line rounded-10px bg-white">
    <header class="h-52px shrink-0 flex items-center justify-between gap-8px px-12px">
      <span class="truncate text-14px font-600 leading-20px text-ink">{{ title }}</span>
      <span class="h-20px w-20px shrink-0 border border-ink/20 rounded-full bg-white" aria-hidden="true" />
    </header>

    <div
      class="pointer-events-none max-h-420px min-h-0 flex flex-col select-none gap-12px overflow-y-auto px-14px pb-14px pt-12px opacity-40"
      aria-hidden="true"
    >
      <div class="flex flex-col gap-8px">
        <span class="text-12px font-500 leading-18px text-ink/58">{{ title }} 1</span>
        <div class="flex flex-col gap-6px">
          <span class="text-12px font-500 leading-18px text-ink/58">设计要求（选填）</span>
          <span
            class="relative box-border block h-73px border border-ink/8 rounded-8px bg-ink/4 px-12px pb-24px pt-8px text-13px leading-19.5px text-ink/30"
          >
            请输入该部分的设计要求...
            <em class="absolute bottom-4px right-10px text-10px text-ink/28 not-italic leading-14px">
              0/{{ maxLength }}
            </em>
          </span>
        </div>
        <div class="flex flex-col gap-6px">
          <span class="flex items-center gap-4px text-12px font-500 leading-18px text-ink/58">
            设计素材 <em class="text-danger not-italic">*</em>
            <span class="ml-auto text-11px text-ink/40">0/{{ maxImages }}</span>
          </span>
          <span
            class="h-120px flex flex-col items-center justify-center gap-4px border-2 border-ink/12 rounded-8px border-dashed bg-ink/2 text-ink/55"
          >
            <span class="h-32px w-32px flex items-center justify-center rounded-full bg-ink/6">
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path v-for="d in uploadIcon" :key="d" :d="d" />
              </svg>
            </span>
            <b class="text-12px font-500">点击从档案中选择图片</b>
            <small class="text-11px text-ink/40">最多 {{ maxImages }} 张</small>
          </span>
        </div>
      </div>

      <span
        v-if="multiItem"
        class="h-40px shrink-0 flex items-center justify-center gap-4px border-2 border-ink/12 rounded-8px border-dashed text-12px text-ink/55"
      >
        + 添加{{ title }}
      </span>
    </div>
  </article>
</template>
