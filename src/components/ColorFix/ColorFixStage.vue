<script setup lang="ts">
/**
 * 多结果图的内嵌校色舞台：显示宿主（./host.ts）当前选中的那张大图（画面见 ./ColorFixView.vue：校色预览 / 校色对比 +
 * 参数台）。下面一排：结果 / 校色对比 分段切换、下载（校色开着 = 校色后的 PNG）/ 下载原图 / 存为资产（宿主给了 save
 * 时）/ 收起。弹窗形态见 ./ColorFixDialog.vue。
 */
import { computed, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import IconButton from '@/components/IconButton/index.vue'
import ColorFixView from './ColorFixView.vue'
import type { ColorFixHost } from './host.ts'

const { host, stageClass = 'h-[min(62vh,640px)] min-h-280px' } = defineProps<{
  host: ColorFixHost
  /** 舞台尺寸（高度类） */
  stageClass?: string
}>()

const message = useMessage()
const entry = computed(() => host.focused.value)
const cf = computed(() => entry.value?.cf ?? null)

const mode = ref<'result' | 'compare'>('result')
watch(entry, () => (mode.value = 'result'))
const canCompare = computed(() => !!cf.value?.compareAvailable.value)

const saving = ref(false)
const fileName = computed(() => entry.value?.name || '结果')

async function downloadAfter() {
  const c = cf.value
  if (!c) return
  if (!c.active.value) {
    c.downloadOriginal(fileName.value)
    return
  }
  if (!(await c.downloadBaked(`${fileName.value}-校色后.png`))) message.warning('校色效果未能写入，已下载原图')
}

function downloadBefore() {
  cf.value?.downloadOriginal(`${fileName.value}-原图`)
}

async function save() {
  const e = entry.value
  const fn = host.options.save
  if (!e || !fn || saving.value) return
  saving.value = true
  try {
    await fn(e)
  } catch {
    message.error('存为资产失败，请重试')
  } finally {
    saving.value = false
  }
}

const segBtn =
  'h-32px box-border px-12px rounded-8px border-none text-13px cursor-pointer whitespace-nowrap [transition:background_120ms,color_120ms] motion-reduce:transition-none outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)'
</script>

<template>
  <div v-if="entry && cf" class="flex flex-col gap-8px">
    <div class="relative overflow-hidden rounded-8px bg-surface3" :class="stageClass">
      <ColorFixView
        v-model:mode="mode"
        :cf="cf"
        :alt="`${fileName}（校色预览）`"
        @download-before="downloadBefore"
        @download-after="downloadAfter"
      />
    </div>

    <div class="flex flex-wrap items-center gap-8px">
      <div
        v-if="canCompare"
        class="flex items-center gap-2px p-2px rounded-10px bg-surface3"
        role="group"
        aria-label="显示方式"
      >
        <button
          type="button"
          :class="[segBtn, mode === 'result' ? 'bg-white text-ink font-600 shadow-[0_1px_2px_rgba(31,35,41,0.08)]' : 'bg-transparent text-ink-2']"
          :aria-pressed="mode === 'result'"
          @click="mode = 'result'"
        >
          结果
        </button>
        <button
          type="button"
          :class="[segBtn, mode === 'compare' ? 'bg-white text-ink font-600 shadow-[0_1px_2px_rgba(31,35,41,0.08)]' : 'bg-transparent text-ink-2']"
          :aria-pressed="mode === 'compare'"
          @click="mode = 'compare'"
        >
          校色对比
        </button>
      </div>
      <span class="min-w-0 truncate text-12px leading-18px text-muted" role="status" aria-live="polite">
        {{ cf.baking.value ? '正在生成校色效果…' : cf.active.value ? '下载 / 存资产将使用校色后的图片' : `第 ${entry.index + 1} 张 · 点「校色调整」修正偏色` }}
      </span>
      <span class="ml-auto flex flex-wrap items-center gap-8px">
        <button type="button" class="sx-btn !h-32px !px-12px !text-13px" @click="downloadAfter">
          {{ cf.active.value ? '下载校色后' : '下载' }}
        </button>
        <button v-if="cf.active.value" type="button" class="sx-btn !h-32px !px-12px !text-13px" @click="downloadBefore">
          下载原图
        </button>
        <button
          v-if="host.options.save && cf.active.value"
          type="button"
          class="sx-btn !h-32px !px-12px !text-13px"
          :disabled="saving"
          :aria-busy="saving || undefined"
          @click="save"
        >
          {{ saving ? '保存中…' : '存为资产（校色后）' }}
        </button>
        <IconButton label="收起校色" variant="quiet" @click="host.close()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </IconButton>
      </span>
    </div>
  </div>
</template>
