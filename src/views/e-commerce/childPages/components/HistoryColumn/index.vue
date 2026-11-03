<script setup lang="ts">
/**
 * 电商功能页中栏：历史记录（原型 StudioHistoryColumn ml 版，规范 §5.10）。列宽 224，与左右两栏同材质（r8 白板）。
 *
 * <p>数据就是页面 provide 的 recordsData（本标签会话里的各批生成），这里只换展示：每批一张历史卡
 * （内边距 10、gap 10、1px line、r10；缩略 44 / r6，多张用 3/6px 偏移叠影 + 张数角标；第一行 12/18 两行截断，
 * 时间 11/16）。点一张卡 = 右栏结果切到这一批；有新批次出现时自动跟随最新一批。
 */
import { computed, inject, ref, unref, useId, watch, type Ref } from 'vue'
import CreationHistoryHeader from '@/components/creation/CreationHistoryHeader.vue'
import { withWatermark } from '@/utils/oss'
import { isVideoUrl } from '@/utils/utils'
import { EC_SELECTED_TASK_KEY, selectedGroupOf } from './selection'

const { title } = defineProps<{
  /** 功能名：历史卡第一行（电商批次没有单独的提示词可展示） */
  title: string
}>()

const recordsData = inject<Ref<any[] | undefined> | any[] | undefined>('recordsData')
const groups = computed<any[]>(() => unref(recordsData) ?? [])
const selectedId = inject(EC_SELECTED_TASK_KEY, ref<string | null>(null))
const groupMediaType = inject<'image' | 'video'>('recordMediaType', 'image')

const titleId = `ec-history-title-${useId()}`

const isRunning = (g: any) => (g.contents ?? []).some((c: any) => c.status === 0 || c.status === 1)
const isFailed = (g: any) => {
  const list = g.contents ?? []
  return list.length > 0 && list.every((c: any) => c.status === 3 || c.blocked)
}
const runningCount = computed(() => groups.value.filter(isRunning).length)
const current = computed(() => selectedGroupOf(groups.value, selectedId.value))

/** 缩略图：本批生成成功、未违规的产物（叠影张数也按它算） */
const stackOf = (g: any): string[] =>
  (g.contents ?? []).filter((c: any) => c.resultUrl && c.status === 2 && !c.blocked).map((c: any) => c.resultUrl)

/** 历史卡空间窄，时间取 MM-DD HH:mm（原型同款短格式），完整时间放读屏名 */
const shortTime = (t?: string) => {
  const m = String(t ?? '').match(/^\d{4}-(\d{2}-\d{2})[ T](\d{2}:\d{2})/)
  return m ? `${m[1]} ${m[2]}` : String(t ?? '')
}

const statusText = (g: any) => (isRunning(g) ? '生成中' : isFailed(g) ? '生成失败' : '')

// 新批次出现（刚提交 / 轮询拿到新任务）时回到「跟随最新一批」，否则用户看到的还是旧批次
let seen = new Set<string>()
watch(
  () => groups.value.map((g) => g.taskId as string),
  (ids) => {
    const fresh = ids.some((id) => !seen.has(id))
    if (fresh && seen.size) selectedId.value = null
    seen = new Set(ids)
  },
  { immediate: true },
)

/** 原型 ToolWorkspaceColumns 历史列 empty-hint 全文（与工具页同一句） */
const EMPTY_HINT = '左边传好素材、点底部按钮提交，每次生成都会在这一列留一条；点一条就能在右边看它的产物'
</script>

<template>
  <section
    class="flex flex-col min-h-0 bg-white rounded-lg border border-solid border-line shadow-panel overflow-hidden"
    :aria-labelledby="titleId"
  >
    <CreationHistoryHeader :title-id="titleId" :count="groups.length" :running="runningCount" />

    <!-- 空态：至少一张历史卡大小（高 65）：虚线浅底卡 + 28 圆底时钟（16），标题 13/600/18、说明 11/15 -->
    <div
      v-if="!groups.length"
      class="flex-none flex items-center gap-8px min-h-65px mx-12px p-10px box-border rounded-lg border border-dashed border-line-strong bg-gradient-to-b from-white to-surface2"
    >
      <span
        class="flex-none grid place-items-center w-28px h-28px box-border rounded-full border border-solid border-line bg-white text-violet-ink"
        aria-hidden="true"
      >
        <svg
          class="w-16px h-16px"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </svg>
      </span>
      <span class="min-w-0 flex-1 flex flex-col gap-1px">
        <b class="text-13px font-600 leading-18px text-ink-2">还没有生成记录</b>
        <span class="text-11px leading-15px text-muted">{{ EMPTY_HINT }}</span>
      </span>
    </div>

    <ul
      v-else
      class="flex-1 min-h-0 overflow-y-auto m-0 px-12px pt-2px pb-10px list-none flex flex-col gap-8px [scrollbar-width:thin]"
    >
      <li v-for="item in groups" :key="item.taskId">
        <button
          type="button"
          class="sx-hist-card sx-focus w-full items-center box-border text-left transition-[border-color,background,box-shadow] duration-fast ease-sx motion-reduce:transition-none"
          :class="current?.taskId === item.taskId ? 'sx-hist-card-on shadow-[0_1px_2px_rgba(31,35,41,0.05)]' : ''"
          :aria-pressed="current?.taskId === item.taskId"
          :aria-label="`${item.createTime ?? ''} ${statusText(item)} ${title}`"
          @click="selectedId = item.taskId"
        >
          <!-- 进行中：骨架（原型），状态写在第一行 -->
          <span
            v-if="isRunning(item) && !stackOf(item).length"
            class="flex-none w-44px h-44px rounded-md bg-sunken animate-pulse motion-reduce:animate-none"
            aria-hidden="true"
          />
          <!-- 缩略 44 / r6；多张用 3/6px 偏移叠影表示，张数角标高 16、10px -->
          <span
            v-else
            class="relative flex-none grid place-items-center w-44px h-44px box-border rounded-md border border-solid border-line bg-surface3 text-placeholder"
            :class="
              stackOf(item).length >= 3
                ? 'shadow-[3px_-3px_0_-1px_#fff,3px_-3px_0_0_#e5e7eb,6px_-6px_0_-1px_#fff,6px_-6px_0_0_#e5e7eb]'
                : stackOf(item).length === 2
                  ? 'shadow-[3px_-3px_0_-1px_#fff,3px_-3px_0_0_#e5e7eb]'
                  : ''
            "
            aria-hidden="true"
          >
            <img
              v-if="stackOf(item)[0] && !isVideoUrl(stackOf(item)[0])"
              :src="withWatermark(stackOf(item)[0])"
              alt=""
              class="block w-full h-full rounded-plate object-cover"
            />
            <span v-else class="text-11px">{{ groupMediaType === 'video' ? '视频' : '—' }}</span>
            <span
              v-if="stackOf(item).length > 1"
              class="absolute z-2 -top-4px -right-4px grid min-w-16px h-16px box-border place-items-center px-4px rounded-full border border-solid border-white bg-ink text-10px font-600 leading-none text-white"
              >{{ stackOf(item).length }}</span
            >
          </span>

          <span class="min-w-0 flex-1 flex flex-col justify-between gap-6px">
            <span
              class="line-clamp-2 text-12px leading-18px"
              :class="isFailed(item) ? 'text-danger' : isRunning(item) ? 'text-violet-ink' : 'text-ink'"
            >
              <template v-if="statusText(item)">{{ statusText(item) }} · </template>{{ title }}
            </span>
            <span class="text-11px leading-16px text-muted tabular-nums whitespace-nowrap">{{
              shortTime(item.createTime)
            }}</span>
          </span>
        </button>
      </li>
    </ul>
  </section>
</template>
