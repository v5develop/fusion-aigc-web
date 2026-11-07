<script setup lang="ts">
/**
 * 提示词库浮层（原型 PromptLibraryFlyout：宽 400 的锚定面板，不是整屏弹窗）。
 *
 * <p>数据走 Go 网关 /api/v1/prompt-library（官方电商 / 官方通用 / 我的 三个域），
 * 搜索 + 适用模型 chips + 分组 chips 过滤；点卡片把整条提示词交给页面插入输入框。
 * Esc / 点外部关闭；出现 / 消失带 120ms 位移过渡。加载失败给一条可重试的空态。
 *
 * <p>定位：调用方用 `anchor` 传触发按钮元素，面板吸附其下方、右缘对齐（超出视口左移）；
 * 不传 anchor 时屏幕居中。
 *
 * <p>根节点带 data-canvas-popover + tabindex=-1：画布页的全局快捷键（Backspace / Delete / Esc / Ctrl+C …）
 * 遇到焦点在浮层里就让给浮层；点到面板里的非控件区域时焦点落在面板本身，不会掉回 body 被画布当成操作选中节点。
 */
import IconButton from '@/components/IconButton/index.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { promptLibList, type IPromptLibItem } from '@/api/promptLibrary.ts'

const show = defineModel<boolean>('show', { default: false })

const emit = defineEmits<{
  /** 点了某条提示词：页面决定怎么插入 */
  select: [item: IPromptLibItem]
}>()

const props = defineProps<{
  /** 触发按钮元素（打开它的那个节点），面板按它定位；点它不算「点外部」 */
  anchor?: HTMLElement | null
  /** 面板标题（画布里叫「提示词库」）；不传沿用「我的提示词」 */
  heading?: string
  /** 计数脚显示「公共 N 条 · 我的 M 条」（各域总数取自已拉过的无筛选结果，没拉过的域不猜） */
  showCounts?: boolean
}>()

const panelRef = ref<HTMLElement>()
/** 无锚点时屏幕居中 */
const CENTERED = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
const panelStyle = ref<Record<string, string>>(CENTERED)

// ---------- 过滤 ----------
const VERTICALS = [
  { key: 'ecommerce', label: '官方电商' },
  { key: 'general', label: '官方通用' },
  { key: 'mine', label: '我的' },
] as const
const MODELS = ['全部', '通用', 'GPT', 'Banana', 'Seedream'] as const

const vertical = ref<string>('ecommerce')
const model = ref<string>('全部')
const group = ref<string>('')
const q = ref<string>('')

/** 各域在不带模型 / 分组 / 搜索条件时的总条数（切到哪个域就记下哪个，面板常驻不丢） */
const domainTotals = ref<Record<string, number>>({})
const countsText = computed(() => {
  const t = domainTotals.value
  const parts: string[] = []
  if (t.ecommerce != null && t.general != null) parts.push(`公共 ${t.ecommerce + t.general} 条`)
  if (t.mine != null) parts.push(`我的 ${t.mine} 条`)
  return parts.join(' · ')
})

const items = ref<IPromptLibItem[]>([])
const total = ref(0)
const loading = ref(false)
const loadError = ref(false)
let seq = 0

/**
 * 分组选项：接口没有单独的分组列表，按域缓存「没按分组筛时」拉到过的分组（只增不减，组件常驻、关掉再开仍在）。
 * 不从当前结果现算——选中一个分组后结果只剩这一组，其余分组按钮会跟着消失、没法切回或换组。
 */
const groupCache = ref<Record<string, string[]>>({})
const groups = computed(() => {
  const list = [...(groupCache.value[vertical.value] ?? [])]
  if (group.value && !list.includes(group.value)) list.push(group.value)
  return list
})
function rememberGroups(v: string, list: IPromptLibItem[]) {
  const known = groupCache.value[v] ?? []
  const fresh = list.map((it) => it.group).filter((g, i, arr) => !!g && !known.includes(g) && arr.indexOf(g) === i)
  if (fresh.length) groupCache.value = { ...groupCache.value, [v]: [...known, ...fresh] }
}

function currentParams() {
  return {
    vertical: vertical.value,
    model: model.value === '全部' ? undefined : model.value,
    group: group.value || undefined,
    q: q.value.trim() || undefined,
    page: 1,
    page_size: 50,
  }
}
/** 最近一次发出的查询条件：筛选监听只在条件真的变了时才重拉（打开面板时已拉过同一组条件） */
let lastKey = ''

async function load() {
  const ticket = ++seq
  const params = currentParams()
  lastKey = JSON.stringify(params)
  loading.value = true
  loadError.value = false
  try {
    const res = await promptLibList(params)
    if (ticket !== seq) return
    items.value = res.data?.items ?? []
    total.value = res.data?.total ?? 0
    if (!params.group) rememberGroups(params.vertical, items.value)
    if (!params.group && !params.model && !params.q) {
      domainTotals.value = { ...domainTotals.value, [params.vertical]: total.value }
    }
  } catch {
    if (ticket !== seq) return
    // 业务失败原因由拦截器统一提示；这里只把列表置为可重试的空态
    loadError.value = true
    items.value = []
    total.value = 0
  } finally {
    if (ticket === seq) loading.value = false
  }
}

// 换域 / 换模型：分组复位（复位本身会再触发一次，由 lastKey 去重）；分组 / 搜索变化直接按新条件重拉
watch([vertical, model], () => {
  group.value = ''
})
watch([vertical, model, group, () => q.value.trim()], () => {
  if (!show.value) return
  if (JSON.stringify(currentParams()) === lastKey) return
  void load()
})
watch(show, (open) => {
  if (open) {
    group.value = ''
    q.value = ''
    void load()
    place()
    requestAnimationFrame(place)
  }
})

// ---------- 定位 / 关闭 ----------
function place() {
  const el = props.anchor
  if (!el) {
    panelStyle.value = CENTERED
    return
  }
  const r = el.getBoundingClientRect()
  const width = 400
  // 面板高度按 62vh 估（与 max-h 同口径）：top 夹住下沿，保证整块都在视口内
  const estH = Math.min(480, window.innerHeight * 0.62)
  const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8))
  const top = Math.max(8, Math.min(r.bottom + 8, window.innerHeight - estH - 8))
  panelStyle.value = { left: `${left}px`, top: `${top}px` }
}

function onDocPointerDown(e: PointerEvent) {
  if (!show.value) return
  const target = e.target as Node
  if (panelRef.value?.contains(target)) return
  if (props.anchor?.contains(target)) return
  show.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && show.value) {
    e.preventDefault()
    show.value = false
    props.anchor?.focus()
  }
}

function pick(item: IPromptLibItem) {
  emit('select', item)
  show.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown, true)
  window.addEventListener('resize', place)
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  window.removeEventListener('resize', place)
  window.removeEventListener('keydown', onKeydown)
})

</script>

<template>
      <div
        v-if="show"
        ref="panelRef"
        class="fixed z-[6000] flex flex-col box-border outline-none overflow-hidden w-400px max-w-[calc(100vw-16px)] max-h-[min(480px,62vh)] rounded-18px border border-solid border-line bg-white shadow-[0_12px_24px_rgba(31,35,41,0.14),0_2px_6px_rgba(31,35,41,0.06)]"
        :style="panelStyle"
        role="dialog"
        :aria-label="heading || '我的提示词'"
        tabindex="-1"
        data-canvas-popover
      >
        <!-- 头：标题 + 关闭 -->
        <div class="flex-none flex items-center gap-8px h-44px pl-14px pr-8px shadow-[inset_0_-0.8px_0_#e5e7eb]">
          <b class="min-w-0 flex-1 text-13px font-600 text-ink">{{ heading || '我的提示词' }}</b>
          <IconButton label="关闭提示词库" variant="quiet"  @click="show = false">
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
</IconButton>
        </div>

        <!-- 域页签（官方电商 / 官方通用 / 我的） -->
        <div class="flex-none flex gap-2px p-6px pb-0" role="tablist" aria-label="提示词库域">
          <button
            v-for="v in VERTICALS"
            :key="v.key"
            type="button"
            role="tab"
            :aria-selected="vertical === v.key"
            class="h-30px flex-1 rounded-6px border border-solid text-12px cursor-pointer [transition:background_180ms,border-color_180ms,color_180ms] motion-reduce:transition-none"
            :class="
              vertical === v.key
                ? 'border-violet-line bg-[linear-gradient(180deg,#fff_0%,#f8f3fc_100%)] font-600 text-violet-ink shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
                : 'border-transparent bg-transparent text-muted hover:(bg-surface3 text-ink)'
            "
            @click="vertical = v.key"
          >
            {{ v.label }}
          </button>
        </div>

        <!-- 搜索 + 模型 chips -->
        <div class="flex-none flex flex-col gap-6px p-6px pb-0">
          <div class="relative">
            <svg
              class="absolute left-10px top-8.5px h-13px w-13px text-placeholder pointer-events-none"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="6.5" />
              <path d="m20 20-4.2-4.2" />
            </svg>
            <input
              v-model="q"
              type="search"
              placeholder="搜索提示词"
              aria-label="搜索提示词"
              class="w-full h-30px box-border rounded-15px border border-solid border-#c9cfd6 bg-white pl-27px pr-8px text-12px text-ink outline-none shadow-[inset_0_1px_2px_rgba(31,35,41,0.055),inset_0_0_0_1px_rgba(255,255,255,0.7)] [transition:border-color_110ms,box-shadow_110ms] hover:border-#aeb6bf focus:(border-violet shadow-[0_0_0_3px_rgba(135,95,154,0.14)]) placeholder:text-placeholder"
            />
          </div>
          <div class="flex flex-wrap gap-4px" role="group" aria-label="适用模型">
            <button
              v-for="m in MODELS"
              :key="m"
              type="button"
              :aria-pressed="model === m"
              class="h-28px box-border px-12px rounded-full border border-solid text-12px leading-26px cursor-pointer [transition:background_140ms,border-color_140ms,color_140ms] motion-reduce:transition-none"
              :class="
                model === m
                  ? 'border-violet-line bg-[linear-gradient(180deg,#fff_0%,#f8f3fc_100%)] font-600 text-violet-ink'
                  : 'border-line bg-white text-muted hover:(border-#c9cfd6 text-ink)'
              "
              @click="model = m"
            >
              {{ m }}
            </button>
          </div>
          <div v-if="groups.length" class="flex flex-wrap gap-4px" role="group" aria-label="分组">
            <button
              v-for="g in groups"
              :key="g"
              type="button"
              :aria-pressed="group === g"
              class="h-28px box-border px-12px rounded-full border border-solid text-12px leading-26px cursor-pointer [transition:background_140ms,border-color_140ms,color_140ms] motion-reduce:transition-none"
              :class="
                group === g
                  ? 'border-violet-line bg-[linear-gradient(180deg,#fff_0%,#f8f3fc_100%)] font-600 text-violet-ink'
                  : 'border-line bg-white text-muted hover:(border-#c9cfd6 text-ink)'
              "
              @click="group = group === g ? '' : g"
            >
              {{ g }}
            </button>
          </div>
        </div>

        <!-- 列表 -->
        <div class="flex-1 min-h-0 overflow-y-auto p-6px pt-6px [scrollbar-width:thin]">
          <p v-if="loading" class="m-0 py-18px text-center text-11px text-muted" role="status">加载中…</p>
          <div v-else-if="loadError" class="flex flex-col items-center gap-6px py-18px">
            <span class="text-11px text-muted">提示词库暂时读不到</span>
            <button type="button" class="h-32px px-14px rounded-14px border border-solid border-line bg-white text-13px text-ink-2 cursor-pointer hover:border-#c9cfd6" @click="load()">
              重试
            </button>
          </div>
          <p v-else-if="!items.length" class="m-0 py-18px text-center text-11px text-muted">
            {{ vertical === 'mine' ? '还没有我的提示词，去提示词库页添加' : '这个域下暂时没有提示词' }}
          </p>
          <ul v-else class="m-0 p-0 list-none flex flex-col gap-4px">
            <li v-for="item in items" :key="item.id">
              <button
                type="button"
                class="w-full box-border flex flex-col gap-3px items-stretch p-8px rounded-10px border border-solid border-transparent bg-transparent text-left cursor-pointer hover:(border-line bg-surface2) sx-focus"
                :title="item.prompt"
                @click="pick(item)"
              >
                <span class="flex items-center gap-6px min-w-0">
                  <b class="min-w-0 flex-1 truncate text-13px font-600 text-ink">{{ item.title }}</b>
                  <span
                    v-for="m in item.models.slice(0, 2)"
                    :key="m"
                    class="flex-none h-16px px-5px rounded-full bg-surface3 text-11px leading-16px text-muted"
                    >{{ m }}</span
                  >
                </span>
                <span class="line-clamp-2 text-11px leading-[1.45] text-muted">{{ item.prompt }}</span>
              </button>
            </li>
          </ul>
        </div>

        <!-- 计数脚 -->
        <div class="flex-none flex items-center h-26px px-12px text-11px text-placeholder tabular-nums shadow-[inset_0_0.8px_0_#eff1f3]">
          <template v-if="showCounts && countsText">{{ countsText }} · 点击卡片填入</template>
          <template v-else>共 {{ total }} 条 · 点击卡片填入提示词</template>
        </div>
      </div>
</template>
