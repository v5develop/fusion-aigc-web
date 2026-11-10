<script setup lang="ts">
/**
 * 全案设计 · 手机预览（原型 LocalLifePhone）。
 *
 * 结构照原型：状态栏 → 店铺导航 → 五连图横条 → 门店卡 → 入口图 → 套餐推荐 → 推荐菜。
 * 没有结果的位置画「待生成」占位（生成中显示「生成中」）；有结果按图种填进对应位置。
 * 门店卡只用档案里真有的数据（店名 / 行业 / 所在城市·区域 / 人均 / 特色标签 / 套餐名与价格 / 特色菜名）；
 * 推荐菜产物旁的菜名只用 closeupNames（父组件按提交时记下的组号 → 菜名配好；不知道就不传），不按下标硬配档案菜名；
 * 占位格（还没出图）才显示档案里的特色菜名作示意。
 * 评分、评价数、收藏、营业时间、距离档案里没有，一律中性占位（「—」），不编造。
 * 五连图产物是一张宽图（Java 8000×1200，五格各 4:3），按原型 1/5 裁进五格。
 * 整块是示意图，对读屏只暴露一个「手机预览」名称。内容区可滚动、隐藏滚动条。
 */
import { computed } from 'vue'
import type { BrandProfileView } from '@/api/localLifeFull.ts'
import type { KindResults } from '../../useFullSet.ts'

const props = withDefaults(
  defineProps<{
    profile?: BrandProfileView | null
    results?: KindResults
    running?: boolean
    /** 与 results.closeupImage 同序的菜名；映射不确定时不传 / 位为空，就不显示菜名 */
    closeupNames?: (string | undefined)[]
  }>(),
  {
    profile: null,
    results: () => ({}),
    running: false,
    closeupNames: () => [],
  },
)
const pending = computed(() => (props.running ? '生成中' : '待生成'))
/** 五连图：取第一张宽图，五格各显示它的 1/5 */
const fiveComposite = computed(() => props.results.fivePanel?.[0] ?? '')
const mealUrls = computed(() => {
  // 套餐推荐优先各取一张二连图 / 套餐图（原型口径），不足两张再补同类第二张
  const out: (string | undefined)[] = []
  if (props.results.twoPanel?.[0]) out.push(props.results.twoPanel[0])
  if (props.results.setMealImage?.[0]) out.push(props.results.setMealImage[0])
  if (out.length < 2 && props.results.twoPanel?.[1]) out.push(props.results.twoPanel[1])
  if (out.length < 2 && props.results.setMealImage?.[1]) out.push(props.results.setMealImage[1])
  while (out.length < 2) out.push(undefined)
  return out.slice(0, 2)
})
const shopName = computed(() => props.profile?.title || '')
const category = computed(() => props.profile?.category || '')
const address = computed(() => props.profile?.address || '')
const avgPrice = computed(() => {
  const raw = props.profile?.avgPrice?.trim()
  if (!raw) return '人均 —'
  return /^\d+(\.\d+)?$/.test(raw) ? `¥${raw}/人` : raw
})
const tags = computed(() => (props.profile?.tags ?? []).slice(0, 4))
const meals = computed(() => (props.profile?.meals ?? []).slice(0, 2))
const featureNames = computed(() => (props.profile?.featureNames ?? []).slice(0, 2))
const closeupUrls = computed(() => props.results.closeupImage ?? [])
/** 第 i 个推荐菜位的菜名：有产物只用已知映射；没产物（占位）显示档案菜名作示意 */
function closeupName(i: number): string {
  if (closeupUrls.value[i]) return props.closeupNames[i] ?? ''
  return featureNames.value[i] ?? ''
}
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
        <div class="h-36px shrink-0 flex items-center gap-6px bg-white px-12px text-ink">
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

        <div
          class="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-page [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <!-- 五连图：一张宽图按 1/5 裁进五格 -->
          <div class="flex gap-2px bg-white px-4px pt-4px">
            <div
              v-for="(label, i) in stripLabels"
              :key="label"
              class="relative aspect-[4/3] min-w-0 flex flex-1 flex-col items-center justify-center gap-2px overflow-hidden rounded-3px bg-sunken text-ink/30"
            >
              <img
                v-if="fiveComposite"
                :src="fiveComposite"
                alt=""
                class="absolute left-0 top-0 block h-full w-[500%] max-w-none object-cover"
                :style="{ transform: `translateX(-${i * 20}%)` }"
              />
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
              <span v-if="i === 0 && !fiveComposite" class="text-8px text-placeholder">五连图</span>
            </div>
          </div>

          <!-- 门店卡：只显示档案里真有的数据，其余中性占位 -->
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
              <span v-if="category" class="rounded-3px bg-surface3 px-5px py-2px text-8px">{{ category }}</span>
              <span class="ml-auto text-10px text-ink font-600">{{ avgPrice }}</span>
            </div>
            <p class="m-0 mt-7px flex items-center gap-3px text-9px text-ink-2">
              <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2">
                <path v-for="d in ICONS.time" :key="d" :d="d" />
              </svg>
              营业时间 —
            </p>
            <div v-if="tags.length" class="mt-6px flex flex-wrap gap-4px">
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
                <p :class="['m-0 mt-2px truncate text-8px', address ? 'text-ink-2' : 'text-placeholder']">
                  {{ address || '门店地址会显示在这里' }}
                </p>
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
              <span class="text-8px text-ink/45">{{ meals.length ? `${meals.length} 个套餐` : '套餐' }}</span>
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
                <p v-if="meals[i]" class="m-0 flex items-baseline gap-4px px-6px py-4px text-8px leading-[1.3]">
                  <span class="min-w-0 flex-1 truncate text-ink">{{ meals[i]!.name }}</span>
                  <b v-if="meals[i]!.price" class="shrink-0 text-danger font-600">{{ meals[i]!.price }}</b>
                </p>
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
              <p v-if="closeupName(n - 1)" class="m-0 min-w-0 flex-1 truncate pt-2px text-10px text-ink font-600">
                {{ closeupName(n - 1) }}
              </p>
            </div>
          </section>

          <p class="m-0 mb-16px mt-10px text-center text-8px text-ink/40">内容由 AI 生成，实际呈现以平台为准</p>
        </div>
      </div>
    </div>
    <p class="m-0 text-center sx-hint">预览仅供参考，实际呈现以平台为准</p>
  </div>
</template>
