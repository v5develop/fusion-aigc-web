<script setup lang="ts">
/**
 * 全案设计 · 从品牌档案选设计素材（原型 LocalLifeView「{图种} · 选择设计素材」弹层）。
 *
 * 后端（/workflows/local-life）要求每张参考图都是该档案已有的素材（Logo / 门店图 / 特色菜图），
 * 否则报「图片不属于该品牌档案」，所以素材只能从档案里选，不走上传。
 * 选满后再点不禁用、给提示「每条最多选 N 张素材」（原型口径）；选中角标按选择顺序编号。
 */
import { ref, watch } from 'vue'
import { NModal, useMessage } from 'naive-ui'
import type { BrandProfileImage } from '@/api/localLifeFull.ts'

const props = defineProps<{
  images: BrandProfileImage[]
  selected: string[]
  max: number
  /** 图种名（标题「{图种} · 选择设计素材」） */
  sectionTitle: string
  /** 档案名（头部「{档案名} · N 张档案图片」） */
  profileName: string
}>()
const show = defineModel<boolean>('show', { default: false })
const emit = defineEmits<{ confirm: [urls: string[]] }>()
const message = useMessage()

const ROLE_LABEL: Record<BrandProfileImage['role'], string> = { feature: '特色菜图', store: '门店图', logo: 'Logo' }
const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet'
/** spec 按钮过渡：0.11s */
const btnTr =
  'transition-[background,border-color,box-shadow,color] duration-fast ease-sx motion-reduce:transition-none'

const picked = ref<string[]>([])
watch(show, (v) => {
  if (v) picked.value = [...props.selected]
})

function toggle(url: string) {
  const at = picked.value.indexOf(url)
  if (at >= 0) {
    picked.value.splice(at, 1)
    return
  }
  if (picked.value.length >= props.max) {
    message.warning(`每条最多选 ${props.max} 张素材`)
    return
  }
  picked.value.push(url)
}

function confirm() {
  emit('confirm', [...picked.value])
  show.value = false
}
</script>

<template>
  <n-modal
    v-model:show="show"
    preset="card"
    :title="`${sectionTitle} · 选择设计素材`"
    class="max-w-[calc(100vw-48px)]"
    style="width: 760px"
  >
    <div class="flex flex-col gap-10px">
      <div class="flex items-center justify-between gap-12px text-12px leading-18px text-muted">
        <span class="min-w-0 truncate">{{ profileName }} · {{ images.length }} 张档案图片</span>
        <span class="shrink-0 tabular-nums">已选 {{ picked.length }} / {{ max }}</span>
      </div>
      <p v-if="!images.length" class="sx-empty m-0">
        <span class="sx-empty-title">品牌档案中暂无图片</span>
        <span class="sx-empty-desc">去店铺档案补充特色菜图或门店图后再选</span>
      </p>
      <ul
        v-else
        class="m-0 grid max-h-420px list-none grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-8px overflow-y-auto p-0"
      >
        <li v-for="img in images" :key="img.url">
          <button
            type="button"
            :aria-pressed="picked.includes(img.url)"
            :aria-label="`${ROLE_LABEL[img.role]}${img.name ? `：${img.name}` : ''}`"
            :class="[
              'relative w-full flex cursor-pointer flex-col overflow-hidden rounded-lg border border-solid p-0 text-left',
              'transition-[border-color,background,box-shadow] duration-mid ease-sx motion-reduce:transition-none',
              picked.includes(img.url)
                ? 'border-violet-line sx-grad-tint ring-1 ring-violet'
                : 'border-line bg-white hover:(border-violet-line shadow-raised)',
              focusRing,
            ]"
            @click="toggle(img.url)"
          >
            <img :src="img.url" alt="" class="aspect-square w-full bg-sunken object-cover" loading="lazy" />
            <span class="truncate px-6px py-4px text-11px leading-16px text-muted">
              {{ ROLE_LABEL[img.role] }}{{ img.name ? ` · ${img.name}` : '' }}
            </span>
            <span
              v-if="picked.includes(img.url)"
              class="absolute right-4px top-4px h-18px min-w-18px box-border flex items-center justify-center rounded-full border border-solid border-white sx-grad-primary px-4px text-11px text-white font-600 tabular-nums shadow-btn"
              aria-hidden="true"
            >
              {{ picked.indexOf(img.url) + 1 }}
            </span>
          </button>
        </li>
      </ul>
      <footer class="mt-4px flex items-center justify-end gap-8px border-t border-t-solid border-line-soft pt-12px">
        <span class="mr-auto min-w-0 text-12px leading-18px text-muted">每条最多 {{ max }} 张；生成时作为参考图</span>
        <button type="button" :class="btnTr" class="sx-btn" @click="show = false">取消</button>
        <button type="button" :class="btnTr" class="sx-btn-primary !px-16px" @click="confirm">
          确认选择（{{ picked.length }}）
        </button>
      </footer>
    </div>
  </n-modal>
</template>
