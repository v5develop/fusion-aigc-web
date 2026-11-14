<script setup lang="ts">
/**
 * 我的方案（EXPERIENCE §3.9.2 / §4.10）：保存过的改法（GET /saved-plans 分页，加载更多）。
 * 卡片：方案名、原片缩略图、标签、上次使用时间、使用次数；动作：「用它做一条」（主，POST /saved-plans/{id}/reuse）· 重命名 · 删除（确认弹窗）。
 * 原片已不在（sourceAvailable=false）→ 卡片标「原片已不在」，「用它做一条」回到上传，重新放原片后按这个方案出新方案。
 */
import { onMounted, ref } from 'vue'
import { useDialog } from 'naive-ui'
import {
  replicateDeleteSavedPlan,
  replicateErrorText,
  replicateListSavedPlans,
  replicateSavePlan,
  type ReplicateSavedPlan,
} from '@/api/replicate.ts'
import { toApiError } from '@/api/index.ts'
import PageEmpty from '@/components/PageEmpty/index.vue'
import PageLoadError from '@/components/PageLoadError/index.vue'
import { formatShortTime } from '@/utils/time.ts'
import type { useReplicate } from './useReplicate.ts'

const props = defineProps<{ rep: ReturnType<typeof useReplicate> }>()
const rep = props.rep
const dialog = useDialog()
const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'

const SIZE = 20
const items = ref<ReplicateSavedPlan[]>([])
const total = ref(0)
const limit = ref(50)
const page = ref(0)
const loading = ref(true)
const loadingMore = ref(false)
const failed = ref(false)
const errText = ref('')
/** 卡片上的就地提示（用它做 / 删除 / 改名失败） */
const cardError = ref<Record<number, string>>({})
const deleting = ref<number | null>(null)
const renaming = ref<number | null>(null)
const nameDraft = ref('')
const renameBusy = ref(false)

const netOr = (err: unknown, net: string, fallback: string) =>
  toApiError(err)?.isNetwork ? net : replicateErrorText(err, { fallback })

async function load(next = 1) {
  if (next === 1) loading.value = true
  else loadingMore.value = true
  failed.value = false
  try {
    const res = await replicateListSavedPlans({ page: next, size: SIZE })
    const d = res.data
    const rows = d?.items ?? []
    items.value = next === 1 ? rows : [...items.value, ...rows.filter((r) => !items.value.some((x) => x.id === r.id))]
    total.value = d?.total ?? items.value.length
    limit.value = d?.limit || 50
    page.value = next
  } catch (err) {
    failed.value = true
    errText.value = netOr(err, '加载失败，点这里重试', '加载失败，点这里重试')
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}
onMounted(() => load(1))

async function use(sp: ReplicateSavedPlan) {
  cardError.value = { ...cardError.value, [sp.id]: '' }
  const msg = await rep.reuseSaved(sp)
  if (msg) cardError.value = { ...cardError.value, [sp.id]: msg }
}

function askDelete(sp: ReplicateSavedPlan) {
  dialog.warning({
    title: `删除「${sp.name}」？`,
    content: '删除后不可恢复。用这个方案做过的视频不受影响',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: () => void doDelete(sp),
  })
}

async function doDelete(sp: ReplicateSavedPlan) {
  deleting.value = sp.id
  cardError.value = { ...cardError.value, [sp.id]: '' }
  try {
    await replicateDeleteSavedPlan(sp.id)
    items.value = items.value.filter((x) => x.id !== sp.id)
    total.value = Math.max(0, total.value - 1)
  } catch (err) {
    cardError.value = { ...cardError.value, [sp.id]: netOr(err, '网络不稳，没删掉，再试一次', '没删掉，再试一次') }
  } finally {
    deleting.value = null
  }
}

function startRename(sp: ReplicateSavedPlan) {
  renaming.value = sp.id
  nameDraft.value = sp.name
}

/** 改名 = 对同一张方案再保存一次（created=false，只更新名字） */
async function saveName(sp: ReplicateSavedPlan) {
  const n = nameDraft.value.trim().slice(0, 40)
  if (!n || n === sp.name) {
    renaming.value = null
    return
  }
  renameBusy.value = true
  try {
    const res = await replicateSavePlan(sp.planNo, { name: n })
    const name = res.data?.name ?? n
    items.value = items.value.map((x) => (x.id === sp.id ? { ...x, name } : x))
    renaming.value = null
  } catch (err) {
    cardError.value = { ...cardError.value, [sp.id]: netOr(err, '网络不稳，名字没改成，再试一次', '名字没改成，再试一次') }
  } finally {
    renameBusy.value = false
  }
}
</script>

<template>
  <section class="vr-panel">
    <div class="flex items-baseline gap-8px">
      <h3 class="vr-h3 !m-0">我的方案</h3>
      <span v-if="!loading && items.length" class="text-11px tabular-nums text-placeholder">{{ total }}/{{ limit }}</span>
    </div>
    <p class="vr-sub !mt-4px">保存过的改法，换一批图或一条新视频，点一下就能再做一条</p>

    <div v-if="loading" class="flex flex-col gap-8px" aria-busy="true">
      <span v-for="i in 3" :key="i" class="vr-pulse block h-76px rounded-12px bg-surface3" />
    </div>
    <PageLoadError v-else-if="failed && !items.length" compact retryable :subtitle="errText" @retry="load(1)" />
    <PageEmpty
      v-else-if="!items.length"
      compact
      text="还没有保存的方案"
      description="做好一条后点「保存为我的方案」，下次换商品只需 1 分钟"
    />
    <template v-else>
      <ul class="m-0 flex list-none flex-col gap-8px p-0">
        <li v-for="sp in items" :key="sp.id" class="rounded-12px border border-solid border-line bg-surface px-12px py-10px">
          <div class="flex items-center gap-12px max-sm:flex-wrap">
            <span class="relative block h-56px w-40px flex-none overflow-hidden rounded-6px bg-surface3">
              <img v-if="sp.sourceThumbUrl && sp.sourceAvailable" :src="sp.sourceThumbUrl" alt="" loading="lazy" class="h-full w-full object-cover" aria-hidden="true" />
            </span>
            <div class="min-w-0 flex-1">
              <form v-if="renaming === sp.id" class="flex items-center gap-6px" @submit.prevent="saveName(sp)">
                <input v-model="nameDraft" maxlength="40" aria-label="方案名" class="vr-input !h-30px min-w-0 flex-1 !text-12px" />
                <button type="submit" class="sx-soft-btn" :disabled="renameBusy">{{ renameBusy ? '保存中…' : '保存' }}</button>
                <button type="button" class="sx-soft-btn" @click="renaming = null">取消</button>
              </form>
              <b v-else class="block truncate text-13px font-600 text-ink">{{ sp.name }}</b>
              <div class="mt-4px flex flex-wrap items-center gap-4px">
                <span v-if="!sp.sourceAvailable" class="inline-flex h-18px items-center rounded-4px bg-surface3 px-6px text-10px text-warning">原片已不在</span>
                <span v-if="sp.sampleId" class="inline-flex h-18px items-center rounded-4px bg-surface3 px-6px text-10px text-muted">示例视频</span>
                <span v-for="l in sp.labels" :key="l" class="inline-flex h-18px items-center rounded-9px bg-violet-soft px-8px text-10px text-violet-ink">{{ l }}</span>
              </div>
              <small class="mt-2px block text-11px text-muted">
                {{ sp.lastUsedAt ? `上次使用 ${formatShortTime(sp.lastUsedAt)}` : `保存于 ${formatShortTime(sp.createdAt)}` }}{{ sp.useCount ? ` · 用过 ${sp.useCount} 次` : '' }}
              </small>
            </div>
            <div class="flex flex-none items-center gap-6px">
              <button type="button" class="sx-soft-btn" :class="FOCUS" :disabled="renaming === sp.id" @click="startRename(sp)">重命名</button>
              <button type="button" class="sx-soft-btn" :class="FOCUS" :disabled="deleting === sp.id" @click="askDelete(sp)">{{ deleting === sp.id ? '删除中…' : '删除' }}</button>
              <button type="button" class="sx-btn-primary" :disabled="rep.reuseBusy.value != null || rep.notReady.value" @click="use(sp)">
                {{ rep.reuseBusy.value === sp.id ? '正在打开…' : '用它做一条' }}
              </button>
            </div>
          </div>
          <p v-if="!sp.sourceAvailable" class="m-0 mt-6px text-11px leading-16px text-placeholder">这个方案的原片已经不在了。需要重新上传原片（方案设置会保留）</p>
          <p v-if="cardError[sp.id]" class="m-0 mt-6px text-12px text-danger" role="alert">{{ cardError[sp.id] }}</p>
        </li>
      </ul>
      <div v-if="items.length < total" class="mt-10px flex justify-center">
        <button type="button" class="sx-btn" :disabled="loadingMore" @click="load(page + 1)">{{ loadingMore ? '加载中…' : '加载更多' }}</button>
      </div>
      <p v-if="failed" class="m-0 mt-8px text-12px text-warning" role="status">{{ errText }}</p>
    </template>
  </section>
</template>
