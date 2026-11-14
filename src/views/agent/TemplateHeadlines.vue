<script setup lang="ts">
/**
 * 智能体首页 · 本周头条（行业版，agent-template-industry DESIGN §7.1）：当前行业（及二级）的榜单，
 * 每条 = 名次 + 封面（类型角标）+ 标题 + 「头条 / 新上架」标签 + 一句推荐语 + 做同款人数与趋势 +「做同款」。
 * 数据 GET /api/v1/plaza/headlines（industry 必填，服务端按行业过滤）；点条目或按钮都是先开预览（与模板卡共用），
 * 在预览里点「做同款」才选中模板。kind = NEW 的补位条目只显示「新上架」，不显示热度与趋势。
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { isIndustryGate, plazaErrorText, plazaHeadlines } from './industry/plazaScope.ts'
import type { IPlazaHeadline, IPlazaHeadlineList } from '@/api/plaza.ts'
import PageEmpty from '@/components/PageEmpty/index.vue'
import PageLoadError from '@/components/PageLoadError/index.vue'
import FavButton from './FavButton.vue'
import { coverOf, formatCount, isVideoTemplate } from './templateMedia.ts'

const props = defineProps<{
  industry: string
  industryName: string
  sub: string
  keyword: string
  pickedId?: number | null
  disabled?: boolean
}>()
const emit = defineEmits<{
  open: [item: IPlazaHeadline]
  /** 榜单数据（计算时间、条目，给上层做「更新于」与预览的上一个 / 下一个） */
  loaded: [value: IPlazaHeadlineList | null]
  /** 行业不存在：回行业门 */
  gone: []
  /** 空态里「看图片 / 视频模板」 */
  switchTab: [tab: 'image' | 'video']
}>()

const items = ref<IPlazaHeadline[]>([])
const loading = ref(false)
const failed = ref(false)
const failMsg = ref('')
const searching = ref(false)
let seq = 0

async function load() {
  const s = ++seq
  loading.value = true
  failed.value = false
  failMsg.value = ''
  try {
    const res = await plazaHeadlines({
      industry: props.industry,
      subIndustry: props.sub || undefined,
      keyword: props.keyword,
    })
    if (s !== seq) return
    items.value = res.data?.items ?? []
    emit('loaded', res.data ?? null)
  } catch (err) {
    if (s !== seq) return
    if (isIndustryGate(err)) {
      emit('gone')
      return
    }
    failed.value = true
    failMsg.value = plazaErrorText(err, '')
    items.value = []
    emit('loaded', null)
  } finally {
    if (s === seq) loading.value = false
  }
}

// 行业 / 二级立即重拉；搜索词停顿 300ms 再查
let timer: ReturnType<typeof setTimeout> | undefined
watch(
  () => [props.industry, props.sub] as const,
  () => {
    clearTimeout(timer)
    void load()
  },
  { immediate: true },
)
watch(
  () => props.keyword.trim(),
  () => {
    clearTimeout(timer)
    searching.value = true
    timer = setTimeout(() => {
      searching.value = false
      void load()
    }, 300)
  },
)
onBeforeUnmount(() => clearTimeout(timer))

const rankText = (n: number) => String(n).padStart(2, '0')
const isNewKind = (h: IPlazaHeadline) => h.kind === 'NEW' || (h.kind == null && h.isNew)
/** 近 7 天做同款人数 / 趋势：NEW 补位不显示；`usageVisible=false`（次数不够展示）时服务端已置空，页面只留名次与「热」 */
const showUsage = (h: IPlazaHeadline) => !isNewKind(h) && h.usageVisible !== false
const tagLine = (h: IPlazaHeadline) =>
  (h.industries?.length ? h.industries.map((x) => x.name) : (h.tags ?? [])).slice(0, 2).join(' · ')

function trendText(h: IPlazaHeadline): string {
  if (h.trend == null) return '新上榜'
  if (h.trend > 0) return `↑ ${h.trend}%`
  if (h.trend < 0) return `↓ ${Math.abs(h.trend)}%`
  return '持平'
}
</script>

<template>
  <div>
    <div v-if="loading && !items.length" class="flex justify-center py-40px"><n-spin size="small" /></div>
    <PageLoadError
      v-else-if="failed"
      compact
      :subtitle="failMsg || '服务暂时有点忙，稍后再试'"
      retryable
      @retry="load"
    />
    <PageEmpty v-else-if="!items.length && keyword.trim()" compact :text="`没找到「${keyword.trim()}」相关的${industryName}模板`" description="只在这个行业里搜索，换个词试试" />
    <PageEmpty v-else-if="!items.length" compact :text="`${industryName}的头条马上就来`" description="先看看图片和视频模板">
      <div class="flex gap-8px">
        <button type="button" class="sx-btn" @click="emit('switchTab', 'image')">看图片模板</button>
        <button type="button" class="sx-btn" @click="emit('switchTab', 'video')">看视频模板</button>
      </div>
    </PageEmpty>
    <ol
      v-else
      class="m-0 flex list-none flex-col gap-12px p-0"
      :class="loading || searching ? 'opacity-60' : ''"
      aria-label="本周头条"
    >
      <li
        v-for="(h, i) in items"
        :key="h.headlineId ?? h.plazaTemplateId"
        :style="{ '--i': Math.min(i, 11) }"
        :class="[
          'fav-host tpl-in sx-squircle flex items-center gap-16px rounded-18px py-12px pl-12px pr-16px max-sm:(gap-10px py-10px pl-10px pr-10px)',
          'sx-soft [content-visibility:auto] [contain-intrinsic-size:auto_142px]',
          pickedId === h.plazaTemplateId
            ? '!border-#b48bc6 shadow-[0_0_0_1px_#b48bc6,0_6px_16px_rgba(31,35,41,0.08)]'
            : '',
        ]"
      >
        <div class="relative flex-none">
        <button
          type="button"
          class="relative block h-117px w-208px flex-none overflow-hidden rounded-12px border-0 bg-sunken p-0 cursor-pointer max-sm:(h-72px w-112px) focus-visible:(outline outline-2 outline-violet outline-offset-2)"
          :aria-label="`${h.title}，${isVideoTemplate(h) ? '视频' : '图片'}模板，点击查看`"
          :disabled="disabled"
          @click="emit('open', h)"
        >
          <img
            v-if="coverOf(h)"
            :src="coverOf(h)"
            alt=""
            loading="lazy"
            class="block h-full w-full object-cover"
            aria-hidden="true"
          />
          <span v-else class="grid h-full w-full place-items-center text-11px text-placeholder">暂无预览</span>
          <span
            class="absolute left-8px top-8px inline-flex h-20px items-center rounded-10px bg-white/88 px-8px text-10px font-500 text-violet-ink backdrop-blur-6px"
            aria-hidden="true"
          >
            {{ isVideoTemplate(h) ? '视频' : '图片' }}
          </span>
          <span
            v-if="isVideoTemplate(h)"
            class="absolute bottom-8px right-8px grid h-26px w-26px place-items-center rounded-full bg-black/55 text-white"
            aria-hidden="true"
          >
            <svg class="ml-1px h-10px w-10px" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </button>
        <!-- 收藏钮：与封面按钮同级（不嵌套），放封面右上（视频播放角标在右下） -->
        <FavButton :item="h" class="absolute right-8px top-8px z-2" />
        </div>

        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-8px">
            <span class="flex-none text-11px font-600 tabular-nums text-violet-ink/55">{{ rankText(h.rank ?? i + 1) }}</span>
            <b class="truncate text-14px font-600 leading-22px text-ink">{{ h.title }}</b>
            <span
              class="inline-flex h-18px flex-none items-center rounded-5px border border-solid border-violet-line bg-violet-tint px-6px text-10px font-600 text-violet-ink"
            >
              {{ isNewKind(h) ? '新上架' : '头条' }}
            </span>
            <span
              v-if="!isNewKind(h)"
              class="inline-flex h-18px flex-none items-center rounded-5px border border-solid border-danger-line bg-danger-soft px-6px text-10px font-600 text-danger max-sm:hidden"
              >热</span
            >
          </div>
          <p class="m-0 mt-4px truncate text-12px leading-19px text-muted" :title="h.why">{{ h.why }}</p>
          <div class="mt-7px flex min-w-0 flex-wrap items-center gap-8px text-11px text-placeholder">
            <span v-if="tagLine(h)">{{ tagLine(h) }}</span>
            <template v-if="showUsage(h)">
              <span v-if="tagLine(h)" class="h-3px w-3px rounded-full bg-line-strong" aria-hidden="true" />
              <span>近 7 天 {{ formatCount(h.uses) }} 人做过</span>
              <span
                class="font-600"
                :class="h.trend == null ? 'text-violet-ink' : h.trend > 0 ? 'text-success' : 'text-muted'"
              >
                {{ trendText(h) }}
              </span>
            </template>
          </div>
        </div>

        <button
          type="button"
          class="sx-soft-btn sx-soft-btn-primary flex-none"
          :disabled="disabled"
          :aria-label="`做同款：${h.title}`"
          @click="emit('open', h)"
        >
          做同款
        </button>
      </li>
    </ol>
  </div>
</template>

<style scoped>
/* 入场：420ms 上浮淡入，前 12 张错峰 35ms；reduced-motion 下直接显示（自写 keyframes 必须自己判断，UnoCSS 的 motion-reduce 管不到） */
.tpl-in {
  animation: tpl-in 420ms cubic-bezier(0.22, 0.8, 0.3, 1) both;
  animation-delay: calc(var(--i, 0) * 35ms);
}
@keyframes tpl-in {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .tpl-in {
    animation: none;
    opacity: 1;
    transform: none;
  }
}
</style>
