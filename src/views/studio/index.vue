<script setup lang="ts">
/**
 * 工作室首页（还原 v1.0 原型 StudioView）：
 * 页头 + 「全部 / 素材生成 / 一键成片」分组标签 + 本地生活 9 个重点功能卡；
 * 「全部」下另列商拍工作室三件套（换装 / 姿态 / 图片生成），保留原有入口。
 * 名称、描述、分组、卡片灰字取自原型 src/data/studio-features.ts；
 * 跳转对到 src/router/local-life 的现有页面，没有对应页面的卡片置灰为「即将开放」。
 */
import { computed, nextTick, ref } from 'vue'
import { RouterLink } from 'vue-router'

type ToolGroup = 'asset' | 'video'

interface ToolCard {
  key: string
  name: string
  desc: string
  /** 卡片左下角灰字（原型 mediaLabel） */
  tag: string
  icon: keyof typeof ICONS
  /** 没有 path = 暂无对应页面，卡片置灰为「即将开放」 */
  path?: string
}

/** 24×24 线性图标（描边），对应原型里的 ionicons outline 图标 */
const ICONS = {
  note: ['M4 5h16v11H9l-5 4z', 'M9 10.5h.01', 'M12 10.5h.01', 'M15 10.5h.01'],
  copy: ['M6 3h8l4 4v14H6z', 'M14 3v4h4', 'M9 12h6', 'M9 16h6'],
  poster: [
    'M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.9 1.2-1.8-.5-1 .2-2.2 1.3-2.2H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z',
    'M7.5 11.5h.01',
    'M10 7.5h.01',
    'M14.5 7.5h.01',
  ],
  person: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21c0-4 3.6-6 8-6s8 2 8 6'],
  repeat: ['M17 2l3 3-3 3', 'M4 11V9a4 4 0 0 1 4-4h12', 'M7 22l-3-3 3-3', 'M20 13v2a4 4 0 0 1-4 4H4'],
  scan: ['M4 8V5a1 1 0 0 1 1-1h3', 'M16 4h3a1 1 0 0 1 1 1v3', 'M20 16v3a1 1 0 0 1-1 1h-3', 'M8 20H5a1 1 0 0 1-1-1v-3'],
  images: ['M3 5h18v14H3z', 'M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'M21 15l-5-5-9 9'],
  film: ['M3 4h18v16H3z', 'M7 4v16', 'M17 4v16', 'M3 9h4', 'M3 15h4', 'M17 9h4', 'M17 15h4'],
  mic: ['M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z', 'M5 11a7 7 0 0 0 14 0', 'M12 18v3'],
  shirt: ['M8 3l-5 3 2 4 2-1v12h10V9l2 1 2-4-5-3a4 4 0 0 1-8 0z'],
  pose: ['M12 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M5 9l7 1 7-3', 'M12 10v5l-4 6', 'M12 15l4 6'],
  sparkle: ['M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z', 'M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z'],
} satisfies Record<string, string[]>

/** 本地生活 9 个重点功能（原型 studio-features.ts，长图在原型里 hidden，不列） */
const localLifeTools: (ToolCard & { group: ToolGroup })[] = [
  {
    key: 'note',
    group: 'asset',
    name: '图文笔记',
    desc: '输入主题，AI 先出笔记文案，确认后再按文案批量配图',
    tag: '图片',
    icon: 'note',
    path: '/local-life/note',
  },
  {
    key: 'aicopy',
    group: 'asset',
    name: 'AI文案',
    desc: '三种写法：AI 帮写、爆款仿写、自主撰写',
    tag: '文案',
    icon: 'copy',
    path: '/local-life/copywriting',
  },
  {
    key: 'poster',
    group: 'asset',
    name: '海报',
    desc: '选偏好 + 传素材 + 选模版，出一张营销海报',
    tag: '图片',
    icon: 'poster',
    path: '/local-life/poster',
  },
  {
    key: 'digitalhuman',
    group: 'asset',
    name: '数字人',
    desc: '上传一张照片，立刻获得数字分身',
    tag: '视频',
    icon: 'person',
    path: '/local-life/digital-human',
  },
  {
    key: 'motion',
    group: 'asset',
    name: '动作迁移',
    desc: '选择人物 + 选择动作视频 = 生成同款动作视频',
    tag: '视频',
    icon: 'repeat',
    path: '/local-life/action-transfer',
  },
  {
    key: 'replicate',
    group: 'asset',
    name: '视频复刻',
    desc: '给一条爆款视频链接，先解析出剧情，再按剧情复刻',
    tag: '视频',
    icon: 'scan',
    path: '/local-life/video-remake',
  },
  {
    key: 'store',
    group: 'video',
    name: '探店视频',
    desc: '输入探店描述 + 门店与达人素材，AI 出分镜剧本再出成片',
    tag: '视频',
    icon: 'images',
    path: '/local-life/explore-shop',
  },
  {
    key: 'drama',
    group: 'video',
    name: '带货短剧',
    desc: '输入卖点与主题 + 商品素材，AI 出分幕剧本再出成片',
    tag: '视频',
    icon: 'film',
    path: '/local-life/short-drama',
  },
  {
    key: 'talking',
    group: 'video',
    name: '数字人口播',
    desc: '输入口播文案 + 人物图与背景，出一个口播视频',
    tag: '视频',
    icon: 'mic',
    path: '/local-life/voiceover',
  },
]

/** 商拍工作室三件套（原 /studio 入口页的内容，只在「全部」下列出） */
const shootTools: ToolCard[] = [
  {
    key: 'tryon',
    name: '商拍换装',
    desc: '服装 + 模特整批试穿，批量出商拍大片',
    tag: '图片',
    icon: 'shirt',
    path: '/studio/tryon',
  },
  {
    key: 'pose',
    name: '姿态复刻',
    desc: '一张人物图 + 姿势参考，同款姿态批量复刻',
    tag: '图片',
    icon: 'pose',
    path: '/studio/pose',
  },
  {
    key: 'imagegen',
    name: '图片生成',
    desc: '提示词 + 参考图，文生图 / 图生图一次多张',
    tag: '图片',
    icon: 'sparkle',
    path: '/studio/imagegen',
  },
]

type TabKey = 'all' | ToolGroup
const tabs: { key: TabKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'asset', label: '素材生成' },
  { key: 'video', label: '一键成片' },
]

const active = ref<TabKey>('all')
const tabRefs = ref<HTMLButtonElement[]>([])

const list = computed(() =>
  active.value === 'all' ? localLifeTools : localLifeTools.filter((t) => t.group === active.value),
)

/** 左右方向键 / Home / End 切换标签，焦点跟随选中项（WAI-ARIA tabs 自动激活模式） */
async function onTabKeydown(event: KeyboardEvent, index: number) {
  const total = tabs.length
  const next =
    event.key === 'ArrowRight'
      ? (index + 1) % total
      : event.key === 'ArrowLeft'
        ? (index - 1 + total) % total
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? total - 1
            : null
  const target = next === null ? undefined : tabs[next]
  if (next === null || !target) return
  event.preventDefault()
  active.value = target.key
  await nextTick()
  tabRefs.value[next]?.focus()
}

const cardBase = 'flex flex-col items-start gap-12px rounded-16px bg-white p-16px text-left no-underline'
const cardEnabled =
  'cursor-pointer transition-all duration-200 ' +
  'hover:shadow-[0_4px_16px_rgba(31,35,41,0.08)] hover:-translate-y-2px ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet focus-visible:outline-offset-2 ' +
  'focus-visible:shadow-[0_4px_16px_rgba(31,35,41,0.08)] focus-visible:-translate-y-2px'
const sections = computed(() => {
  const result: { key: string; title?: string; items: ToolCard[] }[] = [{ key: 'local-life', items: list.value }]
  if (active.value === 'all') result.push({ key: 'shoot', title: '商拍工作室', items: shootTools })
  return result
})
</script>

<template>
  <div class="h-full flex flex-col bg-page">
    <div class="shrink-0 flex flex-col gap-16px px-24px pt-24px pb-8px">
      <header>
        <h1 class="m-0 text-20px font-600 leading-28px text-ink">工作室</h1>
        <p class="m-0 mt-4px text-14px leading-22px text-muted">
          移动端几个重点功能的桌面版：先出文案 / 剧本，再出图出片，按张按秒计费
        </p>
      </header>
      <div class="flex flex-wrap gap-8px" role="tablist" aria-label="功能分组">
        <button
          v-for="(tab, index) in tabs"
          :id="`studio-tab-${tab.key}`"
          :key="tab.key"
          ref="tabRefs"
          type="button"
          role="tab"
          :aria-selected="active === tab.key"
          aria-controls="studio-tab-panel"
          :tabindex="active === tab.key ? 0 : -1"
          :class="[
            'h-32px cursor-pointer rounded-8px border-none px-12px text-14px transition-colors',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet focus-visible:outline-offset-2',
            active === tab.key ? 'bg-violet-soft text-violet-ink font-600' : 'bg-white text-ink-2 hover:text-violet',
          ]"
          @click="active = tab.key"
          @keydown="onTabKeydown($event, index)"
        >
          {{ tab.label }}
        </button>
      </div>
    </div>

    <div
      id="studio-tab-panel"
      role="tabpanel"
      :aria-labelledby="`studio-tab-${active}`"
      class="min-h-0 flex-1 overflow-y-auto px-24px pt-8px pb-24px"
    >
      <section
        v-for="section in sections"
        :key="section.key"
        :aria-label="section.title ?? '重点功能'"
        :class="section.title ? 'mt-24px' : ''"
      >
        <h2 v-if="section.title" class="m-0 mb-12px text-16px font-600 leading-24px text-ink">
          {{ section.title }}
        </h2>
        <ul class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-12px p-0">
          <li v-for="tool in section.items" :key="tool.key" class="flex">
            <component
              :is="tool.path ? RouterLink : 'div'"
              v-bind="tool.path ? { to: tool.path } : { 'aria-disabled': 'true' }"
              :aria-label="tool.path ? `${tool.name}：${tool.desc}` : `${tool.name}（即将开放）`"
              :class="[cardBase, 'w-full', tool.path ? cardEnabled : 'cursor-not-allowed opacity-60']"
            >
              <span class="w-full flex items-center gap-12px">
                <span
                  class="h-44px w-44px shrink-0 flex items-center justify-center rounded-12px bg-violet-soft text-violet"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path v-for="d in ICONS[tool.icon]" :key="d" :d="d" />
                  </svg>
                </span>
                <span class="min-w-0 flex-1 truncate text-16px font-600 leading-24px text-ink">{{ tool.name }}</span>
                <span v-if="!tool.path" class="ll-chip ll-chip-warning">即将开放</span>
              </span>
              <span class="line-clamp-2 min-h-44px text-14px leading-22px text-muted">{{ tool.desc }}</span>
              <span class="text-12px leading-20px text-placeholder">{{ tool.tag }}</span>
            </component>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
