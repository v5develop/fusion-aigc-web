<script setup lang="ts">
/**
 * 本地生活入口页 · 全案设计（还原 v1.0 原型 LocalLifeView 的版式）。
 *
 * 左：384 固定「预览 / 历史（角标封顶 99）」页签 + 手机预览；右：标题行（全案设计 + 档案 pill + 四步条）
 * → 卡 A（未选档案 = 选择品牌档案；选了 = 档案小卡 + 整体设计要求「总需求 / 风格需求」，头部模板 chip 多选）
 * → 卡 B（五类图种列）→ 底栏（预计消耗 + 一键生成全案；按钮不置灰，条件不满足点了提示原因）。
 * 步骤名、图种名、文案照原型 src/views/local-life。
 *
 * 接口（Java Creaft v1，见 api/localLifeFull.ts 与 useFullSet.ts）：品牌档案 /brand-profiles、
 * 模板 /local-life-templates + /user-local-life-templates、提交 /workflows/local-life、
 * 续跑 /workflows/local-life/continue、轮询 /workflows/local-life-dianping/histories/{id}、
 * 产物与历史 /brand-profiles/{id}/assets、价目 /features/biz-points。
 * 原入口页的 11 个单项工具链接保留在右列「单项工具」区（原型没有这一块）；本地生活导航首页（#/local-life）也列了同一组。
 * 路由：#/local-life/full-set（原 #/local-life 现为导航首页）。
 */
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NConfigProvider, NPopconfirm, NSpin, NTooltip, useMessage } from 'naive-ui'
import IconButton from '@/components/IconButton/index.vue'
import PageEmpty from '@/components/PageEmpty/index.vue'
import { llFormSkin, llTheme } from './theme.ts'
import EntryPhone from './components/EntryPhone/index.vue'
import EntryTypeColumn from './components/EntryTypeColumn/index.vue'
import ProfilePicker from './components/ProfilePicker/index.vue'
import TemplatePicker from './components/TemplatePicker/index.vue'
import ProfileImagePicker from './components/ProfileImagePicker/index.vue'
import {
  ITEM_MAX_LENGTH,
  REQUIREMENT_MAX_LENGTH,
  SECTIONS,
  STATUS_LABEL,
  isLLTerminal,
  rowResults,
  useFullSet,
  type KindResults,
  type TemplateCard,
} from './useFullSet.ts'
import { BIZ_TYPE_TO_KIND, type BrandProfileAssetRow, type LLKindKey, type LLProfileItem } from '@/api/localLifeFull.ts'

const SHOP_PROFILE_PATH = '/local-life/shop-profile'

const message = useMessage()
const fs = useFullSet()
const {
  profileSource,
  profiles,
  profilesLoading,
  profilesError,
  profile,
  profileLoading,
  systemTemplates,
  userTemplates,
  templatesLoading,
  templatesError,
  templates,
  sections,
  selectedCount,
  continueFrom,
  costLines,
  estimatedCost,
  estimateIsMinimum,
  history,
  historyTotal,
  historyLoading,
  historyError,
  deletingHistoryId,
  requirement,
  styleRequirement,
  blockReason,
  contentBlockReason,
  submitting,
  running,
  run,
  runNotice,
  retrying,
  offline,
} = fs

/* ---------- 四步条（原型 STEP_LABELS：已完成打勾，当前 = 第一个未完成项） ---------- */
const STEP_LABELS = ['选择品牌档案', '选择设计模板', '配置全案需求', '提交生成']
/** 第 3 步完成 = 内容这一步没有拦提交的问题（与提交校验同一套规则） */
const stepDone = computed(() => [
  !!profile.value,
  templates.value.length > 0 || !!continueFrom.value,
  !contentBlockReason.value,
  false,
])
const stepCurrent = computed(() => {
  const rest = stepDone.value.findIndex((done) => !done)
  return rest === -1 ? 3 : rest
})

/* ---------- 预览 / 历史页签 ---------- */
type SideTab = 'preview' | 'history'
const sideTabs: { key: SideTab; label: string }[] = [
  { key: 'preview', label: '预览' },
  { key: 'history', label: '历史' },
]
/** 历史角标：该档案的历史总数，封顶 99 */
const historyBadge = computed(() => Math.min(99, historyTotal.value || history.value.length))
const activeTab = ref<SideTab>('preview')
const tabRefs = ref<HTMLButtonElement[]>([])

function onTabKeydown(event: KeyboardEvent, index: number) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + sideTabs.length) % sideTabs.length
  activeTab.value = sideTabs[next]!.key
  tabRefs.value[next]?.focus()
}

/** 预览：点了某条历史就看它，否则看当前这次生成 */
const previewHistoryId = ref<number | null>(null)
const previewResults = computed<KindResults>(() => {
  if (previewHistoryId.value != null) {
    return rowResults(history.value.find((r) => r.workflowHistoryId === previewHistoryId.value))
  }
  return run.value?.results ?? {}
})
/** 推荐菜产物旁的菜名：只有当前这次生成、且提交时记下了组号 → 菜名时才配；看历史 / 接管的记录不配 */
const previewCloseupNames = computed<(string | undefined)[]>(() => {
  if (previewHistoryId.value != null || !run.value?.closeupNames || !run.value.closeupGroups) return []
  const names = run.value.closeupNames
  return run.value.closeupGroups.map((g) => (g == null ? undefined : names[g]))
})
const runFailed = computed(
  () => !!run.value && isLLTerminal(run.value.status) && !['SUCCEED', 'PARTIAL_SUCCEED'].includes(run.value.status),
)

function showHistory(id: number) {
  previewHistoryId.value = id
  activeTab.value = 'preview'
}

function formatTime(v?: string | null) {
  return v ? v.replace('T', ' ').slice(0, 16) : ''
}

const KIND_TITLE = Object.fromEntries(SECTIONS.map((s) => [s.key, s.title])) as Record<LLKindKey, string>
/** 历史标题：「品牌 · 五连图×2 · 推荐菜×1」（张数按产物，未出图按所选图种），超 48 字截断 */
function historyTitle(row: BrandProfileAssetRow) {
  const parts: string[] = []
  for (const b of row.businesses ?? []) {
    const kind = BIZ_TYPE_TO_KIND[b.bizType]
    if (!kind) continue
    const n = (b.results ?? []).filter((r) => r.url).length
    parts.push(n ? `${KIND_TITLE[kind]}×${n}` : KIND_TITLE[kind])
  }
  const text = [profile.value?.title, ...parts].filter(Boolean).join(' · ')
  return text.length > 48 ? `${text.slice(0, 47)}…` : text
}
function historyThumbs(row: BrandProfileAssetRow) {
  return Object.values(rowResults(row)).flat().slice(0, 10)
}
/** 点数：成功 = 实扣；失败 = 已退回；进行中 = 预扣（部分失败的退款以点数明细为准） */
function historyPoints(row: BrandProfileAssetRow) {
  if (row.points == null) return ''
  if (row.status === 'SUCCEED' || row.status === 'PARTIAL_SUCCEED') return `${row.points} 点数`
  if (isLLTerminal(row.status)) return `${row.points} 点数已退回`
  return `预扣 ${row.points} 点数`
}
function historyFailed(row: BrandProfileAssetRow) {
  return isLLTerminal(row.status) && row.status !== 'SUCCEED' && row.status !== 'PARTIAL_SUCCEED'
}
async function onDeleteHistory(id: number) {
  const ok = await fs.deleteHistory(id)
  if (ok && previewHistoryId.value === id) previewHistoryId.value = null
}

/* ---------- 弹窗 ---------- */
const profilePickerShow = ref(false)
const templatePickerShow = ref(false)
const imagePicker = ref<{ show: boolean; kind: LLKindKey; index: number }>({ show: false, kind: 'fivePanel', index: 0 })

function openProfilePicker() {
  profilePickerShow.value = true
  if (!profiles.value.length && !profilesLoading.value) void fs.loadProfiles()
}
function onSelectProfile(item: LLProfileItem) {
  previewHistoryId.value = null
  void fs.selectProfile(item)
}
function openTemplatePicker() {
  if (!profile.value) {
    message.warning('请先选择品牌档案，再看该品牌可用的模板')
    openProfilePicker()
    return
  }
  templatePickerShow.value = true
}
function onConfirmTemplates(items: TemplateCard[]) {
  templates.value = items
  if (items.length) continueFrom.value = null
}
const templateChipText = computed(() => {
  if (continueFrom.value) return '沿用上一轮模板'
  return templates.value.length ? `已选 ${templates.value.length} 个模板` : '选择模板'
})

/* ---------- 图种列 ---------- */
const MAX_TYPES = SECTIONS.length
function toggleSection(kind: LLKindKey) {
  const st = sections[kind]
  if (!st.selected && selectedCount.value >= MAX_TYPES) return
  st.selected = !st.selected
}
function addItem(kind: LLKindKey) {
  sections[kind].items.push({ content: '', images: [] })
}
function removeItem(kind: LLKindKey, index: number) {
  sections[kind].items.splice(index, 1)
}
function setContent(kind: LLKindKey, index: number, value: string) {
  sections[kind].items[index]!.content = value
}
function removeImage(kind: LLKindKey, index: number, url: string) {
  const item = sections[kind].items[index]!
  item.images = item.images.filter((u) => u !== url)
}
function openImagePicker(kind: LLKindKey, index: number) {
  if (!profile.value) {
    message.warning('请先选择品牌档案，再从中选择素材')
    openProfilePicker()
    return
  }
  imagePicker.value = { show: true, kind, index }
}
const imagePickerSelected = computed(
  () => sections[imagePicker.value.kind].items[imagePicker.value.index]?.images ?? [],
)
const imagePickerMax = computed(() => SECTIONS.find((s) => s.key === imagePicker.value.kind)?.maxImages ?? 4)
const imagePickerTitle = computed(() => KIND_TITLE[imagePicker.value.kind])
function onImagesPicked(urls: string[]) {
  const item = sections[imagePicker.value.kind].items[imagePicker.value.index]
  if (item) item.images = urls
}

/* ---------- 整体设计要求 ---------- */
function onRequirementInput(key: string, event: Event) {
  const value = (event.target as HTMLTextAreaElement).value.slice(0, REQUIREMENT_MAX_LENGTH)
  if (key === 'requirement') requirement.value = value
  else styleRequirement.value = value
}

/* ---------- 续跑 ---------- */
async function onContinue(historyId: number) {
  await fs.startContinue(historyId)
  previewHistoryId.value = historyId
}

function cancelContinue() {
  continueFrom.value = null
}

/* ---------- 计费 ⓘ：悬停或键盘聚焦都能看到 ---------- */
const billingTipShow = ref(false)

/* ---------- 底栏 ---------- */
const submitLabel = computed(() => {
  if (running.value) return STATUS_LABEL.RUNNING
  if (retrying.value) return '重试生成'
  return '一键生成全案'
})
/** 只在提交中 / 生成中禁用；其余条件不满足时按钮照常可点，点了提示原因（fs.submit 内校验并 toast） */
const submitDisabled = computed(() => submitting.value || running.value)
const submitTitle = computed(() => blockReason.value || '生成后可预览、下载与重新生成')
/** 预计消耗：报不出价（未勾选 / 某图种无单价）显示「—」，不显示 0 */
const costText = computed(() => (estimatedCost.value == null ? '—' : estimatedCost.value.toLocaleString('zh-CN')))

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
  'h-32px inline-flex shrink-0 cursor-pointer items-center gap-6px border border-solid border-control rounded-full sx-grad-plate shadow-plate px-10px text-ink-2 no-underline ' +
  'transition-[border-color,background,color] duration-fast ease-sx motion-reduce:transition-none hover:(border-violet-line from-white to-violet-tint text-violet-ink)'
/** 面板卡（同电商功能页 Container / 工具页三栏）：r8、1px line、面板投影 */
const panelCls = 'bg-white rounded-lg border border-solid border-line shadow-panel'
/** 区块卡（spec §3 section 卡）：r8、1px line、v3 卡投影 */
const sectionCls = 'bg-white rounded-lg border border-solid border-line shadow-card-v3'
/** 卡头图标底板（工具页目录图标同款：135° 柔紫渐变 + 紫描边） */
const tileCls =
  'h-24px w-24px flex shrink-0 items-center justify-center box-border rounded-md border border-solid border-violet-soft-2 sx-grad-icon shadow-[inset_0_1px_0_#fff] text-violet-ink'
/** 小号次按钮（预览 / 重试 / 继续生成）：spec 默认按钮缩到 28 高 */
const smallBtn = 'sx-btn !h-28px !px-10px !text-12px transition-[border-color,background,color] duration-fast ease-sx'
const smallTintBtn =
  'sx-btn-tint !h-28px !px-10px !text-12px transition-[border-color,background,color] duration-fast ease-sx'
/** 状态徽标：spec chip 20 高、r3、11px */
const chipCls = 'sx-chip flex-shrink-0 border border-solid'
/** 四步条：已完成 = 柔紫打勾，当前 = 主色渐变，未到 = 灰 */
function stepState(index: number): 'done' | 'current' | 'todo' {
  if (index === stepCurrent.value) return 'current'
  return stepDone.value[index] ? 'done' : 'todo'
}
const trashIcon = ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12', 'M9 7V4h6v3']
</script>

<template>
  <n-config-provider :theme-overrides="llTheme" abstract>
    <div
      :class="[
        'h-full min-h-0 flex flex-col overflow-y-auto bg-page text-ink min-[1200px]:overflow-hidden',
        llFormSkin,
      ]"
    >
      <div class="min-w-0 flex flex-1 flex-col gap-16px p-16px min-[1200px]:(min-h-0 flex-row overflow-hidden)">
        <!-- 左：预览 / 历史 -->
        <aside
          :class="[panelCls, 'min-h-0 min-w-0 flex flex-col p-12px min-[1200px]:(w-384px shrink-0)']"
          aria-label="预览与历史"
        >
          <div
            class="grid grid-cols-2 shrink-0 gap-2px rounded-md bg-surface3 p-3px shadow-inset-input"
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
                'h-32px cursor-pointer rounded-sm border border-solid px-8px text-13px transition-[background,border-color,color] duration-mid ease-sx motion-reduce:transition-none',
                focusRing,
                activeTab === tab.key
                  ? 'sx-grad-tint border-violet-line font-600 text-violet-ink shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
                  : 'border-transparent bg-transparent font-500 text-muted hover:text-ink',
              ]"
              @click="activeTab = tab.key"
              @keydown="onTabKeydown($event, index)"
            >
              <span class="inline-flex items-center justify-center gap-4px">
                {{ tab.label }}
                <span
                  v-if="tab.key === 'history' && historyBadge"
                  class="min-w-16px rounded-full bg-violet-soft px-4px text-center text-11px font-500 leading-16px text-violet-ink font-mono tabular-nums"
                  :aria-label="`${historyBadge} 条`"
                  >{{ historyBadge }}</span
                >
              </span>
            </button>
          </div>

          <div class="relative min-h-0 min-w-0 flex flex-1 pt-12px">
            <div
              v-if="offline"
              role="alert"
              class="absolute left-1/2 top-12px z-10 flex items-center gap-12px whitespace-nowrap rounded-lg border border-solid border-danger-line bg-danger-soft px-12px py-6px text-12px leading-18px text-alert-danger shadow-toast -translate-x-1/2"
            >
              <span>网络异常，已暂停轮询</span>
              <button
                type="button"
                :class="['sx-btn-danger !h-28px !px-10px !text-12px', focusRing]"
                @click="fs.retryPolling"
              >
                重试
              </button>
            </div>
            <div
              v-show="activeTab === 'preview'"
              id="ll-side-preview"
              role="tabpanel"
              aria-labelledby="ll-side-tab-preview"
              class="min-h-0 min-w-0 flex flex-1 flex-col gap-8px overflow-y-auto"
            >
              <EntryPhone
                :profile="profile"
                :results="previewResults"
                :running="previewHistoryId == null && running"
                :closeup-names="previewCloseupNames"
              />
              <p
                v-if="previewHistoryId == null && runNotice"
                class="m-0 flex items-center justify-center gap-8px text-center text-12px leading-18px text-muted"
                role="status"
              >
                {{ runNotice }}
                <button type="button" :class="smallBtn" @click="activeTab = 'history'; fs.loadHistory()">
                  去历史刷新
                </button>
              </p>
              <p
                v-if="previewHistoryId == null && runFailed"
                class="m-0 text-center text-12px leading-18px text-danger"
                role="alert"
              >
                {{ STATUS_LABEL[run!.status] }}{{ run!.error ? `：${run!.error}` : '' }}
              </p>
              <button
                v-if="previewHistoryId != null && run"
                type="button"
                :class="[smallBtn, 'self-center']"
                @click="previewHistoryId = null"
              >
                预览
              </button>
            </div>
            <div
              v-show="activeTab === 'history'"
              id="ll-side-history"
              role="tabpanel"
              aria-labelledby="ll-side-tab-history"
              class="min-h-160px min-w-0 flex flex-1 flex-col gap-8px overflow-y-auto"
            >
              <n-spin :show="historyLoading" class="min-h-160px flex flex-1 flex-col">
                <div v-if="historyError" class="sx-empty min-h-160px flex-1" role="alert">
                  <span class="sx-empty-title !text-danger">加载失败</span>
                  <button type="button" :class="smallBtn" @click="fs.loadHistory()">重试</button>
                </div>
                <PageEmpty
                  v-else-if="!historyLoading && !history.length"
                  compact
                  text="还没有生成记录"
                  description="提交全案后，生成的图和计费明细会出现在这里。"
                />
                <ul v-else class="m-0 flex flex-col list-none gap-8px p-0" aria-label="生成记录">
                  <li
                    v-for="row in history"
                    :key="row.workflowHistoryId"
                    :class="[
                      'min-w-0 flex flex-col gap-6px border border-solid rounded-lg p-10px transition-[border-color,background,box-shadow] duration-mid ease-sx motion-reduce:transition-none',
                      previewHistoryId === row.workflowHistoryId
                        ? 'border-violet-line sx-grad-tint shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
                        : 'border-line bg-white hover:(border-violet-line shadow-raised)',
                    ]"
                  >
                    <div class="flex items-center gap-8px">
                      <span
                        :class="[
                          chipCls,
                          row.status === 'SUCCEED' || row.status === 'PARTIAL_SUCCEED'
                            ? 'll-chip-success'
                            : isLLTerminal(row.status)
                              ? 'll-chip-error'
                              : 'll-chip-running',
                        ]"
                      >
                        {{ STATUS_LABEL[row.status] ?? row.status }}
                      </span>
                      <span class="text-11px leading-16px text-muted font-mono tabular-nums">{{
                        formatTime(row.createdAt)
                      }}</span>
                      <span
                        v-if="historyPoints(row)"
                        class="ml-auto shrink-0 text-11px leading-16px text-ink-2 tabular-nums"
                        >{{ historyPoints(row) }}</span
                      >
                    </div>
                    <div class="truncate text-12px font-600 leading-18px text-ink" :title="historyTitle(row)">
                      {{ historyTitle(row) }}
                    </div>
                    <p
                      v-if="historyFailed(row)"
                      class="m-0 text-12px leading-18px text-danger"
                      role="note"
                    >
                      {{ row.error || '生成失败' }}
                    </p>
                    <div
                      v-if="historyThumbs(row).length"
                      class="flex gap-4px overflow-x-auto pb-2px [scrollbar-width:thin]"
                      role="group"
                      :aria-label="`${formatTime(row.createdAt)} 的生成结果`"
                    >
                      <button
                        v-for="(url, i) in historyThumbs(row)"
                        :key="url"
                        type="button"
                        :class="[
                          'h-56px w-56px shrink-0 cursor-pointer overflow-hidden rounded-sm border border-solid border-line-soft bg-sunken p-0',
                          focusRing,
                        ]"
                        :aria-label="`预览第 ${i + 1} 张`"
                        @click="showHistory(row.workflowHistoryId)"
                      >
                        <img :src="url" alt="" class="h-full w-full object-cover" loading="lazy" />
                      </button>
                    </div>
                    <div class="flex items-center gap-8px">
                      <button
                        v-if="row.status === 'SUCCEED'"
                        type="button"
                        :class="continueFrom?.historyId === row.workflowHistoryId ? smallTintBtn : smallBtn"
                        :aria-pressed="continueFrom?.historyId === row.workflowHistoryId"
                        @click="onContinue(row.workflowHistoryId)"
                      >
                        继续生成
                      </button>
                      <n-popconfirm
                        positive-text="删除"
                        negative-text="取消"
                        @positive-click="onDeleteHistory(row.workflowHistoryId)"
                      >
                        <template #trigger>
                          <IconButton
                            class="ml-auto"
                            size="sm"
                            variant="danger"
                            :label="isLLTerminal(row.status) ? '删除这条记录' : '生成中的记录不能删除'"
                            :disabled="!isLLTerminal(row.status)"
                            :loading="deletingHistoryId === row.workflowHistoryId"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="1.8"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                            >
                              <path v-for="d in trashIcon" :key="d" :d="d" />
                            </svg>
                          </IconButton>
                        </template>
                        删除后不可恢复，确认删除这条记录？
                      </n-popconfirm>
                    </div>
                  </li>
                </ul>
              </n-spin>
            </div>
          </div>
        </aside>

        <!-- 右：标题行 + 两张卡 + 底栏 -->
        <section class="min-h-0 min-w-0 flex flex-1 flex-col gap-16px" aria-label="全案配置">
          <header class="flex shrink-0 flex-wrap items-center justify-between gap-x-20px gap-y-8px pr-4px">
            <div class="min-w-0 flex items-center gap-10px">
              <h1 class="m-0 whitespace-nowrap sx-title-page">全案设计</h1>
              <button
                type="button"
                :class="[pill, focusRing, 'max-w-280px text-12px']"
                :aria-label="profile ? `品牌档案：${profile.title}（点击更换）` : '点击选择品牌档案'"
                @click="openProfilePicker"
              >
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6">
                  <path v-for="d in ICONS.image" :key="d" :d="d" />
                </svg>
                <span class="truncate">{{ profile?.title || '点击选择品牌档案' }}</span>
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2">
                  <path v-for="d in ICONS.chevron" :key="d" :d="d" />
                </svg>
              </button>
            </div>

            <ol class="m-0 flex shrink-0 list-none items-center justify-end p-0" aria-label="制作进度">
              <template v-for="(label, index) in STEP_LABELS" :key="label">
                <li
                  :class="[
                    'flex items-center gap-8px whitespace-nowrap text-12px leading-18px',
                    {
                      done: 'font-500 text-violet-ink',
                      current: 'font-600 text-ink',
                      todo: 'font-400 text-placeholder',
                    }[stepState(index)],
                  ]"
                  :aria-current="stepCurrent === index ? 'step' : undefined"
                >
                  <span
                    :class="[
                      'h-28px w-28px flex shrink-0 items-center justify-center box-border rounded-full border border-solid text-11px font-600 font-mono tabular-nums',
                      'transition-[background,border-color,color] duration-mid ease-sx motion-reduce:transition-none',
                      {
                        done: 'border-violet-line bg-violet-soft text-violet-ink',
                        current: 'sx-grad-primary border-violet-border text-white shadow-btn',
                        todo: 'border-line bg-surface2 text-placeholder',
                      }[stepState(index)],
                    ]"
                  >
                    <svg
                      v-if="stepState(index) === 'done'"
                      viewBox="0 0 24 24"
                      width="12"
                      height="12"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="3"
                      aria-hidden="true"
                    >
                      <path d="M5 12l5 5 9-10" />
                    </svg>
                    <template v-else>{{ index + 1 }}</template>
                  </span>
                  <span>{{ label }}<span v-if="stepState(index) === 'done'" class="sr-only">（已完成）</span></span>
                </li>
                <li
                  v-if="index < STEP_LABELS.length - 1"
                  :class="[
                    'mx-10px h-1px w-28px transition-colors duration-mid',
                    stepDone[index] ? 'bg-violet-line' : 'bg-line',
                  ]"
                  aria-hidden="true"
                />
              </template>
            </ol>
          </header>

          <div
            class="min-h-0 min-w-0 flex flex-1 flex-col gap-16px pr-2px min-[1200px]:(overflow-y-auto overscroll-contain)"
          >
            <!-- 卡 A：选择品牌档案 -->
            <section :class="[sectionCls, 'flex shrink-0 flex-col gap-12px p-16px']" aria-labelledby="ll-card-setup">
              <header class="min-w-0 flex items-center gap-8px">
                <span :class="tileCls" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6">
                    <path v-for="d in ICONS.sparkle" :key="d" :d="d" />
                  </svg>
                </span>
                <h2 id="ll-card-setup" class="m-0 sx-title-card">
                  <template v-if="profile">整体设计要求<em class="text-muted font-400 not-italic">（选填）</em></template>
                  <template v-else>选择品牌档案</template>
                </h2>
                <button
                  type="button"
                  :class="[
                    pill,
                    focusRing,
                    'ml-auto max-w-220px text-11px',
                    templates.length ? '!border-violet-line sx-grad-tint !text-violet-ink' : '',
                  ]"
                  :aria-label="
                    templates.length
                      ? `设计模板：${templates.map((t) => t.title).join('、')}（点击更换）`
                      : templateChipText
                  "
                  :title="templates.length ? templates.map((t) => t.title).join('、') : undefined"
                  @click="openTemplatePicker"
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6">
                    <path v-for="d in ICONS.albums" :key="d" :d="d" />
                  </svg>
                  <span class="truncate">{{ templateChipText }}</span>
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2">
                    <path v-for="d in ICONS.chevron" :key="d" :d="d" />
                  </svg>
                </button>
              </header>

              <n-spin :show="profileLoading">
                <button
                  v-if="!profile"
                  type="button"
                  :class="[
                    'h-56px w-full flex cursor-pointer items-center justify-center gap-8px rounded-lg border border-dashed border-line-strong sx-grad-upload',
                    'text-13px text-muted transition-[border-color,background,color] duration-mid ease-sx motion-reduce:transition-none',
                    'hover:(border-violet-line to-#fbf7fd text-violet-ink)',
                    focusRing,
                  ]"
                  @click="openProfilePicker"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    aria-hidden="true"
                  >
                    <path v-for="d in ICONS.image" :key="d" :d="d" />
                  </svg>
                  点击选择品牌档案
                </button>
                <div v-else class="flex flex-col gap-10px">
                  <button
                    type="button"
                    :class="[
                      'w-full flex cursor-pointer items-center gap-10px rounded-lg border border-solid border-violet-line sx-grad-tint px-12px py-10px text-left',
                      'transition-[border-color,box-shadow] duration-mid ease-sx motion-reduce:transition-none hover:shadow-raised',
                      focusRing,
                    ]"
                    :aria-label="`品牌档案：${profile.title}（点击更换）`"
                    @click="openProfilePicker"
                  >
                    <span
                      class="h-36px w-36px shrink-0 overflow-hidden rounded-md border border-solid border-line-soft bg-sunken"
                    >
                      <img v-if="profile.logoUrl" :src="profile.logoUrl" alt="" class="h-full w-full object-cover" />
                    </span>
                    <span class="min-w-0 flex flex-1 flex-col gap-2px">
                      <span class="truncate text-13px font-600 leading-20px text-ink">{{ profile.title }}</span>
                      <span class="text-11px leading-16px text-muted tabular-nums"
                        >设计素材 {{ profile.images.length }}</span
                      >
                    </span>
                    <svg
                      class="shrink-0 text-placeholder"
                      viewBox="0 0 24 24"
                      width="12"
                      height="12"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      aria-hidden="true"
                    >
                      <path v-for="d in ICONS.chevron" :key="d" :d="d" />
                    </svg>
                  </button>
                  <p
                    v-if="profileSource !== 'java'"
                    class="m-0 rounded-md border border-solid border-warning-line bg-warning-soft px-10px py-6px text-12px leading-18px text-alert-warning"
                    role="note"
                  >
                    全案生成需要使用品牌档案
                  </p>
                  <div
                    v-if="continueFrom"
                    class="flex items-center gap-8px rounded-md border border-solid border-violet-line bg-info-soft px-10px py-6px text-12px leading-18px text-alert-info"
                    role="status"
                  >
                    <span>继续生成 #{{ continueFrom.historyId }}</span>
                    <button
                      type="button"
                      :class="[
                        'ml-auto cursor-pointer rounded-sm border-none bg-transparent p-0 text-12px text-violet-ink underline underline-offset-3 transition-colors duration-fast hover:text-violet-press',
                        focusRing,
                      ]"
                      @click="cancelContinue"
                    >
                      取消
                    </button>
                  </div>
                  <p
                    v-if="continueFrom"
                    class="m-0 text-11px leading-16px text-placeholder"
                  >
                    继续生成沿用上一轮的整体设计要求与模板，下面的修改只用于新的全案
                  </p>
                  <div class="grid grid-cols-1 gap-14px md:grid-cols-2">
                    <label
                      v-for="field in [
                        {
                          key: 'requirement',
                          label: '总需求',
                          placeholder: '例如：夏季新品推广，整体清爽高级，突出新品套餐和到店优惠…',
                        },
                        {
                          key: 'style',
                          label: '风格需求',
                          placeholder: '对主题、色调等风格的描述，例如：国潮插画风，暖色调…',
                        },
                      ]"
                      :key="field.key"
                      class="min-w-0 flex flex-col gap-6px"
                    >
                      <span class="text-12px font-500 leading-18px text-ink-2">{{ field.label }}</span>
                      <span class="relative block">
                        <textarea
                          :value="field.key === 'requirement' ? requirement : styleRequirement"
                          :maxlength="REQUIREMENT_MAX_LENGTH"
                          rows="4"
                          :placeholder="field.placeholder"
                          :class="[
                            'box-border block h-120px w-full resize-none rounded-lg border border-solid border-control bg-white shadow-inset-input px-12px pb-24px pt-8px text-13px leading-[19.5px] text-ink outline-none [font-family:inherit]',
                            'transition-[border-color,box-shadow] duration-fast ease-sx motion-reduce:transition-none',
                            'placeholder:text-placeholder hover:border-control-hover focus:(border-violet shadow-focus)',
                          ]"
                          @input="onRequirementInput(field.key, $event)"
                        />
                        <em
                          class="pointer-events-none absolute bottom-4px right-10px text-10px text-placeholder not-italic leading-14px tabular-nums"
                        >
                          {{ (field.key === 'requirement' ? requirement : styleRequirement).length }}/{{
                            REQUIREMENT_MAX_LENGTH
                          }}
                        </em>
                      </span>
                    </label>
                  </div>
                </div>
              </n-spin>
            </section>

            <!-- 卡 B：本次内容 -->
            <section :class="[sectionCls, 'flex shrink-0 flex-col gap-12px p-16px']" aria-labelledby="ll-card-board">
              <header class="min-w-0 flex items-center gap-8px">
                <span :class="tileCls" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6">
                    <path v-for="d in ICONS.grid" :key="d" :d="d" />
                  </svg>
                </span>
                <h2 id="ll-card-board" class="m-0 sx-title-card">选择本次需要制作的内容</h2>
                <span
                  :class="[
                    'ml-auto inline-flex h-22px items-center rounded-full border border-solid px-10px text-11px tabular-nums',
                    selectedCount
                      ? 'border-violet-line bg-violet-soft text-violet-ink'
                      : 'border-line bg-surface3 text-muted',
                  ]"
                >
                  已选 {{ selectedCount }}/{{ SECTIONS.length }} 种
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
                  :selected="sections[section.key].selected"
                  :items="sections[section.key].items"
                  :disabled="running"
                  @toggle="toggleSection(section.key)"
                  @add="addItem(section.key)"
                  @remove="removeItem(section.key, $event)"
                  @content="(index, value) => setContent(section.key, index, value)"
                  @pick="openImagePicker(section.key, $event)"
                  @remove-image="(index, url) => removeImage(section.key, index, url)"
                />
              </div>
            </section>

            <!-- 原型没有这一块：原入口页的单项工具，路径不变 -->
            <section :class="[sectionCls, 'flex shrink-0 flex-col gap-12px p-16px']" aria-labelledby="ll-card-tools">
              <header class="flex flex-wrap items-baseline gap-x-8px gap-y-2px">
                <h2 id="ll-card-tools" class="m-0 sx-title-card">单项工具</h2>
                <span class="sx-hint">可从这里进入各模块逐个制作</span>
              </header>
              <div v-for="group in toolGroups" :key="group.title" class="flex flex-col gap-8px">
                <h3 class="m-0 sx-caption leading-16px">{{ group.title }}</h3>
                <ul class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-8px p-0">
                  <li v-for="item in group.items" :key="item.path" class="flex">
                    <RouterLink
                      :to="item.path"
                      :aria-label="`${item.title}：${item.desc}`"
                      :class="[
                        'group w-full flex items-center gap-8px rounded-lg border border-solid border-line bg-white px-12px py-10px no-underline',
                        'transition-[border-color,box-shadow] duration-mid ease-[ease] motion-reduce:transition-none hover:(border-violet-line shadow-raised-hover)',
                        focusRing,
                      ]"
                    >
                      <span class="min-w-0 flex flex-1 flex-col gap-2px">
                        <span class="truncate text-13px font-600 leading-20px text-ink">{{ item.title }}</span>
                        <span class="truncate text-11px leading-16px text-muted">{{ item.desc }}</span>
                      </span>
                      <svg
                        class="shrink-0 text-placeholder transition-colors duration-fast group-hover:text-violet-ink"
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
          <footer :class="[panelCls, 'flex shrink-0 items-center justify-between gap-16px px-16px py-12px']">
            <div class="min-w-0 flex items-center gap-8px text-muted">
              <span class="text-12px leading-18px text-muted">预计消耗</span>
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
              <b
                class="text-16px font-600 leading-22px text-ink font-mono tabular-nums"
                :title="
                  estimatedCost == null
                    ? '勾选图种并添加内容后显示预计消耗'
                    : estimateIsMinimum
                      ? '继续生成沿用上一轮的版数，这里按 1 版估算，实际以扣点为准'
                      : undefined
                "
                >{{ costText }}</b
              >
              <span class="text-12px leading-18px text-muted">点数{{ estimateIsMinimum && estimatedCost != null ? '起' : '' }}</span>
              <n-tooltip :show="billingTipShow" placement="top">
                <template #trigger>
                  <button
                    type="button"
                    :class="[
                      'h-24px w-24px flex cursor-pointer items-center justify-center rounded-full border-none bg-transparent p-0 text-placeholder transition-colors duration-fast hover:text-violet-ink sx-hit',
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
                <span class="max-w-280px flex flex-col gap-2px text-12px">
                  <b>计费明细</b>
                  <span v-if="!costLines.length">勾选图种并添加内容后显示</span>
                  <template v-else>
                    <span v-for="line in costLines" :key="line.key" class="tabular-nums">
                      <template v-if="line.unit != null">
                        {{ line.title }} ×{{ line.count }}（{{ line.unit }} 点数/张）= {{ line.unit * line.count }} 点数
                      </template>
                      <template v-else>{{ line.title }} ×{{ line.count }}：暂无单价</template>
                    </span>
                    <span class="mt-2px font-600 tabular-nums">
                      {{
                        estimatedCost == null
                          ? '共 — 点数（部分图种暂无单价）'
                          : `共 ${costText} 点数${estimateIsMinimum ? '起' : ''}`
                      }}
                    </span>
                    <span v-if="estimateIsMinimum">继续生成沿用上一轮的版数，这里按 1 版估算，实际以扣点为准</span>
                  </template>
                  <em v-if="blockReason" class="mt-2px text-[#ff7b72] not-italic">{{ blockReason }}</em>
                </span>
              </n-tooltip>
            </div>

            <button
              type="button"
              :disabled="submitDisabled"
              :aria-busy="submitting || running"
              :title="submitTitle"
              :class="[
                'sx-btn-primary shrink-0 !h-44px !px-40px !rounded-xl !text-14px',
                'transition-[background,border-color,box-shadow,color] duration-fast ease-sx motion-reduce:transition-none',
              ]"
              @click="fs.submit"
            >
              {{ submitLabel }}
            </button>
          </footer>
        </section>
      </div>
    </div>

    <ProfilePicker
      v-model:show="profilePickerShow"
      :profiles="profiles"
      :loading="profilesLoading"
      :error="profilesError"
      :current-id="profile?.id"
      :source="profileSource"
      @select="onSelectProfile"
      @retry="fs.loadProfiles"
    />
    <TemplatePicker
      v-model:show="templatePickerShow"
      :system-templates="systemTemplates"
      :user-templates="userTemplates"
      :loading="templatesLoading"
      :error="templatesError"
      :current="templates"
      :profile-name="profile?.title"
      @confirm="onConfirmTemplates"
      @retry="fs.loadTemplates"
    />
    <ProfileImagePicker
      v-model:show="imagePicker.show"
      :images="profile?.images ?? []"
      :selected="imagePickerSelected"
      :max="imagePickerMax"
      :section-title="imagePickerTitle"
      :profile-name="profile?.title ?? ''"
      @confirm="onImagesPicked"
    />
  </n-config-provider>
</template>
