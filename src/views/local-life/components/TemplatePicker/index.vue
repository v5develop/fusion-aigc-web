<script setup lang="ts">
/**
 * 全案设计 · 选择设计模板弹窗（原型 LocalLifeView 模板弹层：1024 宽、官方 / 自定义页签、4 列 3:4 卡片多选）。
 *
 * - 官方模板：local-life-templates（按档案行业过滤）；多选 = 多版（Java templateIds，每个模板出一版）。
 * - 自定义模板：user-local-life-templates；多选 = 各图种模板图按选择顺序合并（Java 每图种最多 9 张）。
 * - 官方与自定义不可混选（Java 用 mode 二选一，混传会拒）：在另一页签勾选会替换掉当前来源的选择并提示。
 * - 覆盖图种：官方取 Java coverage，自定义按模板数据里各图种的模板图算；选了模板未覆盖的图种，提交时会被拦下。
 * 草稿在弹窗内维护，「确认选择」才回填；「清空选择」只清草稿。
 */
import { computed, ref, watch } from 'vue'
import { NModal, NSpin, useMessage } from 'naive-ui'
import { coverageText, type TemplateCard } from '../../useFullSet.ts'

const props = defineProps<{
  systemTemplates: TemplateCard[]
  userTemplates: TemplateCard[]
  loading: boolean
  error: boolean
  current: TemplateCard[]
  /** 档案名（官方模板空态文案） */
  profileName?: string
}>()
const show = defineModel<boolean>('show', { default: false })
const emit = defineEmits<{ confirm: [items: TemplateCard[]]; retry: [] }>()
const message = useMessage()

type Tab = 'system' | 'user'
const TABS: { key: Tab; label: string }[] = [
  { key: 'system', label: '官方模板' },
  { key: 'user', label: '自定义模板' },
]
const tab = ref<Tab>('system')
const draft = ref<TemplateCard[]>([])

watch(show, (v) => {
  if (!v) return
  draft.value = [...props.current]
  tab.value = props.current[0]?.source ?? 'system'
})

const list = computed(() => (tab.value === 'system' ? props.systemTemplates : props.userTemplates))
const isOn = (item: TemplateCard) => draft.value.some((d) => d.source === item.source && d.id === item.id)

function toggle(item: TemplateCard) {
  if (isOn(item)) {
    draft.value = draft.value.filter((d) => !(d.source === item.source && d.id === item.id))
    return
  }
  if (draft.value.length && draft.value[0]!.source !== item.source) {
    message.warning('官方与自定义模板不可混选，已改为本页签的选择')
    draft.value = []
  }
  if (item.source === 'system' && draft.value.length >= 9) {
    message.warning('官方模板最多选 9 个')
    return
  }
  draft.value = [...draft.value, item]
}

function confirm() {
  emit('confirm', [...draft.value])
  show.value = false
}

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet'
const smallBtn = 'sx-btn !h-28px !px-10px !text-12px transition-[border-color,background,color] duration-fast ease-sx'
const btnTr =
  'transition-[background,border-color,box-shadow,color] duration-fast ease-sx motion-reduce:transition-none'
const albums = ['M5 8h14v12H5z', 'M7 5h10', 'M9 2h6']
</script>

<template>
  <n-modal v-model:show="show" preset="card" class="max-w-[calc(100vw-48px)]" style="width: 1024px">
    <template #header>
      <div class="min-w-0 flex items-center gap-10px">
        <span
          class="h-30px w-30px flex shrink-0 items-center justify-center rounded-lg border border-solid border-line bg-surface2 text-ink-2"
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6">
            <path v-for="d in albums" :key="d" :d="d" />
          </svg>
        </span>
        <span class="min-w-0 flex flex-col gap-1px">
          <b class="text-15px font-600 leading-22px text-ink">选择模板</b>
          <small class="text-12px font-400 leading-18px text-muted tabular-nums">
            {{ draft.length ? `已选 ${draft.length} 个模板` : '未选择模板' }}
          </small>
        </span>
        <button
          v-if="draft.length"
          type="button"
          :class="[
            'ml-8px min-h-28px cursor-pointer rounded-sm border-none bg-transparent px-4px text-12px text-violet-ink underline underline-offset-3 transition-colors duration-fast hover:text-violet-press',
            focusRing,
          ]"
          @click="draft = []"
        >
          清空选择
        </button>
      </div>
    </template>

    <div class="mb-14px flex gap-18px border-b border-b-solid border-line" role="tablist" aria-label="模板来源">
      <button
        v-for="t in TABS"
        :key="t.key"
        type="button"
        role="tab"
        :aria-selected="tab === t.key"
        :class="[
          'relative min-h-36px cursor-pointer border-none bg-transparent px-0 pb-10px pt-9px text-13px [font-family:inherit]',
          tab === t.key
            ? 'font-600 text-ink after:(absolute bottom--1px left-0 right-0 h-2px rounded-2px bg-ink content-empty)'
            : 'font-400 text-muted hover:text-ink',
          focusRing,
        ]"
        @click="tab = t.key"
      >
        {{ t.label }}
      </button>
    </div>

    <n-spin :show="loading">
      <div class="min-h-240px flex flex-col">
        <div v-if="error" class="sx-empty flex-1" role="alert">
          <span class="sx-empty-title !text-danger">模板加载失败</span>
          <button type="button" :class="smallBtn" @click="emit('retry')">重试</button>
        </div>
        <p v-else-if="!loading && !list.length" class="sx-empty m-0 flex-1">
          <span class="sx-empty-title">{{
            tab === 'system' ? `「${profileName || '当前档案'}」暂无官方模板` : '还没有自定义模板'
          }}</span>
          <span class="sx-empty-desc">{{
            tab === 'system' ? '可切到自定义模板，或换一个品牌档案' : '在自定义模板里上传各图种的模板图后再来选择'
          }}</span>
        </p>
        <ul
          v-else
          class="m-0 grid max-h-520px list-none grid-cols-2 gap-14px overflow-y-auto p-2px sm:grid-cols-3 md:grid-cols-4"
          :aria-label="tab === 'system' ? '官方模板' : '自定义模板'"
        >
          <li v-for="item in list" :key="`${item.source}-${item.id}`" class="flex">
            <button
              type="button"
              :aria-pressed="isOn(item)"
              :class="[
                'relative w-full flex cursor-pointer flex-col gap-6px rounded-[10px] border border-solid bg-white p-6px text-left [font-family:inherit]',
                'transition-[border-color,box-shadow] duration-mid ease-sx motion-reduce:transition-none',
                isOn(item)
                  ? 'border-violet shadow-[0_0_0_2px_rgba(135,95,154,0.14)]'
                  : 'border-line hover:border-violet-line',
                focusRing,
              ]"
              @click="toggle(item)"
            >
              <span
                class="aspect-[3/4] w-full flex items-center justify-center overflow-hidden rounded-md bg-sunken text-placeholder"
              >
                <img v-if="item.cover" :src="item.cover" alt="" class="h-full w-full object-cover" loading="lazy" />
                <svg
                  v-else
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  aria-hidden="true"
                >
                  <path d="M4 5h16v14H4z" />
                  <path d="M20 15l-5-5-9 9" />
                </svg>
              </span>
              <span class="min-w-0 flex flex-col gap-1px px-2px pb-2px">
                <b class="truncate text-12px font-600 leading-18px text-ink">{{ item.title }}</b>
                <small v-if="coverageText(item.coverage)" class="truncate text-11px leading-16px text-muted">{{
                  coverageText(item.coverage)
                }}</small>
              </span>
              <span
                :class="[
                  'absolute right-12px top-12px h-20px w-20px flex items-center justify-center box-border rounded-full border border-solid',
                  isOn(item)
                    ? 'sx-grad-primary border-violet-border text-white shadow-btn'
                    : 'border-white bg-white/85 text-transparent shadow-[0_1px_2px_rgba(31,35,41,0.12)]',
                ]"
                aria-hidden="true"
              >
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="3">
                  <path d="M5 12l5 5 9-10" />
                </svg>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </n-spin>

    <footer class="mt-14px flex items-center justify-end gap-8px border-t border-t-solid border-line-soft pt-12px">
      <span class="mr-auto min-w-0 text-12px leading-18px text-muted">可多选，官方与自定义模板不可混选</span>
      <button type="button" :class="btnTr" class="sx-btn" @click="show = false">取消</button>
      <button type="button" :class="btnTr" class="sx-btn-primary !px-16px" @click="confirm">确认选择</button>
    </footer>
  </n-modal>
</template>
