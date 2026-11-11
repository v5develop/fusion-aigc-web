<script setup lang="ts">
/**
 * 资产库多选「应用校色」（2026-11-11）：把剪贴板里的校色参数（任一图片校色面板「⋯ → 复制校色参数」）套到已选的图片上，
 * 每张存为新版本（原版本保留）。流程与判重见 components/ColorFix/batch.ts。
 *
 * <ul>
 *   <li>开始前：逐层列出预设——整图 / 自动识别层能带走（自动识别每张图重新识别），涂抹 / 点选层带不走（标出原因），
 *       已选里的视频跳过；</li>
 *   <li>进行中：进度条 + 逐张状态，并发 2，「取消」不再开始新的、在途识别立即放弃、已上传未存版本的不存；</li>
 *   <li>结束后：成功 / 已有相同版本 / 失败计数，失败逐张列原因，「重试失败项」只重跑失败 / 取消的（已存的不会再存）。</li>
 * </ul>
 */
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { NButton, NModal } from 'naive-ui'
import PageEmpty from '@/components/PageEmpty/index.vue'
import {
  colorFixClipboard,
  presetHasEffect,
  presetLayersForApply,
  presetRows,
  runColorFixBatch,
  type ColorFixBatchItem,
  type ColorFixBatchStatus,
} from '@/components/ColorFix'
import { ossResize } from '@/utils/oss.ts'
import type { IAssetLibAsset } from '@/api/asset-library.ts'

const props = defineProps<{ assets: IAssetLibAsset[] }>()
const show = defineModel<boolean>('show', { required: true })
const emit = defineEmits<{ changed: [] }>()

const items = reactive<ColorFixBatchItem[]>([])
const running = ref(false)
const started = ref(false)
let abort: AbortController | null = null
let savedAny = false

const preset = computed(() => colorFixClipboard.value)
const rows = computed(() => (preset.value ? presetRows(preset.value) : []))
const applyLayers = computed(() => (preset.value ? presetLayersForApply(preset.value) : []))
const hasEffect = computed(() => presetHasEffect(preset.value))
const skippedLayers = computed(() => rows.value.filter((r) => !r.transferable).length)
const videoCount = computed(() => props.assets.filter((a) => a.media !== 'image').length)
const imageCount = computed(() => props.assets.length - videoCount.value)
const copiedAt = computed(() => {
  const t = preset.value?.at
  if (!t) return ''
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
})

watch(show, (v) => {
  if (!v) return
  // 每次打开按当前已选重建（已经跑完的那批不保留）
  if (!running.value) {
    items.splice(
      0,
      items.length,
      ...props.assets.map((a) => ({
        asset: { id: a.id, title: a.title, image: a.image, media: a.media },
        status: 'queued' as ColorFixBatchStatus,
        message: '',
      })),
    )
    started.value = false
    savedAny = false
  }
}, { immediate: true })

const count = (s: ColorFixBatchStatus[]) => items.filter((it) => s.includes(it.status)).length
const doneCount = computed(() => count(['saved', 'duplicate', 'skipped', 'failed', 'cancelled']))
const savedCount = computed(() => count(['saved']))
const dupCount = computed(() => count(['duplicate']))
const failedCount = computed(() => count(['failed']))
const cancelledCount = computed(() => count(['cancelled']))
const skippedCount = computed(() => count(['skipped']))
const progress = computed(() => (items.length ? Math.round((doneCount.value / items.length) * 100) : 0))
const retryable = computed(() => failedCount.value + cancelledCount.value)

const STATUS_LABEL: Record<ColorFixBatchStatus, string> = {
  queued: '排队中',
  loading: '读取中',
  detecting: '识别中',
  rendering: '生成中',
  uploading: '保存中',
  saved: '已保存',
  duplicate: '已有相同版本',
  failed: '失败',
  cancelled: '已取消',
  skipped: '已跳过',
}
const STATUS_TONE: Record<ColorFixBatchStatus, string> = {
  queued: 'text-muted',
  loading: 'text-violet',
  detecting: 'text-violet',
  rendering: 'text-violet',
  uploading: 'text-violet',
  saved: 'text-success',
  duplicate: 'text-ink-2',
  failed: 'text-danger',
  cancelled: 'text-warning',
  skipped: 'text-muted',
}

async function run() {
  if (running.value || !hasEffect.value) return
  running.value = true
  started.value = true
  abort = new AbortController()
  try {
    await runColorFixBatch(items, applyLayers.value, {
      concurrency: 2,
      signal: abort.signal,
      onSaved: () => {
        savedAny = true
      },
    })
  } finally {
    running.value = false
    abort = null
  }
}
function cancel() {
  abort?.abort()
}
function retryFailed() {
  for (const it of items) {
    if (it.status === 'failed' || it.status === 'cancelled') {
      it.status = 'queued'
      it.message = ''
    }
  }
  void run()
}
function close() {
  if (running.value) return
  show.value = false
  if (savedAny) {
    savedAny = false
    emit('changed')
  }
}
function onUpdateShow(v: boolean) {
  if (!v) close()
}
onBeforeUnmount(() => abort?.abort())
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="应用校色"
    style="width: 600px; max-width: calc(100vw - 32px)"
    :mask-closable="!running"
    :closable="!running"
    :close-on-esc="!running"
    @update:show="onUpdateShow"
  >
    <PageEmpty
      v-if="!preset"
      compact
      text="还没有复制校色参数"
      description="打开任一图片的校色面板，在图层区「⋯」里点「复制校色参数」，再回来批量应用。"
    />
    <template v-else>
      <!-- 预设说明 -->
      <section v-if="!started" class="flex flex-col gap-8px" aria-labelledby="bcf-preset">
        <div class="flex items-baseline gap-8px">
          <h3 id="bcf-preset" class="m-0 text-13px font-600 text-ink">要应用的校色参数</h3>
          <span v-if="copiedAt" class="text-11px text-muted">复制于 {{ copiedAt }}</span>
        </div>
        <ul class="m-0 p-0 list-none flex flex-col gap-4px" aria-label="图层">
          <li
            v-for="r in rows"
            :key="r.layer.id"
            class="flex items-start gap-8px px-10px py-6px rounded-8px border border-solid border-line bg-surface2"
          >
            <span
              class="mt-1px inline-grid place-items-center w-16px h-16px rounded-full text-10px font-700 shrink-0"
              :class="r.transferable && r.effective ? 'bg-violet-solid text-on-accent' : 'bg-surface3 text-muted'"
              aria-hidden="true"
              >{{ r.transferable && r.effective ? '✓' : '–' }}</span
            >
            <span class="min-w-0 flex-1">
              <span class="block text-12px font-600 text-ink truncate">{{ r.layer.name }}</span>
              <span class="block text-11.5px leading-17px" :class="r.transferable ? 'text-muted' : 'text-warning'">
                <span class="sr-only">{{ r.transferable && r.effective ? '会应用：' : '不应用：' }}</span>{{ r.note }}
              </span>
            </span>
          </li>
        </ul>
        <p class="m-0 text-12px leading-18px text-ink-2">
          将对 <b class="text-ink">{{ imageCount }}</b> 张图片应用，每张存为新版本（原版本保留，可随时切回）。
          <template v-if="videoCount">已选中的 {{ videoCount }} 个视频会跳过。</template>
          <template v-if="skippedLayers">手动选区（涂抹 / 智能选区）的 {{ skippedLayers }} 层不会带过去。</template>
        </p>
        <p v-if="!hasEffect" class="m-0 px-10px py-6px rounded-8px bg-warning-soft text-warning text-12px" role="alert">
          这份参数里没有能带到别的图上的调整（只有手动选区层，或都没调过），请换一份再复制。
        </p>
      </section>

      <!-- 进度 -->
      <section v-else class="flex flex-col gap-10px" aria-labelledby="bcf-progress">
        <div class="flex items-center gap-10px">
          <h3 id="bcf-progress" class="m-0 text-13px font-600 text-ink">
            {{ running ? '正在应用…' : '已完成' }}
          </h3>
          <span class="text-12px text-muted tabular-nums" aria-live="polite">{{ doneCount }}/{{ items.length }}</span>
        </div>
        <div
          class="h-6px rounded-3px bg-surface3 overflow-hidden"
          role="progressbar"
          aria-label="应用进度"
          aria-valuemin="0"
          :aria-valuemax="items.length"
          :aria-valuenow="doneCount"
        >
          <div class="h-full bg-violet transition-all duration-mid" :style="{ width: `${progress}%` }" />
        </div>
        <p v-if="!running" class="m-0 text-12px text-ink-2" role="status">
          已保存 {{ savedCount }} 张<template v-if="dupCount">，{{ dupCount }} 张已有相同版本</template
          ><template v-if="skippedCount">，跳过 {{ skippedCount }} 个</template
          ><template v-if="failedCount">，<span class="text-danger">失败 {{ failedCount }} 张</span></template
          ><template v-if="cancelledCount">，取消 {{ cancelledCount }} 张</template>。
        </p>
        <ul class="m-0 p-0 list-none flex flex-col gap-4px max-h-320px overflow-y-auto" aria-label="逐张状态">
          <li
            v-for="it in items"
            :key="it.asset.id"
            class="flex items-center gap-10px px-8px py-6px rounded-8px"
            :class="it.status === 'failed' ? 'bg-danger-soft' : 'bg-surface2'"
          >
            <img
              v-if="it.asset.image"
              :src="ossResize(it.asset.image, 80)"
              alt=""
              class="w-36px h-36px rounded-6px object-cover bg-surface3 shrink-0"
              loading="lazy"
            />
            <span class="min-w-0 flex-1">
              <span class="block text-12px text-ink truncate">{{ it.asset.title || `资产 ${it.asset.id}` }}</span>
              <span v-if="it.message" class="block text-11.5px leading-17px text-muted">{{ it.message }}</span>
            </span>
            <span class="text-11.5px font-600 whitespace-nowrap" :class="STATUS_TONE[it.status]">{{ STATUS_LABEL[it.status] }}</span>
          </li>
        </ul>
      </section>
    </template>

    <template #footer>
      <div class="flex justify-end gap-8px">
        <template v-if="running">
          <n-button size="small" @click="cancel">取消</n-button>
        </template>
        <template v-else-if="started">
          <n-button v-if="retryable" size="small" @click="retryFailed">重试失败项（{{ retryable }}）</n-button>
          <n-button size="small" type="primary" @click="close">完成</n-button>
        </template>
        <template v-else>
          <n-button size="small" @click="close">取消</n-button>
          <n-button size="small" type="primary" :disabled="!preset || !hasEffect || !imageCount" @click="run">
            开始应用（{{ imageCount }} 张）
          </n-button>
        </template>
      </div>
    </template>
  </n-modal>
</template>
