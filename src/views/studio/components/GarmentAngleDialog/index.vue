<script setup lang="ts">
/**
 * 商拍换装 · 服装图弹窗（s1.1「6 个固定角度格」）。
 *
 * <p>720 宽（窄屏 max-width 收进视口，格子换行）；每件单品 6 个 78×78 虚线格：
 * 正面 / 背面 / 侧面 / 细节 / 平铺 / 其他。点哪格进哪格，一次多张时自动落到下一个空角度；
 * 每件最多 maxPerGroup 张、合计最多 maxTotal 张，到顶给 toast，不静默丢图。
 *
 * <p>角度传值仍是 front / back / side / detail / flat / unknown。回填数据里同一角度有两张时，
 * 多出来的排在 6 格后面单独显示（不改它的角度、不丢图）。弹窗只发 add / remove，
 * 数据仍由页面持有（garmentByItem + angleByUrl）。
 */
import { computed, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { ACCEPT_IMAGE } from '@/utils/utils.ts'
import { ANGLE_OPTIONS, ANGLE_SEQUENCE } from '../../constants.ts'
import StudioMedBtn from '../StudioImageUpload/StudioMedBtn.vue'
import { useStudioUploader } from '../StudioImageUpload/useStudioUploader.ts'

interface GarmentGroup {
  key: string
  label: string
  urls: string[]
}

interface AngleCell {
  angle: string
  label: string
  url: string
  extra: boolean
}

const { groups, angleOf, maxPerGroup, maxTotal } = defineProps<{
  /** 选中的单品及其服装图 */
  groups: GarmentGroup[]
  /** 服装图角度（按 url） */
  angleOf: Record<string, string>
  maxPerGroup: number
  maxTotal: number
}>()

const emit = defineEmits<{
  add: [key: string, url: string, angle: string]
  remove: [key: string, url: string]
}>()

const show = defineModel<boolean>('show', { required: true })

const message = useMessage()
const { uploading, uploadFiles } = useStudioUploader()
const fileInput = ref<HTMLInputElement | null>(null)
/** 正在往哪件、从哪个角度格开始放 */
const target = ref<{ key: string; angle: string } | null>(null)

const total = computed(() => groups.reduce((sum, g) => sum + g.urls.length, 0))

function angleLabel(value: string) {
  return ANGLE_OPTIONS.find((o) => o.value === value)?.label ?? '其他'
}

function cellsFor(group: GarmentGroup): AngleCell[] {
  const fixed = ANGLE_OPTIONS.map((o) => ({
    angle: o.value,
    label: o.label,
    url: group.urls.find((u) => angleOf[u] === o.value) ?? '',
    extra: false,
  }))
  const shown = new Set(fixed.map((c) => c.url).filter(Boolean))
  const extras = group.urls
    .filter((u) => !shown.has(u))
    .map((u) => {
      const angle = angleOf[u] || 'unknown'
      return { angle, label: angleLabel(angle), url: u, extra: true }
    })
  return [...fixed, ...extras]
}

/** 这件还能放几张：每件上限与合计上限取小；到顶给提示 */
function roomOf(group: GarmentGroup) {
  if (group.urls.length >= maxPerGroup) {
    message.warning(`${group.label}最多 ${maxPerGroup} 张`)
    return 0
  }
  if (total.value >= maxTotal) {
    message.warning(`服装图合计最多 ${maxTotal} 张，要换先删一张`)
    return 0
  }
  return Math.min(maxPerGroup - group.urls.length, maxTotal - total.value)
}

function pick(group: GarmentGroup, angle: string) {
  if (uploading.value || roomOf(group) <= 0) return
  target.value = { key: group.key, angle }
  fileInput.value?.click()
}

/** 从起始角度往后找空角度（绕回开头）；都占满落「其他」 */
function nextFreeAngle(start: string, taken: Set<string>) {
  const at = Math.max(0, ANGLE_SEQUENCE.indexOf(start as (typeof ANGLE_SEQUENCE)[number]))
  for (let i = 0; i < ANGLE_SEQUENCE.length; i++) {
    const a = ANGLE_SEQUENCE[(at + i) % ANGLE_SEQUENCE.length]!
    if (!taken.has(a)) return a
  }
  return 'unknown'
}

async function addFiles(group: GarmentGroup, startAngle: string, files: File[]) {
  const room = roomOf(group)
  if (room <= 0) return
  const limit = group.urls.length + room >= maxPerGroup ? maxPerGroup : maxTotal
  const taken = new Set(group.urls.map((u) => angleOf[u]).filter((a): a is string => !!a))
  target.value = { key: group.key, angle: startAngle }
  try {
    await uploadFiles(files, room, limit, (url) => {
      const angle = nextFreeAngle(startAngle, taken)
      taken.add(angle)
      emit('add', group.key, url, angle)
    })
  } finally {
    target.value = null
  }
}

function onFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  const t = target.value
  const group = t ? groups.find((g) => g.key === t.key) : undefined
  if (!t || !group || !files.length) {
    target.value = null
    return
  }
  void addFiles(group, t.angle, files)
}

function onDrop(group: GarmentGroup, event: DragEvent) {
  if (uploading.value) return
  const files = [...(event.dataTransfer?.files ?? [])]
  if (!files.length) return
  const taken = new Set(group.urls.map((u) => angleOf[u]).filter((a): a is string => !!a))
  void addFiles(group, nextFreeAngle('front', taken), files)
}

function isPending(key: string, angle: string) {
  return uploading.value && target.value?.key === key && target.value?.angle === angle
}
</script>

<template>
  <n-modal v-model:show="show" preset="card" title="服装图" :style="{ width: '720px', maxWidth: 'calc(100vw - 48px)' }">
    <input
      ref="fileInput"
      type="file"
      class="hidden"
      :accept="ACCEPT_IMAGE"
      multiple
      tabindex="-1"
      aria-hidden="true"
      @change="onFiles"
    />

    <div class="flex flex-col gap-12px">
      <div v-if="!groups.length" class="ll-empty py-24px">先在页面上选 1–3 件单品，再上传对应的服装图。</div>

      <div
        v-for="group in groups"
        :key="group.key"
        class="flex flex-col gap-8px"
        role="group"
        :aria-label="`${group.label}服装图`"
        @dragover.prevent
        @drop.prevent="onDrop(group, $event)"
      >
        <div class="flex items-baseline gap-8px">
          <b class="text-12px font-600 text-ink">{{ group.label }}</b>
          <span class="ml-auto text-10px text-placeholder">{{ group.urls.length }} / {{ maxPerGroup }}</span>
        </div>
        <div class="flex flex-wrap gap-8px">
          <template v-for="cell in cellsFor(group)" :key="cell.extra ? cell.url : cell.angle">
            <div
              v-if="cell.url"
              class="group relative w-78px h-78px flex-[0_0_78px] box-border overflow-hidden border border-solid border-line rounded-6px bg-surface3"
            >
              <img class="block w-full h-full object-cover" :src="cell.url" :alt="`${group.label}${cell.label}`" />
              <span
                class="absolute left-4px bottom-4px px-5px rounded-full bg-[rgba(31,35,41,0.72)] text-white text-9px leading-16px"
                >{{ cell.label }}</span
              >
              <StudioMedBtn
                :label="`删除${group.label}${cell.label}`"
                class="top-3px right-3px z-2 opacity-0 transition-opacity duration-120 group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
                @click="emit('remove', group.key, cell.url)"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5M10.5 11v5M13.5 11v5" />
                </svg>
              </StudioMedBtn>
            </div>
            <button
              v-else
              type="button"
              class="flex flex-col items-center justify-center gap-2px w-78px h-78px flex-[0_0_78px] box-border p-0 border border-dashed border-line rounded-6px bg-white text-placeholder cursor-pointer hover:border-violet-line hover:text-violet-ink focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-violet focus-visible:outline-offset-2 disabled:cursor-not-allowed"
              :disabled="uploading"
              :aria-label="`上传${group.label}${cell.label}角度`"
              @click="pick(group, cell.angle)"
            >
              <n-spin v-if="isPending(group.key, cell.angle)" :size="14" />
              <template v-else>
                <span class="text-14px leading-none" aria-hidden="true">＋</span>
                <span class="text-9px leading-12px">{{ cell.label }}</span>
              </template>
            </button>
          </template>
        </div>
      </div>

      <p v-if="groups.length" class="m-0 text-11px leading-16px text-placeholder">
        每件最多 {{ maxPerGroup }} 张、服装图合计最多 {{ maxTotal }} 张（已传
        {{ total }}）；背面、侧面一起传更准，缺的角度不影响出图。可直接把图片拖进每一件。
      </p>
    </div>

    <template #footer>
      <div class="flex items-center gap-10px">
        <span class="mr-auto text-10px text-placeholder">改动即时保存，关掉即生效</span>
        <button type="button" class="ll-btn-primary h-34px px-18px !rounded-6px !text-12px" @click="show = false">
          完成
        </button>
      </div>
    </template>
  </n-modal>
</template>
