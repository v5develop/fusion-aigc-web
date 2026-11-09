<script setup lang="ts">
/**
 * 商拍换装 · 服装图弹窗（线上原型 AiDigitalModel：标题「服装图」、720 宽）。
 *
 * <p>上方 8 个单品片（4 列）→ 说明 → 选 2 件起出「一套合影 / 分别上传」→
 * 分别上传：每件一行，名称 40 + 6 个 78×130 r12 角度格（3 列 × 2 行、间距 8；正面 / 背面 / 侧面 / 细节 / 平铺 / 其他）+ 右侧 n / 6；
 * 已传格左下角度标 10px、右上悬停删除（StudioMedBtn，命中 32）；单品片 30 高 / 分段 26 高，可点字 12、说明 11。
 * 一套合影：220 高整块虚线格放一张合影。底栏「改动即时保存，关掉即生效」+「完成」。
 *
 * <p>状态在 useTryonGarment（页面持有）：弹窗里的增删即时生效，关掉 / 完成只是收起；
 * 写回服装图槽位的那一张由 ToolTryonMaterials 负责。
 */
import { ref } from 'vue'
import StudioMedBtn from '@/views/studio/components/StudioImageUpload/StudioMedBtn.vue'
import { ANGLES, MAX_PHOTOS, OUTFIT, OUTFIT_CONFLICT_TEXT, outfitLabel, type TryonGarment } from './useTryonGarment'

const { g, accept, note } = defineProps<{
  g: TryonGarment
  /** 文件框的 accept（同服装图槽位） */
  accept: string
  /** 额外的一行说明（商拍工作室写服务端的参考图上限）；不传不显示 */
  note?: string
}>()

const show = defineModel<boolean>('show', { required: true })

const fileInput = ref<HTMLInputElement | null>(null)
let pending: { kind: 'item'; key: string; angle: string } | { kind: 'look' } | null = null

function pick(target: NonNullable<typeof pending>) {
  if (g.uploading) return
  pending = target
  fileInput.value?.click()
}

function onFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  const target = pending
  pending = null
  if (!files.length || !target) return
  if (target.kind === 'look') void g.setLook(files)
  else void g.addFiles(target.key, files, target.angle)
}

function dropOn(key: string | 'look', event: DragEvent) {
  const files = [...(event.dataTransfer?.files ?? [])]
  if (!files.length) return
  if (key === 'look') void g.setLook(files)
  else void g.addFiles(key, files)
}

const focusRing = 'outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-2)'
/** 单品片 / 分段片选中：柔紫线 + 白→#f8f3fc + 紫字 600 */
const onCls = 'border-violet-line bg-[linear-gradient(180deg,#fff_0%,#f8f3fc_100%)] text-violet-ink font-600'
</script>

<template>
  <n-modal v-model:show="show" preset="card" title="服装图" :style="{ width: '720px', maxWidth: 'calc(100vw - 48px)' }">
    <input
      ref="fileInput"
      type="file"
      class="hidden"
      :accept="accept"
      multiple
      tabindex="-1"
      aria-hidden="true"
      @change="onFiles"
    />

    <div class="flex flex-col gap-12px max-h-[min(520px,calc(100vh-220px))] overflow-y-auto">
      <div class="grid grid-cols-4 gap-6px">
        <button
          v-for="item in OUTFIT"
          :key="item.key"
          type="button"
          class="h-30px box-border rounded-6px border border-solid text-12px cursor-pointer"
          :class="[focusRing, g.selected.includes(item.key) ? onCls : 'border-line bg-white text-muted']"
          :aria-pressed="g.selected.includes(item.key)"
          @click="g.toggleItem(item.key)"
        >
          {{ item.label }}
        </button>
      </div>
      <p class="m-0 text-11px leading-15px text-placeholder">
        只替换选中的单品，最多 3 件。{{ OUTFIT_CONFLICT_TEXT }}；可直接把图片拖进每一件。
      </p>

      <div
        v-if="g.selected.length >= 2"
        class="flex gap-2px p-3px box-border rounded-6px border border-solid border-line bg-surface3"
      >
        <button
          v-for="opt in [
            { key: 'together', label: '一套合影' },
            { key: 'separate', label: '分别上传' },
          ] as const"
          :key="opt.key"
          type="button"
          class="flex-1 h-26px box-border rounded-4px border border-solid text-12px cursor-pointer"
          :class="[focusRing, g.mode === opt.key ? onCls : 'border-transparent bg-transparent text-muted']"
          :aria-pressed="g.mode === opt.key"
          @click="g.switchMode(opt.key)"
        >
          {{ opt.label }}
        </button>
      </div>

      <div
        v-if="!g.selected.length"
        class="p-18px rounded-6px border border-dashed border-line bg-#fbfcfc text-11px text-center text-placeholder"
      >
        先在上面选 1–3 件单品，再上传对应的服装图。
      </div>

      <template v-else-if="g.isTogether">
        <div class="relative w-full h-220px">
          <button
            type="button"
            class="relative block w-full h-full box-border overflow-hidden rounded-6px border border-dashed border-line bg-#fbfcfc text-11px text-placeholder cursor-pointer"
            :class="focusRing"
            :aria-label="g.look ? '换一张整套合影' : '上传一张整套合影'"
            @click="pick({ kind: 'look' })"
            @dragover.prevent
            @drop.prevent="dropOn('look', $event)"
          >
            <template v-if="g.look">
              <img :src="g.look" alt="" class="absolute inset-0 w-full h-full object-cover" />
              <span
                class="absolute left-8px bottom-8px px-8px py-2px rounded-full bg-[rgba(31,35,41,0.68)] text-white text-10px"
                >整套合影 · 1 张</span
              >
            </template>
            <template v-else-if="g.uploading">上传中…</template>
            <template v-else>＋ 上传一张整套合影</template>
          </button>
          <StudioMedBtn v-if="g.look" label="移除整套合影" class="top-8px right-8px z-2" @click="g.removeLook()">
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
        <p class="m-0 text-11px leading-15px text-placeholder">
          一张图里同时有 {{ g.selected.map(outfitLabel).join('、') }}；系统自己找每件的细节。
        </p>
      </template>

      <template v-else>
        <div
          v-for="key in g.selected"
          :key="key"
          class="flex items-center gap-10px"
          role="group"
          :aria-label="`${outfitLabel(key)}服装图`"
          @dragover.prevent
          @drop.prevent="dropOn(key, $event)"
        >
          <span class="flex-[0_0_40px] w-40px text-11px text-ink-2">{{ outfitLabel(key) }}</span>
          <div class="grid grid-cols-[repeat(3,78px)] gap-8px">
            <template v-for="angle in ANGLES" :key="angle">
              <div
                v-if="g.photoAt(key, angle)"
                class="group relative w-78px h-130px box-border overflow-hidden rounded-12px border border-solid border-line bg-white"
              >
                <img
                  :src="g.photoAt(key, angle)!.url"
                  :alt="`${outfitLabel(key)}${angle}`"
                  class="block w-full h-full object-cover"
                />
                <span
                  class="absolute left-4px bottom-4px px-5px rounded-full bg-[rgba(31,35,41,0.72)] text-white text-10px leading-16px"
                  >{{ angle }}</span
                >
                <StudioMedBtn
                  label="删除这张"
                  class="top-3px right-3px z-2 sx-reveal motion-reduce:transition-none"
                  @click="g.removePhoto(g.photoAt(key, angle)!.id)"
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
                class="flex flex-col items-center justify-center gap-2px w-78px h-130px box-border p-0 rounded-12px border border-dashed border-line bg-white text-placeholder cursor-pointer disabled:cursor-progress"
                :class="focusRing"
                :disabled="g.uploading"
                :aria-label="`上传${outfitLabel(key)}${angle}角度`"
                @click="pick({ kind: 'item', key, angle })"
              >
                <span class="text-14px leading-none" aria-hidden="true">＋</span>
                <span class="text-11px leading-15px">{{ angle }}</span>
              </button>
            </template>
          </div>
          <span class="ml-auto text-11px text-placeholder">{{ g.photosOf(key).length }} / {{ MAX_PHOTOS }}</span>
        </div>
        <p class="m-0 text-11px leading-15px text-placeholder">
          每件最多 6 张、服装图合计最多 9 张；背面、侧面一起传更准，缺的角度不影响出图。
        </p>
        <p v-if="note" class="m-0 text-11px leading-15px text-placeholder">{{ note }}</p>
      </template>
    </div>

    <template #footer>
      <div class="flex items-center gap-10px">
        <span class="mr-auto text-11px text-placeholder">{{
          g.uploading ? '上传中…' : '改动即时保存，关掉即生效'
        }}</span>
        <button
          type="button"
          class="h-34px box-border px-18px rounded-6px border border-solid border-#6a487b bg-[linear-gradient(180deg,#8a639f,#7a548c)] text-white text-13px font-600 cursor-pointer shadow-[0_1px_2px_rgba(31,35,41,0.16),inset_0_1px_0_rgba(255,255,255,0.18)]"
          :class="focusRing"
          @click="show = false"
        >
          完成
        </button>
      </div>
    </template>
  </n-modal>
</template>
