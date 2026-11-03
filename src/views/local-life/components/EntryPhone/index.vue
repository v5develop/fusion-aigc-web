<script setup lang="ts">
/**
 * 全案设计 · 手机预览（原型 LocalLifePhone）。
 *
 * 结构照原型：状态栏 → 店铺导航 → 五连图横条 → 门店卡 → 入口图 → 套餐推荐 → 推荐菜。
 * 没有结果的位置画「待生成」占位（生成中显示「生成中」）；有结果按图种填进对应位置。
 * 原型同样不在空态里编造套餐名和价格。整块是示意图，对读屏只暴露一个「手机预览」名称。
 */
import { computed } from 'vue'
import type { KindResults } from '../../useFullSet.ts'

const props = withDefaults(defineProps<{ shopName?: string; results?: KindResults; running?: boolean }>(), {
  shopName: '',
  results: () => ({}),
  running: false,
})
const pending = computed(() => (props.running ? '生成中' : '待生成'))
const fiveUrls = computed(() => props.results.fivePanel ?? [])
const mealUrls = computed(() => [props.results.twoPanel?.[0], props.results.setMealImage?.[0]])
const closeupUrls = computed(() => props.results.closeupImage ?? [])
const ariaLabel = computed(() => {
  const done = Object.values(props.results).some((v) => v?.length)
  return `手机预览：大众点评门店页，${done ? '已生成' : pending.value}`
})
const ICONS = {
  image: ['M4 5h16v14H4z', 'M9 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'M20 15l-5-5-9 9'],
  back: ['M15 5l-7 7 7 7'],
  share: [
    'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M8.6 13.5l6.8 4',
    'M15.4 6.5l-6.8 4',
  ],
  time: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  location: ['M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z', 'M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  call: ['M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z'],
  navigate: ['M21 3L3 10.5l7.5 3 3 7.5z'],
} satisfies Record<string, string[]>

const stripLabels = ['门头', '环境', '招牌菜', '套餐', '活动']
const tags = ['门店环境', '招牌菜', '到店优惠']
const mealLabels = ['套餐二连图', '套餐图']
</script>

<template>
  <div class="min-w-0 flex flex-col items-center gap-8px" role="img" :aria-label="ariaLabel">
    <div
      class="aspect-[440/956] w-[min(100%,360px)] box-border rounded-30px border border-solid border-violet-border/40 bg-ink p-6px shadow-preview"
      aria-hidden="true"
    >
      <div
        class="h-full flex flex-col overflow-hidden rounded-24px bg-page shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
      >
        <!-- 状态栏 -->
        <div class="h-26px shrink-0 flex items-center justify-between bg-white px-16px text-10px text-ink font-600">
          <span class="font-mono">9:41</span>
          <span class="flex items-center gap-4px">
            <i class="h-6px w-12px rounded-1px bg-ink" />
            <i class="h-7px w-16px border border-ink rounded-2px bg-ink" />
          </span>
        </div>

        <!-- 导航 -->
        <div class="h-38px shrink-0 flex items-center gap-6px bg-white px-12px text-ink">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path v-for="d in ICONS.back" :key="d" :d="d" />
          </svg>
          <strong class="text-13px font-600">店铺</strong>
          <svg
            class="ml-auto text-muted"
            viewBox="0 0 24 24"
            width="17"
            height="17"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
          >
            <path v-for="d in ICONS.share" :key="d" :d="d" />
          </svg>
        </div>

        <div class="min-h-0 flex-1 overflow-hidden bg-page">
          <!-- 五连图 -->
          <div class="flex gap-2px bg-white px-4px pt-4px">
            <div
              v-for="(label, i) in stripLabels"
              :key="label"
              class="aspect-[4/3] flex flex-1 flex-col items-center justify-center gap-2px overflow-hidden rounded-3px bg-sunken text-ink/30"
            >
              <img v-if="fiveUrls[i]" :src="fiveUrls[i]" alt="" class="h-full w-full object-cover" />
              <svg
                v-else
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
              >
                <path v-for="d in ICONS.image" :key="d" :d="d" />
              </svg>
              <span v-if="i === 0 && !fiveUrls[i]" class="text-8px text-placeholder">五连图</span>
            </div>
          </div>

          <!-- 门店卡 -->
          <div class="relative -mt-10px rounded-t-14px bg-white px-12px pb-10px pt-12px">
            <h3 class="m-0 text-15px text-ink font-600 leading-[1.35]">{{ shopName || '选择品牌档案后预览' }}</h3>
            <div class="mt-6px flex flex-wrap items-center gap-6px text-9px text-muted leading-none">
              <span class="inline-flex items-center gap-3px rounded-4px bg-violet-soft px-8px py-2px text-violet-ink">
                <svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor">
                  <path d="M12 2l3 6.5 7 .8-5.2 4.8 1.4 7L12 17.6 5.8 21l1.4-7L2 9.3l7-.8z" />
                </svg>
                <b class="text-10px font-mono">—</b>
                <span class="text-8px">暂无评价</span>
              </span>
              <span>0 人收藏</span>
              <span class="rounded-3px bg-surface3 px-5px py-2px text-8px">门店</span>
              <span class="ml-auto text-10px text-ink font-600">人均待定</span>
            </div>
            <p class="m-0 mt-7px flex items-center gap-3px text-9px text-ink-2">
              <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2">
                <path v-for="d in ICONS.time" :key="d" :d="d" />
              </svg>
              今日营业中
            </p>
            <div class="mt-6px flex flex-wrap gap-4px">
              <span v-for="tag in tags" :key="tag" class="rounded-3px bg-surface3 px-5px py-2px text-8px text-muted">
                {{ tag }}
              </span>
            </div>
            <div class="mt-8px flex items-center gap-6px border-t border-line-soft pt-8px">
              <div class="min-w-0 flex-1">
                <p class="m-0 flex items-center gap-3px text-9px text-muted">
                  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2">
                    <path v-for="d in ICONS.location" :key="d" :d="d" />
                  </svg>
                  距你 —
                </p>
                <p class="m-0 mt-2px truncate text-8px text-placeholder">门店地址会显示在这里</p>
              </div>
              <span
                v-for="icon in [ICONS.call, ICONS.navigate]"
                :key="icon[0]"
                class="h-26px w-26px shrink-0 flex items-center justify-center rounded-full bg-surface3 text-ink-2"
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8">
                  <path v-for="d in icon" :key="d" :d="d" />
                </svg>
              </span>
            </div>
          </div>

          <!-- 入口图 -->
          <div class="mx-8px mt-7px overflow-hidden rounded-8px bg-white">
            <img v-if="results.entryImage?.[0]" :src="results.entryImage[0]" alt="" class="block w-full" />
            <div
              v-else
              class="min-h-54px flex items-center justify-center gap-5px border border-line-strong rounded-8px border-dashed text-9px text-ink/40"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6">
                <path v-for="d in ICONS.image" :key="d" :d="d" />
              </svg>
              入口图 · {{ pending }}
            </div>
          </div>

          <!-- 套餐推荐 -->
          <section class="mx-8px mt-7px rounded-10px bg-white p-10px">
            <header class="mb-7px flex items-baseline justify-between">
              <strong class="text-12px text-ink font-600">套餐推荐</strong>
              <span class="text-8px text-ink/45">2 个套餐</span>
            </header>
            <div class="grid grid-cols-2 gap-6px">
              <div
                v-for="(label, i) in mealLabels"
                :key="label"
                class="overflow-hidden border border-line-soft rounded-8px"
              >
                <img v-if="mealUrls[i]" :src="mealUrls[i]" alt="" class="aspect-[4/3] block w-full object-cover" />
                <div
                  v-else
                  class="aspect-[4/3] w-full flex flex-col items-center justify-center gap-2px bg-surface3 text-ink/25"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6">
                    <path v-for="d in ICONS.image" :key="d" :d="d" />
                  </svg>
                  <em class="text-7px text-ink/40 not-italic leading-[1.2]">{{ label }} · {{ pending }}</em>
                </div>
              </div>
            </div>
          </section>

          <!-- 推荐菜 -->
          <section class="mx-8px mt-7px rounded-10px bg-white p-10px">
            <header class="mb-7px flex items-baseline justify-between">
              <strong class="text-12px text-ink font-600">推荐菜</strong>
              <span class="text-8px text-ink/45">招牌 / 必点</span>
            </header>
            <div
              v-for="n in 2"
              :key="n"
              :class="['flex gap-8px py-7px', n === 1 ? 'pt-0' : 'border-t border-line-soft']"
            >
              <img
                v-if="closeupUrls[n - 1]"
                :src="closeupUrls[n - 1]"
                alt=""
                class="h-58px w-58px rounded-6px object-cover"
              />
              <div
                v-else
                class="h-58px w-58px flex flex-col items-center justify-center gap-2px rounded-6px bg-surface3 text-ink/25"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6">
                  <path v-for="d in ICONS.image" :key="d" :d="d" />
                </svg>
                <em class="text-7px text-ink/40 not-italic leading-[1.2]">推荐菜 · {{ pending }}</em>
              </div>
            </div>
          </section>

          <p class="m-0 mb-16px mt-10px text-center text-8px text-ink/40">内容由 AI 生成，实际呈现以平台为准</p>
        </div>
      </div>
    </div>
    <p class="m-0 text-center sx-hint">预览仅供参考，实际呈现以平台为准</p>
  </div>
</template>
