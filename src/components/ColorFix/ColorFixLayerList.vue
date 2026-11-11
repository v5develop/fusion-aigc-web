<script setup lang="ts">
/**
 * 校色图层列表（2026-11-11，放在参数台头部下方，浮动 / 停靠两种形态通用）：最上面一行是最后合成的那层，「整图」底层固定在最下。
 *
 * <p>无障碍结构（2026-11-11 复审）：列表是 role=listbox（本身可聚焦，aria-activedescendant 指向选中行），行是不含任何
 * 可交互元素的 role=option；对选中图层的操作放在列表下方单独的 role=toolbar（显隐 / 上移 / 下移 / 复制 / 重命名 / 删除），
 * 改名输入框也在工具条里。不再把按钮嵌在 option 里。
 * <ul>
 *   <li>鼠标：点一行 = 选中；双击行 = 改名；</li>
 *   <li>键盘（焦点在列表上）：↑ / ↓ / Home / End 换选中、Alt + ↑ / ↓ 调顺序、H 显示 / 隐藏、F2 改名、Delete 删除
 *       （都不再冒泡给宿主页面）；Tab 进入工具条；</li>
 *   <li>头部：撤销 / 重做、「添加选区」菜单；满 8 层时按钮置灰（悬停 / 聚焦有提示），点了也给一行提示，不再静默无反应。</li>
 * </ul>
 */
import { computed, nextTick, ref } from 'vue'
import IconButton from '@/components/IconButton/index.vue'
import type { ResultColorFix } from './useResultColorFix.ts'
import { LAYER_CAP_HINT } from './useResultColorFix.ts'
import { COLORFIX_LAYERS_MAX, adjustActive, isBaseLayer, recolorActive, type ColorFixLayer } from './layers.ts'
import { COLORFIX_REGION_LABELS, COLORFIX_TARGET_LABELS, type ColorFixAutoTarget } from './types.ts'

const { cf, docked = false } = defineProps<{
  cf: ResultColorFix
  docked?: boolean
}>()

let uidSeq = 0
const uid = `cfl${Date.now().toString(36)}${(uidSeq = (uidSeq + 1) % 1e6)}${Math.floor(Math.random() * 1e4)}`
const optionId = (id: string) => `${uid}-${id}`

/** 显示顺序：顶层在上 */
const rows = computed(() => [...cf.layers.value].reverse())
const count = computed(() => cf.layers.value.length)
const onlyBase = computed(() => count.value <= 1)
const selectedId = computed(() => cf.selectedLayerId.value)
const selected = computed(() => cf.selectedLayer.value)
const selectedIsBase = computed(() => isBaseLayer(selected.value))

// ---------------- 添加 ----------------

const addOptions = computed(() => {
  const list: { key: string; label: string; disabled?: boolean }[] = []
  for (const t of cf.autoTargets.value) list.push({ key: `auto:${t}`, label: `自动识别 · ${COLORFIX_TARGET_LABELS[t]}` })
  if (cf.regionModes.value.includes('point'))
    list.push({
      key: 'point',
      label: cf.pointBlocked.value ? `智能选区（${cf.pointBlocked.value}）` : '智能选区（点选 / 选框 / 钢笔 / 魔棒…）',
      disabled: !!cf.pointBlocked.value,
    })
  if (cf.regionModes.value.includes('paint')) list.push({ key: 'paint', label: '涂抹选区' })
  return list
})
function onAdd(key: string | number) {
  const k = String(key)
  if (k.startsWith('auto:')) cf.addLayer('auto', { target: k.slice(5) as ColorFixAutoTarget })
  else if (k === 'point' || k === 'paint') cf.addLayer(k)
}
/** 满额时点「添加选区」：菜单不开，给提示（addLayer 满额时置 capNotice） */
function onAddClick() {
  if (!cf.canAddLayer.value) cf.addLayer('point')
}

// ---------------- 行 ----------------

function sourceLabel(l: ColorFixLayer): string {
  if (isBaseLayer(l)) return '整幅图片'
  const r = l.region
  const parts = [COLORFIX_REGION_LABELS[r.mode]]
  if (r.invert) parts.push('反选')
  return parts.join(' · ')
}

/** 图层状态提示（列表上的小标与读屏文字） */
function statusOf(l: ColorFixLayer): { text: string; tone: 'ok' | 'busy' | 'warn' } | null {
  const st = cf.layerStatus(l)
  if (st === 'busy') return { text: '识别中', tone: 'busy' }
  if (st === 'error') return { text: '识别失败', tone: 'warn' }
  if (st === 'pending') return { text: '未选区', tone: 'warn' }
  return null
}

function optionLabel(l: ColorFixLayer): string {
  const bits = [l.name, sourceLabel(l)]
  if (!l.visible) bits.push('已隐藏')
  if (recolorActive(l.recolor)) bits.push(`替换为 ${l.recolor.target}`)
  if (adjustActive(l.adjust)) bits.push('有更多调整')
  const st = statusOf(l)
  if (st) bits.push(st.text)
  return bits.join('，')
}

const editingId = ref<string | null>(null)
const draftName = ref('')
const nameInput = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLElement | null>(null)

async function startRename(l: ColorFixLayer) {
  if (isBaseLayer(l)) return
  cf.selectLayer(l.id)
  editingId.value = l.id
  draftName.value = l.name
  await nextTick()
  nameInput.value?.focus()
  nameInput.value?.select()
}
function commitRename(refocus = false) {
  const id = editingId.value
  if (!id) return
  editingId.value = null
  const cur = cf.layers.value.find((l) => l.id === id)
  if (cur && draftName.value.trim() !== cur.name) cf.renameLayer(id, draftName.value)
  if (refocus) void focusList()
}
function cancelRename() {
  editingId.value = null
  void focusList()
}

async function focusList() {
  await nextTick()
  listEl.value?.focus()
}

/** 选中行滚到可见（键盘换选中时） */
async function revealSelected() {
  await nextTick()
  document.getElementById(optionId(cf.selectedLayerId.value))?.scrollIntoView?.({ block: 'nearest' })
}

function onListKey(e: KeyboardEvent) {
  const list = rows.value
  const cur = selected.value
  const at = list.findIndex((x) => x.id === cur.id)
  let handled = true
  const pick = (i: number) => {
    const l = list[Math.min(list.length - 1, Math.max(0, i))]
    if (l) cf.selectLayer(l.id)
    void revealSelected()
  }
  if (e.key === 'ArrowUp' && e.altKey) cf.moveLayer(cur.id, 1)
  else if (e.key === 'ArrowDown' && e.altKey) cf.moveLayer(cur.id, -1)
  else if (e.key === 'ArrowUp') pick(at - 1)
  else if (e.key === 'ArrowDown') pick(at + 1)
  else if (e.key === 'Home') pick(0)
  else if (e.key === 'End') pick(list.length - 1)
  else if ((e.key === 'Delete' || e.key === 'Backspace') && !isBaseLayer(cur)) cf.removeLayer(cur.id)
  else if (e.key === 'F2') void startRename(cur)
  else if ((e.key === 'h' || e.key === 'H') && !e.metaKey && !e.ctrlKey) cf.setLayerVisible(cur.id, !cur.visible)
  else handled = false
  if (!handled) return
  e.preventDefault()
  e.stopPropagation()
  if (e.altKey) void revealSelected()
}

const canUp = computed(() => {
  const i = cf.layers.value.findIndex((x) => x.id === selected.value.id)
  return !selectedIsBase.value && i < cf.layers.value.length - 1
})
const canDown = computed(() => {
  const i = cf.layers.value.findIndex((x) => x.id === selected.value.id)
  return !selectedIsBase.value && i > 1
})

function removeSelected() {
  if (selectedIsBase.value) return
  cf.removeLayer(selected.value.id)
  void focusList()
}
</script>

<template>
  <div class="cfl" :class="{ 'is-docked': docked }" role="group" aria-label="调色图层">
    <div class="cfl__head">
      <b class="cfl__title">图层</b>
      <span class="cfl__count" :aria-label="`共 ${count} 层，最多 ${COLORFIX_LAYERS_MAX} 层`">{{ count }}/{{ COLORFIX_LAYERS_MAX }}</span>
      <span class="cfl__spacer" />
      <IconButton
        label="撤销图层操作"
        size="sm"
        variant="quiet"
        :disabled="!cf.canUndoLayers.value"
        @click="cf.undoLayers()"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
        </svg>
      </IconButton>
      <IconButton
        label="重做图层操作"
        size="sm"
        variant="quiet"
        :disabled="!cf.canRedoLayers.value"
        @click="cf.redoLayers()"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="m15 14 5-5-5-5" />
          <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
        </svg>
      </IconButton>
      <n-tooltip v-if="!cf.canAddLayer.value" trigger="hover" placement="bottom-end">
        <template #trigger>
          <button
            type="button"
            class="cfl__add sx-hit"
            aria-disabled="true"
            :aria-label="`添加选区：${LAYER_CAP_HINT}`"
            @click="onAddClick"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            添加选区
          </button>
        </template>
        {{ LAYER_CAP_HINT }}
      </n-tooltip>
      <n-dropdown v-else trigger="click" :options="addOptions" placement="bottom-end" @select="onAdd">
        <button type="button" class="cfl__add sx-hit" title="添加一个选区图层，单独调整它的颜色" aria-haspopup="menu">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          添加选区
        </button>
      </n-dropdown>
    </div>
    <p v-if="cf.capNotice.value" class="cfl__cap" role="status" aria-live="polite">{{ cf.capNotice.value }}</p>

    <ul
      ref="listEl"
      class="cfl__list"
      role="listbox"
      tabindex="0"
      aria-label="图层（上面的后合成）。上下键选择，Alt 加上下键调整顺序，H 显示或隐藏，F2 改名，Delete 删除"
      :aria-activedescendant="optionId(selectedId)"
      @keydown="onListKey"
    >
      <li
        v-for="l in rows"
        :id="optionId(l.id)"
        :key="l.id"
        class="cfl__row"
        :class="{ 'is-on': l.id === selectedId, 'is-hidden': !l.visible, 'is-base': l.id === 'base' }"
        role="option"
        :aria-selected="l.id === selectedId"
        :aria-label="optionLabel(l)"
        @click="cf.selectLayer(l.id)"
        @dblclick="startRename(l)"
      >
        <svg
          class="cfl__eye"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <template v-if="l.visible">
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
          </template>
          <path v-else d="M10.7 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.2 3.2M6.6 6.6C3.8 8.3 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M3 3l18 18" />
        </svg>
        <span class="cfl__main">
          <span class="cfl__name" :title="l.id === 'base' ? '整图：作用于整幅图片，固定在最下层' : '双击改名'">{{ l.name }}</span>
          <span class="cfl__meta">{{ sourceLabel(l) }}</span>
        </span>
        <span v-if="adjustActive(l.adjust)" class="cfl__tag" aria-hidden="true" title="有更多调整（白平衡 / HSL）">调</span>
        <span
          v-if="recolorActive(l.recolor)"
          class="cfl__recolor"
          :style="{ background: l.recolor.target }"
          aria-hidden="true"
          :title="`替换颜色 → ${l.recolor.target}`"
        />
        <span v-if="statusOf(l)" class="cfl__status" :class="`is-${statusOf(l)!.tone}`" aria-hidden="true">
          {{ statusOf(l)!.text }}
        </span>
      </li>
    </ul>

    <div class="cfl__tools" role="toolbar" :aria-label="`图层「${selected.name}」操作`">
      <template v-if="editingId === selected.id">
        <input
          ref="nameInput"
          v-model="draftName"
          class="cfl__name-input"
          maxlength="24"
          :aria-label="`重命名「${selected.name}」，回车确认，Esc 放弃，清空恢复自动名`"
          @keydown.stop.enter.prevent="commitRename(true)"
          @keydown.stop.esc.prevent="cancelRename"
          @blur="commitRename(false)"
        />
      </template>
      <template v-else>
        <span class="cfl__tools-name" aria-hidden="true">{{ selected.name }}</span>
        <IconButton
          :label="selected.visible ? `隐藏「${selected.name}」（H）` : `显示「${selected.name}」（H）`"
          size="sm"
          variant="quiet"
          :pressed="!selected.visible"
          @click="cf.setLayerVisible(selected.id, !selected.visible)"
        >
          <svg v-if="selected.visible" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.7 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.2 3.2M6.6 6.6C3.8 8.3 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M3 3l18 18" />
          </svg>
        </IconButton>
        <template v-if="!selectedIsBase">
          <IconButton label="上移一层（Alt+↑）" size="sm" variant="quiet" :disabled="!canUp" @click="cf.moveLayer(selected.id, 1)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m6 15 6-6 6 6" />
            </svg>
          </IconButton>
          <IconButton label="下移一层（Alt+↓）" size="sm" variant="quiet" :disabled="!canDown" @click="cf.moveLayer(selected.id, -1)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </IconButton>
          <IconButton
            :label="cf.canAddLayer.value ? '复制图层' : `复制图层：${LAYER_CAP_HINT}`"
            size="sm"
            variant="quiet"
            :disabled="!cf.canAddLayer.value"
            @click="cf.duplicateLayer(selected.id)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="12" height="12" rx="2" />
              <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
            </svg>
          </IconButton>
          <IconButton label="重命名（F2）" size="sm" variant="quiet" @click="startRename(selected)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </IconButton>
          <IconButton label="删除图层（Delete）" size="sm" variant="quiet" @click="removeSelected">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
            </svg>
          </IconButton>
        </template>
        <span v-else class="cfl__tools-note">整图底层固定在最下，不能移动或删除</span>
      </template>
    </div>
    <p v-if="onlyBase" class="cfl__empty">
      还没有选区图层。点「添加选区」只调衣服、背景等局部；每层参数独立，可叠加最多 {{ COLORFIX_LAYERS_MAX - 1 }} 层。
    </p>
  </div>
</template>

<style scoped lang="less">
.cfl {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 12px;
  padding: 8px 0;
  border-bottom: 1px dashed #ece7f0;
  cursor: default;
}
.cfl.is-docked {
  margin: 0 16px;
}
.cfl__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
}
.cfl__title {
  color: #1f2329;
  font-size: 12px;
  font-weight: 600;
}
.cfl__count {
  color: #9aa1aa;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.cfl__spacer {
  flex: 1;
}
.cfl__add {
  display: inline-flex;
  height: 26px;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  border: 1px solid #d9c8e4;
  border-radius: 13px;
  background: linear-gradient(180deg, #fff, #f8f3fc);
  color: #6b487c;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
.cfl__add svg {
  width: 12px;
  height: 12px;
}
.cfl__add[aria-disabled='true'] {
  opacity: 0.5;
  cursor: not-allowed;
}
.cfl__add:focus-visible,
.cfl__list:focus-visible {
  outline: 2px solid #875f9a;
  outline-offset: 1px;
}
.cfl__list:focus-visible .cfl__row.is-on {
  box-shadow: 0 0 0 2px rgba(135, 95, 154, 0.35);
}
.cfl__cap {
  margin: 0;
  padding: 5px 8px;
  border-radius: 8px;
  background: #fbf3e6;
  color: #94651f;
  font-size: 11.5px;
  line-height: 16px;
}
.cfl__eye {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  margin-left: 4px;
  color: #8a9099;
}
.cfl__row.is-hidden .cfl__eye {
  color: #c2c7ce;
}
.cfl__tag {
  flex: none;
  padding: 0 5px;
  border: 1px solid #d9c8e4;
  border-radius: 6px;
  color: #6b487c;
  font-size: 10.5px;
  line-height: 15px;
}
.cfl__tools {
  display: flex;
  min-height: 32px;
  align-items: center;
  gap: 8px;
  padding: 0 2px;
}
.cfl__tools-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: #4a5059;
  font-size: 11.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cfl__tools-note {
  color: #9aa1aa;
  font-size: 11px;
}
.cfl__list {
  display: flex;
  max-height: 176px;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 2px;
  overflow-y: auto;
  overscroll-behavior: contain;
  list-style: none;
}
.cfl.is-docked .cfl__list {
  max-height: 260px;
}
.cfl__row {
  display: flex;
  min-height: 38px;
  box-sizing: border-box;
  align-items: center;
  gap: 8px;
  padding: 3px 6px 3px 4px;
  border: 1px solid #eceef0;
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    background 0.12s ease;
}
.cfl__row:hover:not(.is-on) {
  border-color: #d5d9de;
}
.cfl__row.is-on {
  border-color: #b99bcb;
  background: linear-gradient(180deg, #fff, #f7f1fb);
  box-shadow: 0 1px 2px rgba(107, 72, 124, 0.12);
}
.cfl__row.is-base {
  background: #fafafa;
}
.cfl__row.is-base.is-on {
  background: linear-gradient(180deg, #fff, #f7f1fb);
}
.cfl__row.is-hidden .cfl__main {
  opacity: 0.5;
}
.cfl__main {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  line-height: 15px;
}
.cfl__name {
  overflow: hidden;
  color: #1f2329;
  font-size: 12.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cfl__meta {
  overflow: hidden;
  color: #8a9099;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cfl__name-input {
  min-width: 0;
  flex: 1;
  height: 26px;
  box-sizing: border-box;
  padding: 0 6px;
  border: 1px solid #b99bcb;
  border-radius: 6px;
  font: inherit;
  font-size: 12.5px;
}
.cfl__recolor {
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  border: 1px solid rgba(31, 35, 41, 0.15);
  border-radius: 4px;
}
.cfl__status {
  flex: none;
  padding: 0 6px;
  border-radius: 8px;
  font-size: 10.5px;
  line-height: 16px;
  white-space: nowrap;
}
.cfl__status.is-busy {
  background: #f1ecf5;
  color: #6b487c;
}
.cfl__status.is-warn {
  background: #fbf3e6;
  color: #94651f;
}
.cfl__empty {
  margin: 0;
  padding: 6px 8px;
  border-radius: 8px;
  background: #f7f5f9;
  color: #7a808a;
  font-size: 11px;
  line-height: 16px;
}
@media (prefers-reduced-motion: reduce) {
  .cfl__row {
    transition: none;
  }
}
</style>
