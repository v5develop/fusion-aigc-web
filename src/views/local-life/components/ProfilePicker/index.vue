<script setup lang="ts">
/**
 * 全案设计 · 选择品牌档案弹窗（原型 LocalLifeView 档案库弹层：780 宽）。
 *
 * 头部「共 N 个档案 / 图片会用于生成参考；模板随档案不同」；卡片 = 58 封面 + 店名 + 「品类 · 地址」
 * + 「图片 N 张 · 模板 N 个」+ 选中勾。摘要来自 Java 档案列表（category / address / coverUrl / imageCount /
 * templateCount），没有的项不编造、整段省略。底部「没有合适的？新建一份简化档案」+「新建档案」（Java 源：弹 BrandProfileForm 写 /brand-profiles，
 * 成功后刷新列表并自动选中新档案；每张卡右下「编辑」走 PUT）。Go 源仍指向店铺档案页。
 * 数据来自 useFullSet（按 LL_PROFILE_SOURCE 取 Java brand-profiles 或 Go shop-profiles），这里只负责展示与选择。
 */
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NModal, NSpin } from 'naive-ui'
import { loadProfileList, type LLProfileItem, type LLProfileSource } from '@/api/local-life-full.ts'
import IconButton from '@/components/IconButton/index.vue'
import BrandProfileForm from '../BrandProfileForm/index.vue'

const props = defineProps<{
  profiles: LLProfileItem[]
  loading: boolean
  error: boolean
  currentId?: number
  source: LLProfileSource
}>()
const show = defineModel<boolean>('show', { default: false })
const emit = defineEmits<{ select: [item: LLProfileItem]; retry: [] }>()

const SHOP_PROFILE_PATH = '/local-life/shop-profile'
const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet'
/** 小号次按钮（spec 默认按钮缩到 28 高） */
const smallBtn = 'sx-btn !h-28px !px-10px !text-12px transition-[border-color,background,color] duration-fast ease-sx'

function metaLine(item: LLProfileItem) {
  return [item.category, item.address].filter(Boolean).join(' · ')
}
function countLine(item: LLProfileItem) {
  const parts: string[] = []
  if (item.imageCount != null) parts.push(`图片 ${item.imageCount} 张`)
  if (item.templateCount != null) parts.push(`模板 ${item.templateCount} 个`)
  return parts.join(' · ')
}

const formShow = ref(false)
const editId = ref<number | null>(null)
function openCreate() {
  editId.value = null
  formShow.value = true
}
function openEdit(item: LLProfileItem) {
  editId.value = item.id
  formShow.value = true
}
async function onSaved(p: { mode: 'create' | 'edit'; id: number | null }) {
  emit('retry')
  if (p.id == null) return
  try {
    const item = (await loadProfileList(props.source)).find((i) => i.id === p.id)
    // 新建：选中新档案（与点选同一条路径）；编辑：正在用的档案重新选一次以刷新详情
    if (item && (p.mode === 'create' || item.id === props.currentId)) choose(item)
  } catch {
    // 列表刷新失败由 retry 后的错误态呈现
  }
}

function choose(item: LLProfileItem) {
  emit('select', item)
  show.value = false
}
</script>

<template>
  <n-modal v-model:show="show" preset="card" title="选择品牌档案" class="max-w-[calc(100vw-48px)]" style="width: 780px">
    <n-spin :show="loading">
      <div class="min-h-160px flex flex-col gap-10px">
        <div v-if="error" class="sx-empty flex-1" role="alert">
          <span class="sx-empty-title !text-danger">品牌档案加载失败</span>
          <button type="button" :class="smallBtn" @click="emit('retry')">重试</button>
        </div>
        <template v-else>
          <div class="flex items-center justify-between gap-12px text-12px leading-18px text-muted">
            <span class="tabular-nums">共 {{ profiles.length }} 个档案</span>
            <span class="min-w-0 truncate">图片会用于生成参考；模板随档案不同</span>
          </div>
          <div v-if="!loading && !profiles.length" class="sx-empty flex-1">
            <span class="sx-empty-title">暂无品牌档案</span>
          </div>
          <ul
            v-else
            class="m-0 grid max-h-420px list-none grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-10px overflow-y-auto p-2px"
            aria-label="品牌档案"
          >
            <li v-for="item in profiles" :key="item.id" class="group relative flex">
              <button
                type="button"
                :aria-pressed="currentId === item.id"
                :class="[
                  'relative w-full flex cursor-pointer items-center gap-10px rounded-md border border-solid p-9px text-left [font-family:inherit]',
                  'transition-[border-color,background,box-shadow] duration-mid ease-sx motion-reduce:transition-none',
                  currentId === item.id
                    ? 'border-violet bg-violet-soft'
                    : 'border-line bg-white hover:(border-violet-line bg-surface2)',
                  focusRing,
                ]"
                @click="choose(item)"
              >
                <span
                  class="h-58px w-58px flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-solid border-line-soft bg-sunken text-placeholder"
                >
                  <img
                    v-if="item.coverUrl || item.logoUrl"
                    :src="item.coverUrl || item.logoUrl"
                    alt=""
                    class="h-full w-full object-cover"
                    loading="lazy"
                  />
                  <svg
                    v-else
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    aria-hidden="true"
                  >
                    <path d="M4 5h16v14H4z" />
                    <path d="M20 15l-5-5-9 9" />
                  </svg>
                </span>
                <span class="min-w-0 flex flex-1 flex-col gap-2px pr-18px">
                  <b class="truncate text-12px font-600 leading-18px text-ink">{{ item.title }}</b>
                  <small v-if="metaLine(item)" class="truncate text-11px leading-16px text-muted">{{
                    metaLine(item)
                  }}</small>
                  <small v-if="countLine(item)" class="truncate text-11px leading-16px text-muted tabular-nums">{{
                    countLine(item)
                  }}</small>
                </span>
                <span
                  v-if="currentId === item.id"
                  class="absolute right-8px top-8px h-18px w-18px flex items-center justify-center rounded-full sx-grad-primary text-white shadow-btn"
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3">
                    <path d="M5 12l5 5 9-10" />
                  </svg>
                </span>
              </button>
              <IconButton
                v-if="source === 'java'"
                class="!absolute bottom-6px right-6px"
                :label="`编辑档案：${item.title}`"
                variant="quiet"
                size="sm"
                reveal
                @click="openEdit(item)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M4 20h4L19 9l-4-4L4 16v4z" />
                </svg>
              </IconButton>
            </li>
          </ul>
        </template>
        <footer class="mt-4px flex items-center gap-8px border-t border-t-solid border-line-soft pt-12px">
          <template v-if="source === 'java'">
            <span class="min-w-0 flex-1 text-12px leading-18px text-muted">没有合适的？新建一份简化档案</span>
            <button type="button" :class="[smallBtn, focusRing]" @click="openCreate">新建档案</button>
          </template>
          <template v-else>
            <span class="text-12px leading-18px text-muted">没有合适的？</span>
            <RouterLink
              :to="SHOP_PROFILE_PATH"
              :class="[
                'min-h-28px inline-flex items-center rounded-sm text-12px text-violet-ink underline underline-offset-3 transition-colors duration-fast hover:text-violet-press',
                focusRing,
              ]"
              @click="show = false"
            >
              去店铺档案新建
            </RouterLink>
          </template>
        </footer>
      </div>
    </n-spin>
  </n-modal>
  <BrandProfileForm v-model:show="formShow" :edit-id="editId" @saved="onSaved" />
</template>
