<script setup lang="ts">
/** 历史：做过的任务（GET /jobs 分页，创建倒序）；点一条回到它的进度 / 结果（GET /jobs/{id}）。 */
import { onMounted, ref } from 'vue'
import {
  REPLICATE_OFF_TEXT,
  replicateErrorText,
  replicateListJobs,
  replicateNotReady,
  type ReplicateJobSummary,
} from '@/api/replicate.ts'
import PageEmpty from '@/components/PageEmpty/index.vue'
import PageLoadError from '@/components/PageLoadError/index.vue'
import { formatShortTime } from '@/utils/time.ts'
import { fmtPts } from './constants.ts'

const emit = defineEmits<{ open: [id: number] }>()

const SIZE = 20
const items = ref<ReplicateJobSummary[]>([])
const total = ref(0)
const page = ref(0)
const loading = ref(true)
const loadingMore = ref(false)
const failed = ref(false)
const errText = ref('')
/** 功能没开（读接口 7003）：不算加载失败、不给重试，只说暂未开放 */
const off = ref(false)

async function load(next = 1) {
  if (next === 1) loading.value = true
  else loadingMore.value = true
  failed.value = false
  off.value = false
  try {
    const res = await replicateListJobs({ page: next, size: SIZE })
    const d = res.data
    const rows = d?.items ?? []
    items.value =
      next === 1 ? rows : [...items.value, ...rows.filter((r) => !items.value.some((x) => x.jobId === r.jobId))]
    total.value = d?.total ?? items.value.length
    page.value = next
  } catch (err) {
    if (next === 1 && replicateNotReady(err)) {
      off.value = true
      return
    }
    failed.value = true
    errText.value = replicateErrorText(err)
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}
onMounted(() => load(1))
</script>

<template>
  <section class="vr-panel">
    <h3 class="vr-h3">历史</h3>
    <p class="vr-sub">生成中的任务不能删除</p>
    <div v-if="loading" class="flex justify-center py-32px"><n-spin size="small" /></div>
    <PageEmpty v-else-if="off" compact :text="REPLICATE_OFF_TEXT" />
    <PageLoadError v-else-if="failed && !items.length" compact retryable :subtitle="errText" @retry="load(1)" />
    <PageEmpty v-else-if="!items.length" compact text="还没有做过视频做同款" description="做完第一条，这里就会出现" />
    <template v-else>
      <ul class="m-0 flex list-none flex-col gap-8px p-0">
        <li v-for="j in items" :key="j.jobId">
          <button
            type="button"
            class="flex w-full items-center gap-12px rounded-12px border border-solid border-line bg-surface px-12px py-10px text-left cursor-pointer hover:border-violet-line focus-visible:(outline outline-2 outline-violet outline-offset-2)"
            @click="emit('open', j.jobId)"
          >
            <span class="relative block h-56px w-40px flex-none overflow-hidden rounded-6px bg-surface3">
              <img
                v-if="j.coverUrl || j.sourceThumbUrl"
                :src="j.coverUrl || j.sourceThumbUrl"
                alt=""
                loading="lazy"
                class="h-full w-full object-cover"
                aria-hidden="true"
              />
              <span
                v-if="j.coverUrl"
                class="absolute bottom-2px right-2px rounded-3px bg-black/55 px-3px text-9px text-white"
                >AI 生成</span
              >
            </span>
            <span class="min-w-0 flex-1">
              <b class="block truncate text-13px font-600 text-ink">{{ j.title }}</b>
              <small class="text-11px text-muted"
                >{{ formatShortTime(j.createdAt) }} · {{ j.statusLabel }} · {{ j.segDone }}/{{ j.segTotal }} 段</small
              >
            </span>
            <span class="flex-none text-12px tabular-nums text-ink-2">{{ fmtPts(j.points) }} 点</span>
          </button>
        </li>
      </ul>
      <div v-if="items.length < total" class="mt-10px flex justify-center">
        <button type="button" class="sx-btn" :disabled="loadingMore" @click="load(page + 1)">
          {{ loadingMore ? '加载中…' : '加载更多' }}
        </button>
      </div>
      <p v-if="failed" class="m-0 mt-8px text-12px text-warning" role="status">{{ errText }}</p>
    </template>
  </section>
</template>
