<script setup lang="ts">
/**
 * 智能体首页 · 本周头条（原型 5185 AgentView .news-list / .news）：运营每周从广场模板里挑的爆款样本，
 * 每条 = 名次 + 封面（左上角类型角标）+ 标题 +「本周头条」标签 + 一句推荐语 +「行业 · 细分 · 本周 N 次复刻 · ↑ 趋势」+「复刻这一版」。
 *
 * <p>数据 GET /api/v1/plaza-headlines（tag / keyword 与模板页同口径，服务端过滤、按近 7 天复刻次数排序）。
 * 「复刻这一版」= 选中这条模板，与点模板卡片同一条 pick 路径（切技能 + 模板 chip，发送时带 plazaTemplateId）。
 * 趋势：前 7 天没人用过时没有可比基数，显示「新上榜」而不是百分比。
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { plazaHeadlineList } from '@/api/plaza.ts'
import type { IPlazaHeadline, IPlazaHeadlineList, IPlazaTemplate } from '@/api/plaza.ts'
import PageEmpty from '@/components/PageEmpty/index.vue'
import PageLoadError from '@/components/PageLoadError/index.vue'

const props = defineProps<{ tag: string; keyword: string; pickedId?: number | null; disabled?: boolean }>()
const emit = defineEmits<{
  pick: [item: IPlazaTemplate]
  period: [value: Pick<IPlazaHeadlineList, 'statsFrom' | 'statsTo'> | null]
}>()

const VIDEO_RE = /\.(mp4|webm|mov|m4v)(\?|#|$)/i

const items = ref<IPlazaHeadline[]>([])
const loading = ref(false)
const failed = ref(false)
const failMsg = ref('')
let seq = 0

async function load() {
  const s = ++seq
  loading.value = true
  failed.value = false
  failMsg.value = ''
  try {
    const res = await plazaHeadlineList({ tag: props.tag || undefined, keyword: props.keyword.trim() || undefined })
    if (s !== seq) return
    items.value = res.data?.items ?? []
    emit('period', res.data ? { statsFrom: res.data.statsFrom, statsTo: res.data.statsTo } : null)
  } catch (err) {
    if (s !== seq) return
    failed.value = true
    failMsg.value = err instanceof Error ? err.message : ''
    items.value = []
  } finally {
    if (s === seq) loading.value = false
  }
}

// 分类立即生效；搜索词停顿 300ms 再查，免得每敲一个字发一次
let timer: ReturnType<typeof setTimeout> | undefined
watch(
  () => props.tag,
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
    timer = setTimeout(() => void load(), 300)
  },
)
onBeforeUnmount(() => clearTimeout(timer))

function coverOf(h: IPlazaHeadline): string {
  return h.payload?.result?.[0] ?? h.payload?.image_urls?.[0] ?? ''
}
const isVideo = (url: string) => VIDEO_RE.test(url)
/** 行业 · 细分：与模板卡同一口径，取前两个标签 */
const tagLine = (h: IPlazaHeadline) => (h.tags ?? []).slice(0, 2).join(' · ')
const rankText = (n: number) => String(n).padStart(2, '0')

function trendText(h: IPlazaHeadline): string {
  if (h.trend == null) return '新上榜'
  if (h.trend > 0) return `↑ ${h.trend}%`
  if (h.trend < 0) return `↓ ${Math.abs(h.trend)}%`
  return '持平'
}

function pick(h: IPlazaHeadline) {
  if (props.disabled) return
  const template: IPlazaTemplate = {
    plazaTemplateId: h.plazaTemplateId,
    title: h.title,
    agentSkillId: h.agentSkillId,
    tags: h.tags,
    payload: h.payload,
  }
  emit('pick', template)
}
</script>

<template>
  <div>
    <div v-if="loading && !items.length" class="flex justify-center py-40px"><n-spin size="small" /></div>
    <PageLoadError v-else-if="failed" compact :subtitle="failMsg || '本周头条加载失败，请稍后重试'" retryable @retry="load" />
    <PageEmpty v-else-if="!items.length" compact text="没有匹配的模板，换个分类或词试试" />
    <ol
      v-else
      class="m-0 flex list-none flex-col gap-12px p-0"
      :class="loading ? 'opacity-60' : ''"
      aria-label="本周头条"
    >
      <li
        v-for="h in items"
        :key="h.headlineId"
        :class="[
          'sx-squircle flex items-center gap-16px rounded-18px py-12px pl-12px pr-16px',
          'sx-soft [content-visibility:auto] [contain-intrinsic-size:auto_142px]',
          pickedId === h.plazaTemplateId
            ? '!border-#b48bc6 shadow-[0_0_0_1px_#b48bc6,0_6px_16px_rgba(31,35,41,0.08)]'
            : '',
        ]"
      >
        <div class="relative h-117px w-208px flex-none overflow-hidden rounded-12px bg-#eef1f3 max-sm:(h-81px w-144px)">
          <video
            v-if="coverOf(h) && isVideo(coverOf(h))"
            :src="coverOf(h)"
            muted
            playsinline
            preload="metadata"
            class="block h-full w-full object-cover"
            aria-hidden="true"
          />
          <img
            v-else-if="coverOf(h)"
            :src="coverOf(h)"
            :alt="h.title"
            loading="lazy"
            class="block h-full w-full object-cover"
          />
          <span v-else class="grid h-full w-full place-items-center text-11px text-placeholder">暂无效果图</span>
          <span
            class="absolute left-8px top-8px inline-flex h-20px items-center rounded-10px bg-white/88 px-8px text-10px font-500 text-violet-ink backdrop-blur-6px"
          >
            {{ isVideo(coverOf(h)) ? '视频' : '图片' }}
          </span>
        </div>

        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-8px">
            <span class="flex-none text-11px font-600 tabular-nums text-#c2b4cd">{{ rankText(h.rank) }}</span>
            <b class="truncate text-14px font-600 leading-22px text-ink">{{ h.title }}</b>
            <span
              class="inline-flex h-18px flex-none items-center rounded-5px border border-solid border-#dcc9e9 bg-#faf4fd px-6px text-10px font-600 text-violet-ink"
            >
              本周头条
            </span>
          </div>
          <p class="m-0 mt-4px truncate text-12px leading-19px text-muted" :title="h.why">{{ h.why }}</p>
          <div class="mt-7px flex min-w-0 flex-wrap items-center gap-8px text-11px text-placeholder">
            <span v-if="tagLine(h)">{{ tagLine(h) }}</span>
            <span v-if="tagLine(h)" class="h-3px w-3px rounded-full bg-#d2d6da" aria-hidden="true" />
            <span>本周 {{ h.uses }} 次复刻</span>
            <span
              class="font-600"
              :class="h.trend == null ? 'text-violet-ink' : h.trend > 0 ? 'text-#3f7a56' : 'text-muted'"
            >
              {{ trendText(h) }}
            </span>
          </div>
        </div>

        <div class="flex flex-none items-center gap-8px">
          <button
            type="button"
            class="sx-soft-btn"
            :disabled="disabled"
            :aria-pressed="pickedId === h.plazaTemplateId"
            :aria-label="`复刻这一版：${h.title}`"
            @click="pick(h)"
          >
            复刻这一版
          </button>
        </div>
      </li>
    </ol>
  </div>
</template>
