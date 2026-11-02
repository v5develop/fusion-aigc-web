<script setup lang="ts">
/**
 * 本地生活入口页 · 全案设计（还原 v1.0 原型 LocalLifeView 的版式）。
 *
 * 左：384 固定「预览 / 历史」页签 + 手机预览；右：标题行（全案设计 + 档案 pill + 四步条）
 * → 卡 A（选择品牌档案）→ 卡 B（五类图种列）→ 底栏（预计消耗 + 一键生成全案）。
 * 步骤名、图种名、文案照原型 src/views/local-life。
 *
 * 全案生成还没有后端接口，页面不读写任何数据：档案 pill / 虚线 CTA 跳到现有店铺档案页，
 * 图种列为原型未启用态（只展示），模板 chip 与生成键点了说明「即将开放」。
 * 原入口页的 11 个单项工具链接保留在右列「单项工具」区（原型没有这一块）。
 */
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NConfigProvider, NTooltip, useMessage } from 'naive-ui'
import { llTheme } from './theme.ts'
import EntryPhone from './components/EntryPhone/index.vue'
import EntryTypeColumn from './components/EntryTypeColumn/index.vue'

const message = useMessage()

const SHOP_PROFILE_PATH = '/local-life/shop-profile'
const COMING_SOON = '全案生成即将开放，可先使用「单项工具」逐个制作'

/* ---------- 四步条（原型 STEP_LABELS；入口页没有档案，停在第 1 步） ---------- */
const STEP_LABELS = ['选择品牌档案', '选择设计模板', '配置全案需求', '提交生成']
const stepCurrent = 0

/* ---------- 五类图种（原型 CONTENT_SECTIONS 的标题 / 多条 / 素材上限） ---------- */
const ITEM_MAX_LENGTH = 200
const SECTIONS = [
  { key: 'fivePanel', title: '五连图', multiItem: true, maxImages: 4 },
  { key: 'entryImage', title: '入口图', multiItem: true, maxImages: 4 },
  { key: 'twoPanel', title: '套餐二连图', multiItem: true, maxImages: 4 },
  { key: 'setMealImage', title: '套餐图', multiItem: true, maxImages: 4 },
  { key: 'closeupImage', title: '推荐菜', multiItem: false, maxImages: 4 },
]

/* ---------- 预览 / 历史页签 ---------- */
type SideTab = 'preview' | 'history'
const sideTabs: { key: SideTab; label: string }[] = [
  { key: 'preview', label: '预览' },
  { key: 'history', label: '历史' },
]
const activeTab = ref<SideTab>('preview')
const tabRefs = ref<HTMLButtonElement[]>([])

function onTabKeydown(event: KeyboardEvent, index: number) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + sideTabs.length) % sideTabs.length
  activeTab.value = sideTabs[next]!.key
  tabRefs.value[next]?.focus()
}

/* ---------- 计费 ⓘ：悬停或键盘聚焦都能看到 ---------- */
const billingTipShow = ref(false)

/* ---------- 原入口页的单项工具（路径不变） ---------- */
const toolGroups = [
  {
    title: '文案与档案',
    items: [
      { title: 'AI文案', desc: 'AI帮写、爆款仿写，商品文案一键成稿', path: '/local-life/copywriting' },
      { title: '店铺档案', desc: '店铺信息一次录入，各创作模块共用', path: SHOP_PROFILE_PATH },
    ],
  },
  {
    title: '数字人',
    items: [
      { title: 'AI数字人', desc: '形象 + 音色 + 文案，生成口播数字人视频', path: '/local-life/digital-human' },
      { title: '数字人口播', desc: '一段文案一张脸，快速产出播报视频', path: '/local-life/voiceover' },
    ],
  },
  {
    title: '图文与海报',
    items: [
      { title: '图文笔记', desc: '构思 → 规划 → 出图，小红书图文一条龙', path: '/local-life/note' },
      { title: 'AI海报', desc: '模板 + 海报信息，批量生成节日营销海报', path: '/local-life/poster' },
      { title: 'AI长图', desc: '商品与卖点，生成分段引导长图', path: '/local-life/long-image' },
      { title: '动作迁移', desc: '把动作视频的肢体迁移给指定人物', path: '/local-life/action-transfer' },
    ],
  },
  {
    title: '视频创作',
    items: [
      { title: '探店视频', desc: '文案 + 门店实拍，生成分镜探店大片', path: '/local-life/explore-shop' },
      { title: '带货短剧', desc: '主题 + 商品图，剧情带货短剧自动成片', path: '/local-life/short-drama' },
      { title: '爆款视频复刻', desc: '粘贴爆款链接，解析分镜同款复刻', path: '/local-life/video-remake' },
    ],
  },
]

/* ---------- 图标（24×24 描边，对应原型 ionicons outline） ---------- */
const ICONS = {
  image: ['M4 5h16v14H4z', 'M9 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'M20 15l-5-5-9 9'],
  chevron: ['M9 5l7 7-7 7'],
  sparkle: ['M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z', 'M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z'],
  grid: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  albums: ['M5 8h14v12H5z', 'M7 5h10', 'M9 2h6'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5', 'M12 8h.01'],
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
} satisfies Record<string, string[]>

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet'
const pill =
  'h-30px inline-flex shrink-0 cursor-pointer items-center gap-6px border border-line rounded-full bg-white px-10px text-ink-2 no-underline transition-colors hover:(border-violet-line bg-violet-soft text-violet-ink)'

function onTemplateChip() {
  message.info('设计模板随全案生成一起开放')
}
function onSubmit() {
  message.info(COMING_SOON)
}
</script>

<template>
  <n-config-provider :theme-overrides="llTheme" abstract>
    <div class="h-full min-h-0 flex flex-col overflow-y-auto bg-page text-ink min-[1200px]:overflow-hidden">
      <div
        class="min-w-0 flex flex-1 flex-col gap-24px px-24px pb-24px pt-16px min-[1200px]:(min-h-0 flex-row overflow-hidden)"
      >
        <!-- 左：预览 / 历史 -->
        <aside
          class="min-h-0 min-w-0 flex flex-col border border-line rounded-8px bg-white p-10px min-[1200px]:(w-384px shrink-0)"
          aria-label="预览与历史"
        >
          <div
            class="grid grid-cols-2 shrink-0 gap-4px rounded-6px bg-page p-3px"
            role="tablist"
            aria-label="预览与历史"
          >
            <button
              v-for="(tab, index) in sideTabs"
              :id="`ll-side-tab-${tab.key}`"
              :key="tab.key"
              ref="tabRefs"
              type="button"
              role="tab"
              :aria-selected="activeTab === tab.key"
              :aria-controls="`ll-side-${tab.key}`"
              :tabindex="activeTab === tab.key ? 0 : -1"
              :class="[
                'h-28px cursor-pointer rounded-4px border-none px-8px text-13px transition-colors',
                focusRing,
                activeTab === tab.key
                  ? 'bg-white font-600 text-violet-ink shadow-[0_1px_2px_rgba(31,35,41,0.08)]'
                  : 'bg-transparent font-500 text-muted hover:text-ink',
              ]"
              @click="activeTab = tab.key"
              @keydown="onTabKeydown($event, index)"
            >
              {{ tab.label }}
            </button>
          </div>

          <div class="min-h-0 min-w-0 flex flex-1 pt-12px">
            <div
              v-show="activeTab === 'preview'"
              id="ll-side-preview"
              role="tabpanel"
              aria-labelledby="ll-side-tab-preview"
              class="min-h-0 min-w-0 flex flex-1 flex-col gap-8px overflow-y-auto"
            >
              <EntryPhone />
            </div>
            <div
              v-show="activeTab === 'history'"
              id="ll-side-history"
              role="tabpanel"
              aria-labelledby="ll-side-tab-history"
              class="min-h-160px flex flex-1 flex-col items-center justify-center gap-4px"
            >
              <p class="ll-empty m-0">还没有生成记录</p>
            </div>
          </div>
        </aside>

        <!-- 右：标题行 + 两张卡 + 底栏 -->
        <section class="min-h-0 min-w-0 flex flex-1 flex-col gap-16px" aria-label="全案配置">
          <header class="flex shrink-0 flex-wrap items-center justify-between gap-x-20px gap-y-8px pr-4px">
            <div class="min-w-0 flex items-center gap-10px">
              <h1 class="m-0 whitespace-nowrap text-20px font-700 leading-28px">全案设计</h1>
              <RouterLink
                :to="SHOP_PROFILE_PATH"
                :class="[pill, focusRing, 'max-w-280px text-12px']"
                aria-label="点击选择品牌档案（前往店铺档案）"
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6">
                  <path v-for="d in ICONS.image" :key="d" :d="d" />
                </svg>
                <span class="truncate">点击选择品牌档案</span>
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2">
                  <path v-for="d in ICONS.chevron" :key="d" :d="d" />
                </svg>
              </RouterLink>
            </div>

            <ol class="m-0 flex shrink-0 list-none items-center justify-end p-0" aria-label="制作进度">
              <template v-for="(label, index) in STEP_LABELS" :key="label">
                <li
                  :class="[
                    'flex items-center gap-8px whitespace-nowrap text-12px',
                    stepCurrent === index ? 'font-600 text-ink' : 'text-ink/45',
                  ]"
                  :aria-current="stepCurrent === index ? 'step' : undefined"
                >
                  <span
                    :class="[
                      'h-28px w-28px flex shrink-0 items-center justify-center rounded-full border text-11px font-600 font-mono',
                      stepCurrent === index ? 'border-ink bg-ink text-white' : 'border-ink/10 bg-surface2 text-ink/30',
                    ]"
                  >
                    {{ index + 1 }}
                  </span>
                  <span>{{ label }}</span>
                </li>
                <li v-if="index < STEP_LABELS.length - 1" class="mx-10px h-1px w-28px bg-ink/12" aria-hidden="true" />
              </template>
            </ol>
          </header>

          <div
            class="min-h-0 min-w-0 flex flex-1 flex-col gap-16px pr-2px min-[1200px]:(overflow-y-auto overscroll-contain)"
          >
            <!-- 卡 A：选择品牌档案 -->
            <section
              class="flex shrink-0 flex-col gap-14px border border-line rounded-12px bg-white p-16px"
              aria-labelledby="ll-card-setup"
            >
              <header class="min-w-0 flex items-center gap-8px">
                <span
                  class="h-24px w-24px flex shrink-0 items-center justify-center border border-line rounded-6px bg-surface2 text-muted"
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6">
                    <path v-for="d in ICONS.sparkle" :key="d" :d="d" />
                  </svg>
                </span>
                <h2 id="ll-card-setup" class="m-0 text-14px font-600 leading-20px">选择品牌档案</h2>
                <button
                  type="button"
                  :class="[pill, focusRing, 'ml-auto text-11px']"
                  aria-label="选择模板（即将开放）"
                  @click="onTemplateChip"
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6">
                    <path v-for="d in ICONS.albums" :key="d" :d="d" />
                  </svg>
                  <span>选择模板</span>
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2">
                    <path v-for="d in ICONS.chevron" :key="d" :d="d" />
                  </svg>
                </button>
              </header>

              <RouterLink
                :to="SHOP_PROFILE_PATH"
                :class="[
                  'h-56px flex items-center justify-center gap-8px rounded-8px border-2 border-dashed border-ink/12 bg-ink/2',
                  'text-13px text-ink/55 no-underline transition-colors',
                  'hover:(border-violet/45 bg-violet/5 text-violet-ink)',
                  focusRing,
                ]"
                aria-label="点击选择品牌档案（前往店铺档案）"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6">
                  <path v-for="d in ICONS.image" :key="d" :d="d" />
                </svg>
                点击选择品牌档案
              </RouterLink>
            </section>

            <!-- 卡 B：本次内容 -->
            <section
              class="flex shrink-0 flex-col gap-12px border border-line rounded-12px bg-white p-16px"
              aria-labelledby="ll-card-board"
            >
              <header class="min-w-0 flex items-center gap-8px">
                <span
                  class="h-24px w-24px flex shrink-0 items-center justify-center border border-line rounded-6px bg-surface2 text-muted"
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6">
                    <path v-for="d in ICONS.grid" :key="d" :d="d" />
                  </svg>
                </span>
                <h2 id="ll-card-board" class="m-0 text-14px font-600 leading-20px">选择本次需要制作的内容</h2>
                <span class="ml-auto rounded-full bg-surface3 px-10px py-3px text-11px text-muted">
                  已选 0/{{ SECTIONS.length }} 种
                </span>
              </header>
              <div class="grid grid-cols-[repeat(auto-fit,minmax(172px,1fr))] items-stretch gap-10px">
                <EntryTypeColumn
                  v-for="section in SECTIONS"
                  :key="section.key"
                  :title="section.title"
                  :multi-item="section.multiItem"
                  :max-images="section.maxImages"
                  :max-length="ITEM_MAX_LENGTH"
                />
              </div>
            </section>

            <!-- 原型没有这一块：原入口页的单项工具，路径不变 -->
            <section
              class="flex shrink-0 flex-col gap-12px border border-line rounded-12px border-dashed bg-surface2 p-16px"
              aria-labelledby="ll-card-tools"
            >
              <header class="flex flex-wrap items-baseline gap-x-8px gap-y-2px">
                <h2 id="ll-card-tools" class="m-0 text-14px font-600 leading-20px">单项工具</h2>
                <span class="text-12px text-muted">全案生成开放前，可从这里进入各模块逐个制作</span>
              </header>
              <div v-for="group in toolGroups" :key="group.title" class="flex flex-col gap-8px">
                <h3 class="m-0 text-12px font-500 leading-18px text-ink-2">{{ group.title }}</h3>
                <ul class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-8px p-0">
                  <li v-for="item in group.items" :key="item.path" class="flex">
                    <RouterLink
                      :to="item.path"
                      :aria-label="`${item.title}：${item.desc}`"
                      :class="[
                        'group w-full flex items-center gap-8px rounded-8px border border-line bg-white px-12px py-10px no-underline transition-colors',
                        'hover:(border-violet-line bg-violet-soft)',
                        focusRing,
                      ]"
                    >
                      <span class="min-w-0 flex flex-1 flex-col gap-2px">
                        <span class="truncate text-13px font-600 leading-20px text-ink">{{ item.title }}</span>
                        <span class="truncate text-12px leading-18px text-muted">{{ item.desc }}</span>
                      </span>
                      <svg
                        class="shrink-0 text-placeholder group-hover:text-violet-ink"
                        viewBox="0 0 24 24"
                        width="14"
                        height="14"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.8"
                        aria-hidden="true"
                      >
                        <path v-for="d in ICONS.arrow" :key="d" :d="d" />
                      </svg>
                    </RouterLink>
                  </li>
                </ul>
              </div>
            </section>
          </div>

          <!-- 底栏 -->
          <footer
            class="flex shrink-0 items-center justify-between gap-16px border border-line rounded-12px bg-white p-16px"
          >
            <div class="min-w-0 flex items-center gap-8px text-muted">
              <span class="text-12px leading-18px text-ink/45">预计消耗</span>
              <svg
                class="text-violet"
                viewBox="0 0 24 24"
                width="12"
                height="12"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                aria-hidden="true"
              >
                <path v-for="d in ICONS.sparkle" :key="d" :d="d" />
              </svg>
              <b class="text-16px font-600 leading-22px text-ink font-mono">0</b>
              <span class="text-12px text-ink/55">星币</span>
              <n-tooltip :show="billingTipShow" placement="top">
                <template #trigger>
                  <button
                    type="button"
                    :class="[
                      'h-20px w-20px flex cursor-pointer items-center justify-center rounded-full border-none bg-transparent p-0 text-ink/40 hover:text-ink',
                      focusRing,
                    ]"
                    aria-label="查看计费明细"
                    @mouseenter="billingTipShow = true"
                    @mouseleave="billingTipShow = false"
                    @focus="billingTipShow = true"
                    @blur="billingTipShow = false"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="13"
                      height="13"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                    >
                      <path v-for="d in ICONS.info" :key="d" :d="d" />
                    </svg>
                  </button>
                </template>
                <span class="flex flex-col gap-2px text-12px">
                  <b>计费明细</b>
                  <span>勾选图种并添加内容后显示</span>
                </span>
              </n-tooltip>
            </div>

            <button
              type="button"
              :class="[
                'h-44px shrink-0 cursor-pointer rounded-full border-none bg-ink px-40px text-14px font-600 text-white transition-colors hover:bg-ink-2',
                focusRing,
              ]"
              :title="COMING_SOON"
              @click="onSubmit"
            >
              一键生成全案
            </button>
          </footer>
        </section>
      </div>
    </div>
  </n-config-provider>
</template>
