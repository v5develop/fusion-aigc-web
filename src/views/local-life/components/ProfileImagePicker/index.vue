<script setup lang="ts">
/**
 * 全案设计 · 从品牌档案选设计素材。
 *
 * 后端（/workflows/local-life）要求每张参考图都是该档案已有的素材（Logo / 门店图 / 特色菜图），
 * 否则报「图片不属于该品牌档案」，所以素材只能从档案里选，不走上传。
 */
import { ref, watch } from 'vue'
import { NModal } from 'naive-ui'
import type { BrandProfileImage } from '@/api/localLifeFull.ts'

const props = defineProps<{
  images: BrandProfileImage[]
  selected: string[]
  max: number
}>()
const show = defineModel<boolean>('show', { default: false })
const emit = defineEmits<{ confirm: [urls: string[]] }>()

const ROLE_LABEL: Record<BrandProfileImage['role'], string> = { feature: '特色菜图', store: '门店图', logo: 'Logo' }
const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet'

const picked = ref<string[]>([])
watch(show, (v) => {
  if (v) picked.value = [...props.selected]
})

function toggle(url: string) {
  const at = picked.value.indexOf(url)
  if (at >= 0) picked.value.splice(at, 1)
  else if (picked.value.length < props.max) picked.value.push(url)
}

function confirm() {
  emit('confirm', [...picked.value])
  show.value = false
}
</script>

<template>
  <n-modal v-model:show="show" preset="card" title="设计素材" class="max-w-[92vw]" style="width: 640px">
    <div class="flex flex-col gap-12px">
      <p v-if="!images.length" class="m-0 py-24px text-center text-13px text-muted">品牌档案中暂无图片</p>
      <ul
        v-else
        class="m-0 grid max-h-420px list-none grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-8px overflow-y-auto p-0"
      >
        <li v-for="img in images" :key="img.url">
          <button
            type="button"
            :aria-pressed="picked.includes(img.url)"
            :aria-label="`${ROLE_LABEL[img.role]}${img.name ? `：${img.name}` : ''}`"
            :disabled="!picked.includes(img.url) && picked.length >= max"
            :class="[
              'relative w-full flex cursor-pointer flex-col overflow-hidden rounded-8px border bg-white p-0 text-left',
              'disabled:(cursor-not-allowed opacity-50)',
              picked.includes(img.url)
                ? 'border-violet ring-2 ring-violet-line'
                : 'border-line hover:border-violet-line',
              focusRing,
            ]"
            @click="toggle(img.url)"
          >
            <img :src="img.url" alt="" class="aspect-square w-full bg-sunken object-cover" loading="lazy" />
            <span class="truncate px-6px py-4px text-11px text-muted">
              {{ ROLE_LABEL[img.role] }}{{ img.name ? ` · ${img.name}` : '' }}
            </span>
            <span
              v-if="picked.includes(img.url)"
              class="absolute right-4px top-4px h-18px min-w-18px flex items-center justify-center rounded-full bg-violet px-4px text-11px text-white font-600"
              aria-hidden="true"
            >
              {{ picked.indexOf(img.url) + 1 }}
            </span>
          </button>
        </li>
      </ul>
      <footer class="flex items-center justify-end gap-8px">
        <span class="mr-auto text-12px text-muted">{{ picked.length }}/{{ max }}</span>
        <button type="button" :class="['ll-pill', focusRing]" @click="show = false">取消</button>
        <button
          type="button"
          :class="[
            'h-30px cursor-pointer rounded-full border-none bg-ink px-16px text-12px font-600 text-white hover:bg-ink-2',
            focusRing,
          ]"
          @click="confirm"
        >
          确定
        </button>
      </footer>
    </div>
  </n-modal>
</template>
