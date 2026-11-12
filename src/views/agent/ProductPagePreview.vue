<script setup lang="ts">
/**
 * 「预览模板」→ 淘宝风商品预览（对齐原型 AgentView modal==='tpl'）：把选中的图嵌进商品详情页版式。
 * 纯前端示意：店铺 / 价格 / 规格都是占位，按钮不可用，不生成真实商品；信息区常驻「预览效果 · 价格与规格为示例」。
 *
 *   <ProductPagePreview v-model:show="tplShow" :images="tplImages" :title="本轮提示词" />
 *
 * 版式尺寸取自原型 .tpl-*：弹层 1040 宽、左 400 方形主图 + 58 缩略图条（点缩略图换主图）、右信息区。
 * 图片不随主题变，其余颜色走主题令牌。
 */
import { computed, ref, watch } from 'vue'
import { NModal } from 'naive-ui'

const props = defineProps<{
  /** 多选下载里选中的图；没有多选时传该卡全部结果图 */
  images: string[]
  /** 标题来源（本轮提示词）；可空 */
  title?: string
}>()
const show = defineModel<boolean>('show', { required: true })

const idx = ref(0)
const SPECS = ['米白', '焦糖', '墨黑', 'S', 'M', 'L']

const heading = computed(() => {
  const t = (props.title ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return '示例商品标题（请替换为你的商品名称）'
  return t.length > 30 ? `${t.slice(0, 30)}…` : t
})

watch(show, (on) => {
  if (on) idx.value = 0
})
watch(
  () => props.images.length,
  (n) => {
    if (idx.value >= n) idx.value = Math.max(0, n - 1)
  },
)

const MODAL_X =
  'relative ml-auto grid h-28px w-28px flex-none place-items-center rounded-full border-none bg-transparent p-0 text-placeholder cursor-pointer hover:(bg-surface3 text-ink) after:(content-empty absolute -inset-2px rounded-full) [@media(pointer:coarse)]:after:-inset-6px'
const SPEC = 'inline-flex h-26px items-center rounded-3px border border-solid px-9px text-11px'
</script>

<template>
  <n-modal v-model:show="show">
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tpl-preview-title"
      class="sx-squircle flex max-h-[min(720px,calc(100vh-48px))] w-1040px max-w-[calc(100vw-48px)] flex-col overflow-hidden rounded-18px border border-solid border-line bg-white shadow-pop"
    >
      <div class="relative flex h-52px flex-none items-center gap-8px border-b border-solid border-line pl-18px pr-10px">
        <strong id="tpl-preview-title" class="text-15px font-600 leading-20px text-ink">淘宝风商品预览</strong>
        <span class="text-12px leading-16px text-muted">把选中的图嵌入商品详情页模板</span>
        <button type="button" aria-label="关闭" :class="MODAL_X" @click="show = false">
          <svg class="h-16px w-16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-18px pb-14px pt-12px">
        <div v-if="!images.length" class="py-48px text-center text-13px leading-20px text-muted">没有可预览的图片</div>
        <div v-else class="flex flex-col gap-14px md:flex-row">
          <!-- 左：主图 + 缩略图条 -->
          <div class="w-full flex-none md:w-400px">
            <div class="aspect-square w-full overflow-hidden rounded-6px border border-solid border-line bg-surface3">
              <img :src="images[idx]" :alt="`主图 ${idx + 1} / ${images.length}`" class="block h-full w-full object-cover" />
            </div>
            <div v-if="images.length > 1" class="mt-6px flex gap-6px overflow-x-auto pb-2px">
              <button
                v-for="(src, i) in images"
                :key="`${src}:${i}`"
                type="button"
                :aria-label="`查看第 ${i + 1} 张`"
                :aria-current="i === idx"
                :class="[
                  'h-58px w-58px flex-none overflow-hidden rounded-4px border border-solid bg-surface3 p-0 cursor-pointer sx-focus',
                  i === idx ? 'border-violet outline outline-1 outline-violet' : 'border-line hover:border-control',
                ]"
                @click="idx = i"
              >
                <img :src="src" alt="" class="block h-full w-full object-cover" />
              </button>
            </div>
          </div>

          <!-- 右：信息区（占位） -->
          <div class="min-w-0 flex-1 rounded-6px border border-solid border-line p-14px">
            <span
              class="mb-6px inline-block rounded-4px border border-solid border-violet-line bg-violet-tint px-6px text-11px font-600 leading-18px text-violet-ink"
              >预览效果 · 价格与规格为示例</span
            >
            <div class="text-11px leading-16px text-muted">示例旗舰店 · 天猫 · 4.9</div>
            <h2 class="m-0 my-6px text-18px font-600 leading-26px text-ink">{{ heading }}</h2>
            <div class="flex items-baseline gap-8px rounded-5px bg-danger-soft p-10px">
              <b class="text-26px leading-32px text-alert-danger tabular-nums">¥ 259</b>
              <span class="text-11px leading-16px text-placeholder line-through tabular-nums">¥ 399</span>
              <span class="ml-auto text-11px leading-16px text-alert-danger">88VIP 好评率 99%</span>
            </div>
            <div class="mt-10px flex flex-wrap gap-5px" aria-label="规格示例">
              <span
                v-for="(s, i) in SPECS"
                :key="s"
                :class="[SPEC, i === 0 ? 'border-violet bg-violet-tint text-violet-ink' : 'border-line text-ink-2']"
                >{{ s }}</span
              >
            </div>
            <div class="mt-12px flex gap-6px">
              <button type="button" disabled aria-disabled="true" title="示意，不可操作" class="h-38px flex-1 cursor-not-allowed rounded-19px border border-solid border-warning-line bg-warning-soft text-13px font-600 text-warning">加入购物车</button>
              <button type="button" disabled aria-disabled="true" title="示意，不可操作" class="h-38px flex-1 cursor-not-allowed rounded-19px border-none bg-violet-solid text-13px font-600 text-on-accent opacity-80">领券购买</button>
            </div>
            <p class="m-0 mt-10px text-11px leading-17px text-placeholder">
              预计 14 小时内发货，支持极速退款与 7 天无理由退货。图片由智能体生成，版式已按商品详情页模板套好。以上店铺、价格、规格均为示例，不代表真实商品。
            </p>
          </div>
        </div>
      </div>
    </div>
  </n-modal>
</template>
