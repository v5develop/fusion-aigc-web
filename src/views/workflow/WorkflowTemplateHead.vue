<script setup lang="ts">
/**
 * 工作流面板头（原型 components/workflow/WorkflowTemplateHead.vue:171-219）：
 * 64 高的卡（内边距 12/14、缩略 56×40、名称 15/600、说明 11），点开在卡下方 8px 列出切换面板。
 *
 * <p>面板是三级目录（原型 workflow-templates.ts）：业务域（服装 / 电商 / 视频 / 视觉，带计数）→ 分类 → 模板。
 * 模板项仍是 RouterLink（query 形状 flow / category / template 不变），切换逻辑留在页面的 watch 里。
 */
import { computed, nextTick, ref } from 'vue'
import { RouterLink, type RouteLocationRaw } from 'vue-router'
import { NPopover } from 'naive-ui'
import { workflowTree, type WorkflowSchema } from './schemas'
import { TAGLINES } from './taglines'

const props = defineProps<{
  titleId: string
  name: string
  desc: string
  current: WorkflowSchema
  /** 目录里列出的模板（已去掉隐藏项；当前模板若是隐藏项也会带上） */
  options: WorkflowSchema[]
  nameOf: (s: WorkflowSchema) => string
  linkOf: (s: WorkflowSchema) => RouteLocationRaw
}>()

const open = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)
const pop = ref<HTMLElement | null>(null)

const tree = computed(() =>
  workflowTree.map((f) => {
    const categories = f.categories.map((c) => ({
      ...c,
      items: props.options.filter((s) => s.flow === f.flow && s.category === c.key),
    }))
    return { ...f, categories, count: categories.reduce((n, c) => n + c.items.length, 0) }
  }),
)
const total = computed(() => props.options.length)

async function onShow(show: boolean) {
  open.value = show
  if (!show) return
  // 打开后把焦点放到当前项，键盘用户 Tab 一下就能切模板
  await nextTick()
  pop.value?.querySelector<HTMLElement>('[aria-current="page"]')?.focus()
}

function close(refocus = false) {
  open.value = false
  if (refocus) trigger.value?.focus()
}
</script>

<template>
  <NPopover
    raw
    trigger="click"
    placement="bottom-start"
    width="trigger"
    :show="open"
    :show-arrow="false"
    :offset="8"
    @update:show="onShow"
  >
    <template #trigger>
      <div
        class="relative flex-none box-border flex items-center gap-12px h-64px mx-12px mt-12px px-14px py-12px rounded-8px border border-solid border-violet-soft-2 bg-[linear-gradient(180deg,var(--xq-surface)_0%,var(--xq-violet-soft-tint)_100%)] shadow-[0_1px_2px_rgba(31,35,41,0.05)]"
        @keydown.esc="close(true)"
      >
        <span
          class="flex-none grid place-items-center w-56px h-40px box-border rounded-6px border border-solid border-line sx-grad-icon text-violet"
          aria-hidden="true"
        >
          <svg
            class="w-20px h-20px"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M9.94 15.5a2 2 0 0 0-1.44-1.44l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"
            />
            <path d="M20 3v4M22 5h-4" />
          </svg>
        </span>
        <div class="min-w-0 flex-1 flex flex-col gap-2px pr-20px">
          <h1 :id="titleId" class="m-0 truncate text-15px font-600 leading-20px text-ink">{{ name }}</h1>
          <p class="m-0 truncate text-11px leading-16px tracking-[.01em] text-muted">{{ desc }}</p>
        </div>
        <!-- 整卡可点：按钮铺满卡面，焦点环画在卡外 -->
        <button
          ref="trigger"
          type="button"
          class="absolute inset-0 flex items-center justify-end pr-14px m-0 rounded-8px border-none bg-transparent text-muted cursor-pointer transition-opacity hover:opacity-82 outline-none focus-visible:(outline-2 outline-solid outline-violet outline-offset-3)"
          :aria-expanded="open"
          aria-haspopup="true"
          :aria-label="`切换工作流模板，当前：${name}`"
        >
          <svg
            class="w-14px h-14px transition-transform motion-reduce:transition-none"
            :class="open ? 'rotate-180' : ''"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>
    </template>

    <nav
      ref="pop"
      class="flex flex-col min-w-320px max-h-480px overflow-hidden rounded-10px border border-solid border-line bg-white shadow-[0_12px_24px_rgba(31,35,41,0.14),0_2px_6px_rgba(31,35,41,0.06)]"
      aria-label="切换工作流模板"
      @keydown.esc.stop="close(true)"
    >
      <header class="flex-none flex items-center gap-8px h-44px px-14px shadow-[inset_0_-1px_0_var(--xq-line-soft)]">
        <b class="flex-1 text-13px font-600 text-muted">切换模板</b>
        <span class="text-11px text-placeholder">{{ total }} 个</span>
      </header>
      <div class="flex-1 min-h-0 overflow-y-auto p-6px [scrollbar-width:thin]">
        <section
          v-for="(f, fi) in tree"
          :key="f.flow"
          :class="fi ? 'mt-6px pt-6px border-0 border-t border-solid border-line-soft' : ''"
        >
          <h2 class="m-0 flex items-center gap-6px h-28px px-10px text-12px font-600 text-ink-2">
            {{ f.label }}
            <span class="text-11px font-400 text-placeholder tabular-nums">{{ f.count }}</span>
          </h2>
          <div v-for="c in f.categories" :key="c.key">
            <h3 class="m-0 flex items-center gap-6px h-24px px-10px text-11px font-500 text-muted">
              {{ c.label }}
              <span class="text-10px font-400 text-placeholder tabular-nums">{{ c.items.length }}</span>
              <span v-if="!c.items.length" class="text-10px font-400 text-placeholder">· 暂未开放</span>
            </h3>
            <ul class="m-0 p-0 list-none flex flex-col gap-2px">
              <li v-for="s in c.items" :key="s.schemaId">
                <RouterLink
                  :to="linkOf(s)"
                  replace
                  class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-10px gap-y-2px min-h-52px box-border py-7px pl-18px pr-10px rounded-6px border border-solid no-underline transition-colors outline-none focus-visible:(outline-2 outline-solid outline-violet -outline-offset-2)"
                  :class="
                    s.schemaId === current.schemaId
                      ? 'border-violet-line bg-[linear-gradient(180deg,var(--xq-surface)_0%,var(--xq-violet-tint)_100%)] shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
                      : 'border-transparent bg-transparent hover:bg-surface3'
                  "
                  :aria-current="s.schemaId === current.schemaId ? 'page' : undefined"
                  @click="close()"
                >
                  <span
                    class="truncate text-13px leading-18px"
                    :class="s.schemaId === current.schemaId ? 'font-600 text-violet-ink' : 'font-500 text-ink'"
                    >{{ nameOf(s) }}</span
                  >
                  <span class="text-10px leading-14px text-placeholder whitespace-nowrap">
                    {{ s.status === 'mapped' ? `${s.uploads.length} 个素材` : '即将开放' }}
                  </span>
                  <span
                    class="col-span-full truncate text-11px leading-16px"
                    :class="s.schemaId === current.schemaId ? 'text-#8a6d99 [[data-theme=dark]_&]:text-violet-fg' : 'text-muted'"
                  >
                    {{ s.uploads.map((u) => u.label).join(' · ') || '无需本地上传' }}
                  </span>
                  <span v-if="TAGLINES[s.name]" class="col-span-full truncate text-11px leading-14px text-placeholder">
                    {{ TAGLINES[s.name] }}
                  </span>
                </RouterLink>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </nav>
  </NPopover>
</template>
