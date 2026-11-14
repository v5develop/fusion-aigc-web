<script setup lang="ts">
/**
 * 节点内容推荐条（EXPERIENCE 7 节 / V-03）：头条 Tab 顶部，有节点才显示、没有不占位；**仅内容推荐，没有任何优惠 / 折扣 / 赠送**。
 * - 服务端只给「节点前 14 天内、该行业有可用模板」的节点（严格当前行业），这里同一时刻只展示 1 个（最近、且未被关闭的）；
 * - 可关闭（×）：同一节点关闭后 7 天不再出现，按账号记在 localStorage（key 前缀登记在 auth-session 的
 *   ACCOUNT_KEYED_PREFIXES，换号清缓存时保留；账号没认出来前记在 anon 下）；
 * - 「看节点模板」展开该节点的模板小卡，点小卡 = 开预览（与卡片同一条路径）；
 * - 失败 / 没有节点 / 全被关闭：都不渲染、不打扰。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { plazaNodes, type IPlazaNode, type IPlazaTemplate } from '@/api/plaza.ts'
import { currentAccountId, onAccountChange } from '@/utils/auth-session.ts'
import { coverOf } from './templateMedia.ts'

const props = defineProps<{ industry: string; industryName: string }>()
const emit = defineEmits<{
  /** 节点模板（给预览的上一个 / 下一个用）；没有展示的节点传空数组 */
  loaded: [items: IPlazaTemplate[]]
  open: [item: IPlazaTemplate]
}>()

/** 与 auth-session.ts 的 ACCOUNT_KEYED_PREFIXES 里登记的前缀保持一致 */
const NODE_DISMISS_KEY_PREFIX = 'xq-plaza-node-dismiss:'
const DISMISS_MS = 7 * 24 * 3600 * 1000

function storeKey(): string {
  return `${NODE_DISMISS_KEY_PREFIX}${currentAccountId() || 'anon'}`
}
function readDismissed(now = Date.now()): Record<string, number> {
  try {
    const raw = localStorage.getItem(storeKey())
    const m = raw ? (JSON.parse(raw) as Record<string, number>) : {}
    const out: Record<string, number> = {}
    for (const [k, until] of Object.entries(m)) if (typeof until === 'number' && until > now) out[k] = until // 顺手丢掉过期的
    return out
  } catch {
    return {}
  }
}
function writeDismissed(m: Record<string, number>) {
  try {
    localStorage.setItem(storeKey(), JSON.stringify(m))
  } catch {
    // 无痕 / 禁用存储：只在本次页面里有效（dismissed 内存态）
  }
}

const nodes = ref<IPlazaNode[]>([])
const dismissed = ref<Record<string, number>>(readDismissed())
const expanded = ref(false)
let seq = 0

const offAccount = onAccountChange(() => (dismissed.value = readDismissed()))
onBeforeUnmount(offAccount)

watch(
  () => props.industry,
  async (ind) => {
    const s = ++seq
    nodes.value = []
    expanded.value = false
    if (!ind) return
    try {
      const res = await plazaNodes({ industry: ind }) // 选了二级仍显示整个行业的
      if (s === seq) nodes.value = res.data?.items ?? []
    } catch {
      // 失败当没有节点：不打扰、不占位
    }
  },
  { immediate: true },
)

const node = computed<IPlazaNode | null>(() => {
  const now = Date.now()
  return nodes.value.find((n) => !((dismissed.value[n.code] ?? 0) > now) && n.templates.length > 0) ?? null
})
watch(
  node,
  (n) => emit('loaded', n?.templates ?? []),
  { immediate: true },
)

const headline = computed(() => {
  const n = node.value
  if (!n) return ''
  if (n.daysLeft <= 0) return `今天是「${n.name}」，${props.industryName}这些模板正在涨`
  return `距「${n.name}」还有 ${n.daysLeft} 天，${props.industryName}这些模板正在涨`
})

function dismiss() {
  const n = node.value
  if (!n) return
  const next = { ...readDismissed(), [n.code]: Date.now() + DISMISS_MS }
  dismissed.value = next
  expanded.value = false
  writeDismissed(next)
}

const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'
</script>

<template>
  <section
    v-if="node"
    :aria-label="`${node.name}推荐`"
    class="sx-squircle mb-14px flex flex-col gap-8px rounded-14px border border-solid border-violet-line bg-violet-tint px-12px py-10px"
    data-testid="plaza-node-strip"
  >
    <div class="flex items-center gap-10px">
      <p class="m-0 min-w-0 flex-1 text-13px font-500 leading-20px text-ink">
        {{ headline }}<template v-if="node.why"><span class="text-muted"> · {{ node.why }}</span></template>
      </p>
      <button
        type="button"
        class="sx-soft-btn flex-none"
        :aria-expanded="expanded"
        data-testid="plaza-node-toggle"
        @click="expanded = !expanded"
      >
        {{ expanded ? '收起' : '看节点模板' }}
      </button>
      <button
        type="button"
        class="relative grid h-28px w-28px flex-none place-items-center rounded-full border-0 bg-transparent text-placeholder cursor-pointer hover:text-ink after:(absolute -inset-8px content-[''])"
        :class="FOCUS"
        :aria-label="`关闭${node.name}推荐，7 天内不再出现`"
        data-testid="plaza-node-dismiss"
        @click="dismiss"
      >
        <svg class="h-14px w-14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
    <ul v-if="expanded" class="m-0 flex list-none gap-8px overflow-x-auto p-0 pb-2px">
      <li v-for="t in node.templates" :key="t.plazaTemplateId" class="flex-none">
        <button
          type="button"
          class="flex h-64px w-188px items-center gap-8px rounded-12px border border-solid border-soft-line bg-surface p-4px pr-10px text-left cursor-pointer hover:(border-violet-line bg-violet-tint)"
          :class="FOCUS"
          :aria-label="`${t.title}，点击查看`"
          @click="emit('open', t)"
        >
          <img v-if="coverOf(t)" :src="coverOf(t)" alt="" class="h-56px w-56px flex-none rounded-8px bg-surface3 object-cover" aria-hidden="true" />
          <span v-else class="h-56px w-56px flex-none rounded-8px bg-surface3" aria-hidden="true" />
          <span class="line-clamp-2 min-w-0 flex-1 text-12px font-600 leading-18px text-ink">{{ t.title }}</span>
        </button>
      </li>
    </ul>
  </section>
</template>
