<script setup lang="ts">
/**
 * 资产详情弹层（2026-11-11 重排：媒体优先 + 右栏层级）。
 *
 *   ┌──────────────────────────────┬──────────────────────┐
 *   │ [校色后|原图|对比][保存新版本]  │ 标题 ✎          ☆  ✕ │
 *   │              [校色调整][⤢]   │ 日期 · 来源 · 分类      │
 *   │ ‹          大图（contain）   › │ [下载 ▾][用于画布][⋯] │
 *   │                              │ [详情 | 版本 N | 相关 N]│
 *   │        ( 原图 | 版本1 … )     │  页签内容（独立滚动）   │
 *   └──────────────────────────────┴──────────────────────┘
 *   ≤900px：舞台在上、右栏在下。
 *
 * <p>modelValue 为资产 id，null = 关闭；点相关资产 / 生成结果的缩略图会换 id 重载。
 * hasPrev / hasNext 由列表页给出：舞台两侧的翻页钮与键盘 ← / → 发 prev / next，列表页负责跨页。
 * 状态与写操作全部在 detail/context.ts（provide 给子组件）；页签记在 sessionStorage，翻页不重置页签与滚动。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { NModal } from 'naive-ui'
import IconButton from '@/components/IconButton/index.vue'
import { ColorFixFullscreen, ColorFixResultPanel } from '@/components/ColorFix'
import { createAssetDetail, provideAssetDetail, type DetailTab } from './detail/context.ts'
import DetailStage from './detail/DetailStage.vue'
import DetailHeader from './detail/DetailHeader.vue'
import DetailInfoTab from './detail/DetailInfoTab.vue'
import DetailVersionsTab from './detail/DetailVersionsTab.vue'
import DetailRelatedTab from './detail/DetailRelatedTab.vue'

const assetId = defineModel<number | null>({ required: true })

const props = withDefaults(
  defineProps<{
    hasPrev?: boolean
    hasNext?: boolean
    /** 删除预留位：列表页传 true 并监听 delete（二次确认由列表页弹）；本组件不自己删 */
    canDelete?: boolean
    /** 不可删时「⋯」里的删除置灰并显示原因；空且不可删则不显示 */
    deleteDisabledReason?: string
  }>(),
  { hasPrev: false, hasNext: false, canDelete: false, deleteDisabledReason: '' },
)

const emit = defineEmits<{ changed: []; prev: []; next: []; delete: [id: number] }>()

const d = createAssetDetail(assetId, props, (e: 'changed' | 'delete', id?: number) => {
  if (e === 'delete') emit('delete', id as number)
  else emit('changed')
})
provideAssetDetail(d)
const { cf } = d

const show = computed({
  get: () => assetId.value !== null,
  set: (v: boolean) => {
    if (!v) assetId.value = null
  },
})

// ---------------- 页签（本次会话记住上次选的） ----------------

const TAB_KEY = 'asset-detail:tab'
function readTab(): DetailTab {
  try {
    const v = sessionStorage.getItem(TAB_KEY)
    return v === 'versions' || v === 'related' ? v : 'info'
  } catch {
    return 'info'
  }
}
const tab = ref<DetailTab>(readTab())
watch(tab, (v) => {
  try {
    sessionStorage.setItem(TAB_KEY, v)
  } catch {
    /* 隐私模式：只在本次弹层内记住 */
  }
})
const tabs = computed(() => [
  { key: 'info' as const, label: '详情', count: null },
  { key: 'versions' as const, label: '版本', count: d.versions.value.total },
  { key: 'related' as const, label: '相关', count: d.related.value.total + d.generatedResults.value.total },
])
const tabRefs = ref<HTMLElement[]>([])
function onTabKey(e: KeyboardEvent, i: number) {
  const n = tabs.value.length
  let next = -1
  if (e.key === 'ArrowRight') next = (i + 1) % n
  else if (e.key === 'ArrowLeft') next = (i - 1 + n) % n
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = n - 1
  if (next < 0) return
  e.preventDefault()
  e.stopPropagation() // 不触发弹层的上一个 / 下一个
  tab.value = tabs.value[next]!.key
  void nextTick(() => tabRefs.value[next]?.focus())
}

// ---------------- 键盘：← / → 翻上一个 / 下一个 ----------------

const lightboxOpen = ref(false)

/** 正在输入 / 操作媒体时方向键留给控件本身 */
function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el || !el.tagName) return false
  if (el.isContentEditable) return true
  return (
    ['INPUT', 'TEXTAREA', 'SELECT', 'VIDEO', 'AUDIO'].includes(el.tagName) ||
    !!el.closest('.n-base-selection') ||
    el.getAttribute('role') === 'tab' ||
    el.getAttribute('role') === 'slider'
  )
}
function onKeydown(e: KeyboardEvent) {
  if (!show.value || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
  if (d.versionAssetShow.value || lightboxOpen.value || cf.fullscreen.value) return
  if (isEditableTarget(e.target)) return
  // F：全屏调色（全屏层里的 F / Esc 退出由 ColorFixFullscreen 处理）
  if ((e.key === 'f' || e.key === 'F') && d.canColorFix.value && !cf.painterOpen.value && !cf.pointOpen.value) {
    e.preventDefault()
    cf.openFullscreen()
    return
  }
  // 校色参数台 / 涂抹弹窗开着：方向键留给它们
  if (cf.panelOpen.value || cf.painterOpen.value) return
  if (e.key === 'ArrowLeft' && props.hasPrev) {
    e.preventDefault()
    emit('prev')
  } else if (e.key === 'ArrowRight' && props.hasNext) {
    e.preventDefault()
    emit('next')
  }
}
watch(
  () => assetId.value !== null,
  (open) => {
    if (open) window.addEventListener('keydown', onKeydown)
    else {
      window.removeEventListener('keydown', onKeydown)
      lightboxOpen.value = false
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <n-modal v-model:show="show" :auto-focus="false" transform-origin="center" :close-on-esc="!lightboxOpen">
    <section
      class="asset-dlg relative overflow-hidden bg-white sx-squircle rounded-18px border border-solid border-line shadow-[0_24px_64px_rgba(31,35,41,0.22)]"
      role="dialog"
      aria-modal="true"
      :aria-label="d.asset.value ? `资产详情：${d.asset.value.title || '未命名资产'}` : '资产详情'"
    >
      <!-- 关闭：弹层右上角（主流看图弹层的位置）；窄屏压在舞台右上 -->
      <IconButton label="关闭（Esc）" variant="quiet" class="asset-dlg-close !absolute right-16px top-18px z-10" @click="show = false">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </IconButton>

      <!-- 校色参数台：绝对定位压在右栏上，不挡大图 -->
      <ColorFixResultPanel v-if="d.asset.value" :cf="cf" title="资产校色" />
      <!-- 全屏调色：同一份 cf，查看方式与舞台共用 fixMode -->
      <ColorFixFullscreen v-if="d.asset.value" v-model:mode="d.fixMode.value" :cf="cf" title="资产校色">
        <template #actions>
          <button
            type="button"
            class="sx-btn-primary !h-32px !px-14px !text-13px"
            :disabled="d.savingColorFix.value || !cf.active.value"
            :aria-busy="d.savingColorFix.value || undefined"
            title="把当前校色效果另存为这个资产的新版本，原图不会被覆盖"
            @click="d.saveFixVersion"
          >
            {{ d.savingColorFix.value ? '保存中…' : '保存为新版本' }}
          </button>
        </template>
      </ColorFixFullscreen>

      <DetailStage
        v-model:lightbox="lightboxOpen"
        class="asset-dlg-stage"
        :has-prev="hasPrev"
        :has-next="hasNext"
        @prev="emit('prev')"
        @next="emit('next')"
      />

      <aside class="asset-dlg-panel min-w-0 min-h-0 flex flex-col border-l border-l-solid border-line-soft bg-white">
        <template v-if="d.asset.value">
          <DetailHeader />
          <div
            role="tablist"
            aria-label="资产信息"
            class="shrink-0 mx-20px mb-2px grid grid-cols-3 gap-2px p-3px rounded-14px bg-surface3 border border-solid border-line-soft"
          >
            <button
              v-for="(t, i) in tabs"
              :id="`asset-tab-${t.key}`"
              :key="t.key"
              ref="tabRefs"
              type="button"
              role="tab"
              :aria-selected="tab === t.key"
              :aria-controls="`asset-tabpanel-${t.key}`"
              :tabindex="tab === t.key ? 0 : -1"
              class="inline-flex items-center justify-center gap-4px h-32px rounded-11px border border-solid text-13px cursor-pointer select-none sx-focus [transition:background_140ms,color_140ms] motion-reduce:transition-none"
              :class="
                tab === t.key
                  ? 'bg-white border-line text-ink font-600 shadow-[0_1px_2px_rgba(31,35,41,0.08)]'
                  : 'bg-transparent border-transparent text-muted hover:text-ink'
              "
              @click="tab = t.key"
              @keydown="onTabKey($event, i)"
            >
              {{ t.label }}
              <span v-if="t.count" class="text-12px tabular-nums" :class="tab === t.key ? 'text-violet-ink' : 'text-placeholder'">{{
                t.count
              }}</span>
            </button>
          </div>
          <div
            :id="`asset-tabpanel-${tab}`"
            role="tabpanel"
            :aria-labelledby="`asset-tab-${tab}`"
            tabindex="0"
            class="flex-1 min-h-0 overflow-y-auto overscroll-contain px-20px pt-16px pb-24px outline-none"
            :class="d.loading.value && 'opacity-70 transition-opacity'"
            :aria-busy="d.loading.value || undefined"
          >
            <DetailInfoTab v-if="tab === 'info'" />
            <DetailVersionsTab v-else-if="tab === 'versions'" />
            <DetailRelatedTab v-else />
          </div>
        </template>
        <div v-else class="flex-1 grid place-items-center text-13px text-placeholder">加载中…</div>
      </aside>
    </section>
  </n-modal>
</template>

<style scoped lang="less">
.asset-dlg {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 384px;
  width: min(1120px, 94vw);
  height: min(720px, 90vh);
  animation: asset-dlg-in 0.26s cubic-bezier(0.22, 0.61, 0.36, 1) both;
}
.asset-dlg-stage {
  height: 100%;
}
@media (max-width: 900px) {
  .asset-dlg {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(220px, 42%) minmax(0, 1fr);
    height: min(860px, 92vh);
  }
  .asset-dlg-panel {
    border-left: none;
    border-top: 1px solid var(--xq-line-soft);
  }
  .asset-dlg-close {
    top: 12px !important;
    right: 12px !important;
  }
}
/* 窄屏关闭钮压在舞台上：换成毛玻璃底 */
@media (max-width: 900px) {
  .asset-dlg-close {
    background: rgb(var(--xq-surface-rgb) / 0.9) !important;
    border-color: var(--xq-glass-line) !important;
    box-shadow: 0 1px 3px rgba(31, 35, 41, 0.18) !important;
  }
}
@keyframes asset-dlg-in {
  from {
    opacity: 0.86;
    transform: translateY(10px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .asset-dlg {
    animation: none;
  }
}
</style>

<style lang="less">
/* 详情层遮罩：原型 rgba(245,246,248,.72)；NModal 的遮罩在 Teleport 里，scoped 够不着 */
.n-modal-container:has(.asset-dlg) .n-modal-mask {
  background-color: rgb(var(--xq-page-rgb) / 0.72);
}
</style>
