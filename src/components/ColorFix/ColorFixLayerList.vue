<script setup lang="ts">
/**
 * 校色图层列表（2026-11-11，放在参数台头部下方，浮动 / 停靠两种形态通用）：最上面一行是最后合成的那层，「整图」底层固定在最下。
 *
 * <ul>
 *   <li>点一行 = 选中（下面的选区 / 替换颜色 / 滑杆都改这一层）；双击名字或 F2 改名（回车确认、Esc 放弃、清空恢复自动名）；</li>
 *   <li>行内：显隐（眼睛）、上移 / 下移、复制、删除——非选中行悬停 / 聚焦时才出现（触屏常显）；</li>
 *   <li>键盘：行上 ↑ / ↓ 换选中、Alt + ↑ / ↓ 调顺序、Delete 删除（都不再冒泡给宿主页面）；</li>
 *   <li>头部：撤销 / 重做（图层操作与调参）、「添加选区」菜单（自动识别各目标 / 智能选区 / 涂抹），最多 8 层；</li>
 *   <li>只有底层时给一行空态说明。</li>
 * </ul>
 */
import { computed, nextTick, ref } from 'vue'
import IconButton from '@/components/IconButton/index.vue'
import type { ResultColorFix } from './useResultColorFix.ts'
import { COLORFIX_LAYERS_MAX, isBaseLayer, recolorActive, type ColorFixLayer } from './layers.ts'
import { COLORFIX_REGION_LABELS, COLORFIX_TARGET_LABELS, type ColorFixAutoTarget } from './types.ts'

const { cf, docked = false } = defineProps<{
  cf: ResultColorFix
  docked?: boolean
}>()

/** 显示顺序：顶层在上 */
const rows = computed(() => [...cf.layers.value].reverse())
const count = computed(() => cf.layers.value.length)
const onlyBase = computed(() => count.value <= 1)
const selectedId = computed(() => cf.selectedLayerId.value)

// ---------------- 添加 ----------------

const addOptions = computed(() => {
  const list: { key: string; label: string; disabled?: boolean }[] = []
  for (const t of cf.autoTargets.value) list.push({ key: `auto:${t}`, label: `自动识别 · ${COLORFIX_TARGET_LABELS[t]}` })
  if (cf.regionModes.value.includes('point'))
    list.push({
      key: 'point',
      label: cf.pointBlocked.value ? `智能选区（${cf.pointBlocked.value}）` : '智能选区（点选 / 钢笔 / 魔棒…）',
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
const addTitle = computed(() =>
  cf.canAddLayer.value ? '添加一个选区图层，单独调整它的颜色' : `最多 ${COLORFIX_LAYERS_MAX} 层（含整图）`,
)

// ---------------- 行 ----------------

function sourceLabel(l: ColorFixLayer): string {
  if (isBaseLayer(l)) return '整幅图片'
  const r = l.region
  const parts = [COLORFIX_REGION_LABELS[r.mode]]
  if (r.invert) parts.push('反选')
  return parts.join(' · ')
}

/** 图层状态提示（列表上的小点与读屏文字） */
function statusOf(l: ColorFixLayer): { text: string; tone: 'ok' | 'busy' | 'warn' } | null {
  const st = cf.layerStatus(l)
  if (st === 'busy') return { text: '识别中', tone: 'busy' }
  if (st === 'error') return { text: '识别失败', tone: 'warn' }
  if (st === 'pending') return { text: '未选区', tone: 'warn' }
  return null
}

const editingId = ref<string | null>(null)
const draftName = ref('')
const nameInput = ref<HTMLInputElement[] | HTMLInputElement | null>(null)

async function startRename(l: ColorFixLayer) {
  if (isBaseLayer(l)) return
  editingId.value = l.id
  draftName.value = l.name
  await nextTick()
  const el = Array.isArray(nameInput.value) ? nameInput.value[0] : nameInput.value
  el?.focus()
  el?.select()
}
function commitRename() {
  const id = editingId.value
  if (!id) return
  editingId.value = null
  const cur = cf.layers.value.find((l) => l.id === id)
  if (cur && draftName.value.trim() !== cur.name) cf.renameLayer(id, draftName.value)
}
function cancelRename() {
  editingId.value = null
}

const rowEls = new Map<string, HTMLElement>()
function setRowEl(id: string, el: unknown) {
  if (el instanceof HTMLElement) rowEls.set(id, el)
  else rowEls.delete(id)
}
async function focusRow(id: string) {
  await nextTick()
  rowEls.get(id)?.focus()
}

function onRowKey(e: KeyboardEvent, l: ColorFixLayer) {
  // 只认行本身上的按键：行内按钮的 Enter / 空格要照常按下按钮，改名输入框里的 Backspace / Delete / 方向键是在编辑文字
  if (e.target !== e.currentTarget) return
  const list = rows.value
  const at = list.findIndex((x) => x.id === l.id)
  let handled = true
  if (e.key === 'ArrowUp' && e.altKey) cf.moveLayer(l.id, 1)
  else if (e.key === 'ArrowDown' && e.altKey) cf.moveLayer(l.id, -1)
  else if (e.key === 'ArrowUp' && at > 0) {
    cf.selectLayer(list[at - 1]!.id)
    void focusRow(list[at - 1]!.id)
  } else if (e.key === 'ArrowDown' && at < list.length - 1) {
    cf.selectLayer(list[at + 1]!.id)
    void focusRow(list[at + 1]!.id)
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && !isBaseLayer(l)) {
    cf.removeLayer(l.id)
    // 行被删掉焦点会掉到 body：移到新选中的那行
    void focusRow(cf.selectedLayerId.value)
  }
  else if (e.key === 'F2') void startRename(l)
  else if (e.key === 'Enter' || e.key === ' ') cf.selectLayer(l.id)
  else handled = false
  if (!handled) return
  e.preventDefault()
  e.stopPropagation()
  if (e.altKey) void focusRow(l.id)
}

const canUp = (l: ColorFixLayer) => {
  const i = cf.layers.value.findIndex((x) => x.id === l.id)
  return !isBaseLayer(l) && i < cf.layers.value.length - 1
}
const canDown = (l: ColorFixLayer) => {
  const i = cf.layers.value.findIndex((x) => x.id === l.id)
  return !isBaseLayer(l) && i > 1
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
      <n-dropdown
        trigger="click"
        :options="addOptions"
        :disabled="!cf.canAddLayer.value"
        placement="bottom-end"
        @select="onAdd"
      >
        <button
          type="button"
          class="cfl__add sx-hit"
          :aria-disabled="!cf.canAddLayer.value ? 'true' : undefined"
          :title="addTitle"
          aria-haspopup="menu"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          添加选区
        </button>
      </n-dropdown>
    </div>

    <ul class="cfl__list" role="listbox" aria-label="图层（上面的后合成）">
      <li
        v-for="l in rows"
        :key="l.id"
        :ref="(el) => setRowEl(l.id, el)"
        class="cfl__row group"
        :class="{ 'is-on': l.id === selectedId, 'is-hidden': !l.visible, 'is-base': l.id === 'base' }"
        role="option"
        :aria-selected="l.id === selectedId"
        :aria-label="`${l.name}，${sourceLabel(l)}${l.visible ? '' : '，已隐藏'}`"
        :tabindex="l.id === selectedId ? 0 : -1"
        @click="cf.selectLayer(l.id)"
        @keydown="onRowKey($event, l)"
      >
        <IconButton
          :label="l.visible ? `隐藏「${l.name}」` : `显示「${l.name}」`"
          size="sm"
          variant="quiet"
          @click.stop="cf.setLayerVisible(l.id, !l.visible)"
        >
          <svg v-if="l.visible" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.7 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.2 3.2M6.6 6.6C3.8 8.3 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M3 3l18 18" />
          </svg>
        </IconButton>
        <span class="cfl__main" @dblclick.stop="startRename(l)">
          <input
            v-if="editingId === l.id"
            ref="nameInput"
            v-model="draftName"
            class="cfl__name-input"
            maxlength="24"
            :aria-label="`重命名「${l.name}」，回车确认，清空恢复自动名`"
            @click.stop
            @keydown.stop.enter.prevent="commitRename"
            @keydown.stop.esc.prevent="cancelRename"
            @blur="commitRename"
          />
          <template v-else>
            <span class="cfl__name" :title="l.id === 'base' ? '整图：作用于整幅图片，固定在最下层' : '双击改名'">{{ l.name }}</span>
            <span class="cfl__meta">{{ sourceLabel(l) }}</span>
          </template>
        </span>
        <span
          v-if="recolorActive(l.recolor)"
          class="cfl__recolor"
          :style="{ background: l.recolor.target }"
          role="img"
          :aria-label="`替换为 ${l.recolor.target}`"
          :title="`替换颜色 → ${l.recolor.target}`"
        />
        <span
          v-if="statusOf(l)"
          class="cfl__status"
          :class="`is-${statusOf(l)!.tone}`"
          role="status"
        >
          {{ statusOf(l)!.text }}
        </span>
        <span v-if="l.id !== 'base'" class="cfl__actions" :class="{ 'is-reveal': l.id !== selectedId }">
          <IconButton label="上移一层" size="sm" variant="quiet" :disabled="!canUp(l)" @click.stop="cf.moveLayer(l.id, 1)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m6 15 6-6 6 6" />
            </svg>
          </IconButton>
          <IconButton label="下移一层" size="sm" variant="quiet" :disabled="!canDown(l)" @click.stop="cf.moveLayer(l.id, -1)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </IconButton>
          <IconButton
            label="复制图层"
            size="sm"
            variant="quiet"
            :disabled="!cf.canAddLayer.value"
            @click.stop="cf.duplicateLayer(l.id)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="12" height="12" rx="2" />
              <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
            </svg>
          </IconButton>
          <IconButton label="删除图层" size="sm" variant="quiet" @click.stop="cf.removeLayer(l.id)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
            </svg>
          </IconButton>
        </span>
      </li>
    </ul>
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
.cfl__row:focus-visible {
  outline: 2px solid #875f9a;
  outline-offset: 1px;
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
  width: 100%;
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
.cfl__actions {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 8px;
}
/* 非选中行：悬停 / 聚焦才出现；触屏常显 */
@media (hover: hover) and (pointer: fine) {
  .cfl__actions.is-reveal {
    opacity: 0;
    transition: opacity 0.12s ease;
  }
  .cfl__row:hover .cfl__actions.is-reveal,
  .cfl__row:focus-within .cfl__actions.is-reveal {
    opacity: 1;
  }
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
  .cfl__row,
  .cfl__actions.is-reveal {
    transition: none;
  }
}
</style>
