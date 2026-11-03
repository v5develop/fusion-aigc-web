<script setup lang="ts">
/**
 * 商拍换装工作台（三栏：左操作 / 中历史 / 右预览）。
 *
 * <p>整批提交：N 位模特 × 每位 count_per_model 张，服务端拆任务。
 * 页面只收素材：单品（互斥）、服装图（分件 / 整套两种模式）、模特图、
 * 逐件面料 / 长度 / 袖长（没填显示「按图」）、补充说明与生图参数；切图与提示词反推都在服务端。
 * 面料逐件填，提交时拼成契约的「上衣：真丝；鞋子：皮革」一段（fabric 字段不变）。
 * 「一套合影 / 分别上传」只在选了 2 件以上时出现；取消单品不删图，选回来图、参数都还在。
 *
 * <p>上传为 s1.1「白边浮片」叠片（StudioImageUpload）：服装图 / 模特图两块同排、中间切口；
 * 分件模式下点服装图叠片打开服装图弹窗（GarmentAngleDialog），每件 6 个固定角度格，点哪格进哪格。
 */
import { computed, reactive, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { studioSubmitTryon } from '@/api/studio.ts'
import type { StudioGarmentImage, StudioTryonPayload, StudioTryonSubmitReq } from '@/api/studioTypes.ts'
import StudioWorkspaceColumns from '../components/StudioWorkspaceColumns/index.vue'
import StudioImageUpload from '../components/StudioImageUpload/index.vue'
import StudioSubmitBar from '../components/StudioSubmitBar/index.vue'
import ModelSettings from '../components/ModelSettings/index.vue'
import CreationPromptInput from '@/components/creation/CreationPromptInput.vue'
import GarmentAngleDialog from '../components/GarmentAngleDialog/index.vue'
import AssetPickerModal from '../components/AssetPickerModal/index.vue'
import { useIdempotentSubmit } from '../hooks.ts'
import {
  ANGLE_OPTIONS,
  ANGLE_SEQUENCE,
  MAX_GARMENT_IMAGES,
  MAX_GARMENT_PER_ROLE,
  MAX_ITEMS,
  MAX_MODEL_IMAGES,
  MODEL_OPTIONS,
  OUTFIT_CONFLICTS,
  OUTFIT_ITEMS,
  OUTFIT_MAP,
  RESOLUTION_OPTIONS,
} from '../constants.ts'
import type { StudioOutfitItem } from '../constants.ts'

defineOptions({ name: 'studio-tryon' })

const message = useMessage()

// ---------------- 表单 ----------------

const selected = ref<string[]>([])
const form = reactive({
  set_mode: 'two',
  prompt: '',
  model: '通用',
  resolution: '1k',
  aspect_ratio: '',
  count_per_model: 1,
})

/** 每件单品的服装图（url 列表）；取消选中不删图，选回来还在 */
const garmentByItem = reactive<Record<string, string[]>>({})
/** 服装图角度，按 url 记 */
const angleByUrl = reactive<Record<string, string>>({})
/** 整套合影图（set_mode=one，一张） */
const lookImages = ref<string[]>([])
const modelImages = ref<string[]>([])
const lengths = reactive<Record<string, string>>({})
const sleeves = reactive<Record<string, string>>({})
/** 逐件面料（按单品 key）；提交时拼成「上衣：真丝；鞋子：皮革」 */
const fabrics = reactive<Record<string, string>>({})

const selectedItems = computed(() =>
  selected.value.map((key) => OUTFIT_MAP[key]).filter((i): i is StudioOutfitItem => !!i),
)
/** 参数行下拉：第一项「按图」= 不填（空串），其余为该单品的档位 */
function pickOptions(values: string[]) {
  return [{ label: '按图', value: '' }, ...values.map((v) => ({ label: v, value: v }))]
}

const setModeTabs = [
  { key: 'one', label: '一套合影' },
  { key: 'two', label: '分别上传' },
] as const
/** 选了 2 件以上才有「一套合影 / 分别上传」可选；不到 2 件按分别上传（合影图保留，切回还在） */
const showSetMode = computed(() => selected.value.length >= 2)
watch(showSetMode, (on) => {
  if (!on && form.set_mode === 'one') form.set_mode = 'two'
})

/** 选 / 取消单品：互斥的先取消，最多 3 件 */
function toggleItem(key: string) {
  const at = selected.value.indexOf(key)
  if (at >= 0) {
    // 图、参数都不删：只是这次不参与，选回来还在
    selected.value.splice(at, 1)
    message.info(`已移除 ${OUTFIT_MAP[key]?.label ?? key}，图还留着`)
    return
  }
  const clash = (OUTFIT_CONFLICTS[key] ?? []).filter((k) => selected.value.includes(k))
  if (selected.value.length - clash.length >= MAX_ITEMS) {
    message.warning(`单品最多 ${MAX_ITEMS} 件`)
    return
  }
  clash.forEach((k) => selected.value.splice(selected.value.indexOf(k), 1))
  selected.value.push(key)
  garmentByItem[key] = garmentByItem[key] ?? []
  if (clash.length) {
    message.info(`已取消冲突的${clash.map((k) => OUTFIT_MAP[k]?.label ?? k).join('、')}`)
  }
  // 回填的图让合计超过上限：图照样留着，提示先删，提交条同步拦住
  if (garmentTotal.value > MAX_GARMENT_IMAGES) {
    message.warning(`服装图合计最多 ${MAX_GARMENT_IMAGES} 张，要换先删一张`)
  }
}

// 没带角度的服装图（如旧快照回填）按组内空角度顺次补（正面 → 背面 → 侧面 → 细节 → 平铺 → 其他）；
// 弹窗上传的图由角度格直接给角度，不走这里
watch(
  garmentByItem,
  () => {
    for (const key of selected.value) {
      const list = garmentByItem[key] ?? []
      const taken = new Set(list.map((u) => angleByUrl[u]).filter(Boolean))
      for (const url of list) {
        if (angleByUrl[url]) continue
        const free = ANGLE_SEQUENCE.find((a) => !taken.has(a)) ?? 'unknown'
        angleByUrl[url] = free
        taken.add(free)
      }
    }
  },
  { deep: true },
)

const garmentTotal = computed(() => selected.value.reduce((n, key) => n + (garmentByItem[key]?.length ?? 0), 0))
/** 合计超额（只会出现在取消单品后又选回、旧图回填时）：分别上传模式下拦提交 */
const garmentOver = computed(() => form.set_mode === 'two' && garmentTotal.value > MAX_GARMENT_IMAGES)

// 每件最多 6 张、合计 9 张的约束在 GarmentAngleDialog 里按 max-per-group / max-total 执行

// ---------------- 服装图弹窗（6 个固定角度格） ----------------

const garmentDialogShow = ref(false)

// ---------------- 服装图 · 从资产库选 ----------------

const assetShow = ref(false)

/** 合计还能放几张（每件上限在入组时按件判断） */
const garmentRoom = computed(() => Math.max(0, MAX_GARMENT_IMAGES - garmentTotal.value))

function openGarmentAssets() {
  if (!selected.value.length) {
    message.warning('先选择单品，再从资产库选服装图')
    return
  }
  if (garmentRoom.value <= 0) {
    message.warning(`服装图合计最多 ${MAX_GARMENT_IMAGES} 张，要换先删一张`)
    return
  }
  assetShow.value = true
}

/** 资产图与弹窗上传同口径：落到第一件还有余量的选中单品，角度取该件第一个空角度，每件 / 合计上限不变 */
function addGarmentAssets(picked: string[]) {
  let skipped = 0
  for (const url of picked) {
    const all = new Set(garmentAll.value)
    const key = selected.value.find((k) => (garmentByItem[k]?.length ?? 0) < MAX_GARMENT_PER_ROLE)
    if (all.has(url) || all.size >= MAX_GARMENT_IMAGES || !key) {
      skipped += 1
      continue
    }
    const taken = new Set((garmentByItem[key] ?? []).map((u) => angleByUrl[u]).filter(Boolean))
    addGarment(key, url, ANGLE_SEQUENCE.find((a) => !taken.has(a)) ?? 'unknown')
  }
  if (skipped) message.warning(`有 ${skipped} 张重复或超出上限，未添加`)
}

/** 弹窗里按单品分组的服装图 */
const garmentGroups = computed(() =>
  selectedItems.value.map((item) => ({ key: item.key, label: item.label, urls: garmentByItem[item.key] ?? [] })),
)
/** 叠片入口里的全部服装图（按单品顺序） */
const garmentAll = computed(() => selected.value.flatMap((key) => garmentByItem[key] ?? []))

function angleLabel(url: string) {
  return ANGLE_OPTIONS.find((o) => o.value === angleByUrl[url])?.label ?? '其他'
}

/** 叠片面板角标：「上衣·正面」 */
function garmentTag(url: string) {
  const key = selected.value.find((k) => garmentByItem[k]?.includes(url))
  return `${(key && OUTFIT_MAP[key]?.label) || ''}·${angleLabel(url)}`
}

function addGarment(key: string, url: string, angle: string) {
  // 先记角度再入组，补角度的 watch 就不会改它
  angleByUrl[url] = angle
  const list = garmentByItem[key] ?? []
  if (!list.includes(url)) list.push(url)
  garmentByItem[key] = list
}

function removeGarment(url: string) {
  for (const key of Object.keys(garmentByItem)) {
    const list = garmentByItem[key]
    const at = list?.indexOf(url) ?? -1
    if (list && at >= 0) list.splice(at, 1)
  }
  delete angleByUrl[url]
}

/** 叠片右上角删除 = 清空选中单品的服装图（逐张删在悬停面板 / 弹窗格子里） */
function clearGarments() {
  const total = garmentTotal.value
  for (const key of selected.value) {
    for (const url of garmentByItem[key] ?? []) delete angleByUrl[url]
    garmentByItem[key] = []
  }
  message.info(total ? `已清空 ${total} 张服装图` : '已清空服装图')
}

// ---------------- 提交 ----------------

const submitting = ref(false)
const shell = ref<InstanceType<typeof StudioWorkspaceColumns> | null>(null)

/** 幂等重试：失败缓存 key 进「重试生成」态；表单任意字段变化换新 key */
const idem = useIdempotentSubmit()
idem.bindForm(form, selected, garmentByItem, angleByUrl, lookImages, modelImages, lengths, sleeves, fabrics)

/** 逐件面料拼成契约格式：「上衣：真丝；鞋子：皮革」，空的不写 */
const fabricText = computed(() =>
  selected.value
    .map((key) => ({ key, value: (fabrics[key] ?? '').trim() }))
    .filter((row) => row.value)
    .map((row) => `${OUTFIT_MAP[row.key]?.label ?? row.key}：${row.value}`)
    .join('；'),
)

const taskCount = computed(() => modelImages.value.length * form.count_per_model)
const submitText = computed(() => (taskCount.value ? `开始换装（${taskCount.value} 张）` : '开始换装'))

/** 未就绪原因（提交条置灰展示）；空 = 就绪 */
const disabledReason = computed(() => {
  if (!selected.value.length) return '先选择单品（1–3 件）'
  if (form.set_mode === 'one') {
    if (!lookImages.value.length) return '上传一张整套服装合影'
  } else {
    const missing = selected.value.filter((key) => !garmentByItem[key]?.length)
    if (missing.length) return `还没传服装图：${missing.map((key) => OUTFIT_MAP[key]?.label ?? key).join('、')}`
    if (garmentOver.value) return `服装图合计最多 ${MAX_GARMENT_IMAGES} 张，要换先删一张`
  }
  if (!modelImages.value.length) return '上传 1–9 张模特图，每张一位模特'
  return ''
})

async function submit() {
  if (submitting.value) return
  // 校验顺序对齐服务端：单品 → 服装图 → 模特图 → 张数
  if (!selected.value.length) return message.warning('请先选择单品（1–3 件）')
  if (form.set_mode === 'one') {
    if (!lookImages.value.length) return message.warning('请上传一张整套服装合影')
  } else {
    const missing = selected.value.filter((key) => !garmentByItem[key]?.length)
    if (missing.length) {
      return message.warning(`还没传服装图：${missing.map((key) => OUTFIT_MAP[key]?.label ?? key).join('、')}`)
    }
    if (garmentOver.value) return message.warning(`服装图合计最多 ${MAX_GARMENT_IMAGES} 张，要换先删一张`)
  }
  if (!modelImages.value.length) return message.warning('请上传 1–9 张模特图，每张一位模特')

  const garmentImages: StudioGarmentImage[] =
    form.set_mode === 'one'
      ? lookImages.value.map((url) => ({ url, role: '整套', angle: 'front' }))
      : selected.value.flatMap((key) =>
          (garmentByItem[key] ?? []).map((url) => ({
            url,
            role: OUTFIT_MAP[key]?.label ?? '',
            angle: angleByUrl[url] || 'unknown',
          })),
        )

  const lengthsOut: Record<string, string> = {}
  const sleevesOut: Record<string, string> = {}
  for (const key of selected.value) {
    const len = (lengths[key] ?? '').trim()
    const slv = (sleeves[key] ?? '').trim()
    if (len) lengthsOut[key] = len
    if (slv) sleevesOut[key] = slv
  }

  const body: StudioTryonSubmitReq = {
    model_image_urls: [...modelImages.value],
    garment_images: garmentImages,
    items: [...selected.value],
    set_mode: form.set_mode,
    count_per_model: form.count_per_model,
    model: form.model || undefined,
    resolution: form.resolution || undefined,
    aspect_ratio: form.aspect_ratio || undefined,
    prompt: form.prompt.trim() || undefined,
    fabric: fabricText.value || undefined,
    ...(Object.keys(lengthsOut).length ? { lengths: lengthsOut } : {}),
    ...(Object.keys(sleevesOut).length ? { sleeves: sleevesOut } : {}),
  }

  submitting.value = true
  try {
    // 重试沿用失败那次的 Idempotency-Key（同 key 同 body 契约幂等），改过表单则是新 key
    const res = await studioSubmitTryon(body, { 'Idempotency-Key': idem.take() })
    idem.settle()
    const d = res.data
    message.success(
      `已提交 ${d?.task_total ?? taskCount.value} 张，预估消耗 ${d?.estimated_points ?? 0} 点${
        d?.replayed ? '（幂等重放，返回原批次）' : ''
      }`,
    )
    for (const w of d?.warnings ?? []) message.warning(w)
    await shell.value?.refresh()
    if (d?.batch_id) shell.value?.openBatch(d.batch_id)
  } catch (err) {
    // 拦截器已 toast（3003 走引导购买弹框）；结果未知（网络 / 超时 / 5001）保留 key 进「重试生成」态，
    // 确定失败（参数错、点数不足等）清掉 key，充值或改参后再提交换新 key
    idem.fail(err)
  } finally {
    submitting.value = false
  }
}

// ---------------- 重新编辑 ----------------

function onReedit(payload: Record<string, unknown>) {
  const p = payload as unknown as StudioTryonPayload

  selected.value = []
  Object.keys(garmentByItem).forEach((k) => delete garmentByItem[k])
  Object.keys(angleByUrl).forEach((k) => delete angleByUrl[k])
  Object.keys(lengths).forEach((k) => delete lengths[k])
  Object.keys(sleeves).forEach((k) => delete sleeves[k])
  Object.keys(fabrics).forEach((k) => delete fabrics[k])
  lookImages.value = []
  modelImages.value = []

  form.set_mode = p.set_mode === 'one' ? 'one' : 'two'
  const items = (Array.isArray(p.items) ? p.items : [])
    .filter((k): k is string => !!k && !!OUTFIT_MAP[k])
    .slice(0, MAX_ITEMS)
  for (const key of items) {
    selected.value.push(key)
    garmentByItem[key] = []
  }

  // 服装图按 role 归组；整套模式收进 lookImages，认不出的角色挂到第一件单品下，避免静默丢图
  const garmentImages = Array.isArray(p.garment_images) ? p.garment_images : []
  for (const g of garmentImages) {
    const url = g?.url ?? ''
    if (!url) continue
    if (g.angle && ANGLE_OPTIONS.some((o) => o.value === g.angle)) angleByUrl[url] = g.angle
    if (g.role === '整套') {
      if (!lookImages.value.includes(url)) lookImages.value.push(url)
      continue
    }
    const key = items.find((k) => OUTFIT_MAP[k]?.label === g.role) ?? items[0]
    if (!key) continue
    const list = garmentByItem[key] ?? []
    if (!list.includes(url)) list.push(url)
    garmentByItem[key] = list
  }
  if (form.set_mode === 'one' && !lookImages.value.length && garmentImages.some((g) => g?.url)) {
    // 快照是整套模式却没有整套图（异常 / 旧数据）：退回分件模式，别让提交被拦
    form.set_mode = 'two'
  }
  const onlyKey = items[0]
  if (form.set_mode === 'one' && items.length < 2 && onlyKey) {
    // 不到 2 件页面不提供「一套合影」：合影图挂到这一件的正面，按分别上传回填
    form.set_mode = 'two'
    for (const url of lookImages.value) {
      if (!angleByUrl[url]) angleByUrl[url] = 'front'
      if (!garmentByItem[onlyKey]?.includes(url)) garmentByItem[onlyKey]?.push(url)
    }
  }

  modelImages.value = (Array.isArray(p.model_image_urls) ? p.model_image_urls : []).filter((u): u is string => !!u)

  for (const key of items) {
    const len = p.lengths?.[key]
    if (typeof len === 'string' && len) lengths[key] = len
    const slv = p.sleeves?.[key]
    if (typeof slv === 'string' && slv) sleeves[key] = slv
  }
  // 面料按「单品：值」拆回逐件；认不出单品的片段并到第一件，不静默丢字
  const unmatched: string[] = []
  for (const part of (typeof p.fabric === 'string' ? p.fabric : '').split(/[；;]/)) {
    const seg = part.trim()
    if (!seg) continue
    const m = /^([^：:]+)[：:](.*)$/.exec(seg)
    const key = m ? items.find((k) => OUTFIT_MAP[k]?.label === m[1]!.trim()) : undefined
    if (key && m) fabrics[key] = [fabrics[key], m[2]!.trim()].filter(Boolean).join('；')
    else unmatched.push(seg)
  }
  const firstKey = items[0]
  if (unmatched.length && firstKey) {
    fabrics[firstKey] = [fabrics[firstKey], ...unmatched].filter(Boolean).join('；')
  }
  form.prompt = typeof p.prompt === 'string' ? p.prompt : ''
  form.model = MODEL_OPTIONS.some((o) => o.value === p.model) ? (p.model as string) : '通用'
  form.resolution = RESOLUTION_OPTIONS.some((o) => o.value === p.resolution) ? (p.resolution as string) : '1k'
  form.aspect_ratio = typeof p.aspect_ratio === 'string' ? p.aspect_ratio : ''
  form.count_per_model = Math.min(9, Math.max(1, Math.round(Number(p.count_per_model) || 1)))
  // 回填是一次全新的提交：bindForm 的深度 watch 会作废旧 key，这里再兜一道
  idem.invalidate()
}
</script>

<template>
  <StudioWorkspaceColumns ref="shell" kind="tryon" title="商拍换装" @reedit="onReedit">
    <template #operate>
      <!-- 单品 -->
      <div class="mb-16px">
        <div class="ll-section-title flex items-baseline gap-6px">
          单品<span class="text-11px text-placeholder font-400">最多 3 件，冲突项自动取消</span>
        </div>
        <div class="flex gap-8px flex-wrap">
          <span
            v-for="item in OUTFIT_ITEMS"
            :key="item.key"
            class="ll-pill"
            :class="{ 'll-pill-active': selected.includes(item.key) }"
            @click="toggleItem(item.key)"
            >{{ item.label }}</span
          >
        </div>
      </div>

      <!-- 成套方式：选了 2 件以上才出现 -->
      <div v-if="showSetMode" class="mb-16px">
        <div class="ll-section-title flex items-baseline gap-6px">成套方式</div>
        <div class="flex gap-8px flex-wrap">
          <span
            v-for="tab in setModeTabs"
            :key="tab.key"
            class="ll-pill"
            :class="{ 'll-pill-active': form.set_mode === tab.key }"
            @click="form.set_mode = tab.key"
            >{{ tab.label }}</span
          >
        </div>
        <div class="mt-6px text-11px text-placeholder">
          分别上传 = 每件单品单独传图；一套合影 = 传一张全套服装合影，系统自动切分
        </div>
      </div>

      <!-- 服装图 + 模特图：两块白边浮片同排，中间切口 -->
      <div class="mb-16px">
        <div class="ll-section-title flex items-baseline gap-6px">
          服装图 · 模特图
          <span class="text-11px text-placeholder font-400">{{
            form.set_mode === 'two' ? `服装图合计 ${garmentTotal}/${MAX_GARMENT_IMAGES} 张` : '整套 1 张'
          }}</span>
        </div>
        <div class="flex items-start gap-16px">
          <StudioImageUpload
            v-if="form.set_mode === 'one'"
            v-model="lookImages"
            :max="1"
            :multiple="false"
            label="服装图"
            hint="整套合影 1 张"
            cloud
          />
          <StudioImageUpload
            v-else
            :model-value="garmentAll"
            :max="MAX_GARMENT_IMAGES"
            label="服装图"
            :hint="garmentTotal ? `${selected.length}件·${garmentTotal}张` : `最多${MAX_GARMENT_IMAGES}张`"
            picker
            :on-cloud="openGarmentAssets"
            :tag-of="garmentTag"
            @pick="garmentDialogShow = true"
            @remove="(url: string) => removeGarment(url)"
            @clear="clearGarments"
          />
          <StudioImageUpload
            v-model="modelImages"
            :max="MAX_MODEL_IMAGES"
            :panel-min="4"
            panel-fill
            label="模特图"
            cloud
          />
        </div>
        <div class="mt-8px text-11px leading-16px text-placeholder">
          {{
            form.set_mode === 'two'
              ? selectedItems.length
                ? '点服装图按角度上传，每件最多 6 张；模特图每张一位模特'
                : '先在上方选择单品，再点服装图上传；模特图每张一位模特'
              : '一套合影 = 一张全套服装合影，系统自动切分；模特图每张一位模特'
          }}
        </div>
      </div>

      <!-- 各单品参数：按件一行（32 缩略图 + 面料 + 长度 / 袖长）；鞋子 / 配饰 / 文胸 / 内裤只有面料；没填显示「按图」 -->
      <div v-if="selectedItems.length" class="mb-16px">
        <div class="ll-section-title flex items-baseline gap-6px">
          各单品参数<span class="text-11px text-placeholder font-400">选填，没填按图</span>
        </div>
        <div class="flex flex-col gap-8px">
          <div v-for="item in selectedItems" :key="item.key" class="flex items-center gap-8px min-w-0">
            <span
              class="shrink-0 block w-32px h-32px box-border overflow-hidden border border-solid border-line rounded-4px bg-surface3"
            >
              <img
                v-if="garmentByItem[item.key]?.[0]"
                class="block w-full h-full object-cover"
                :src="garmentByItem[item.key]?.[0]"
                alt=""
              />
            </span>
            <span class="shrink-0 w-36px text-11px text-ink-2">{{ item.label }}</span>
            <input
              v-model="fabrics[item.key]"
              class="flex-[1_1_0] min-w-0 h-30px box-border px-9px border border-solid border-line rounded-6px bg-white text-11px text-ink-2 outline-none shadow-[inset_0_1px_2px_rgba(31,35,41,0.09)] placeholder:text-placeholder focus:border-violet"
              :maxlength="3000"
              placeholder="面料（选填）"
              :aria-label="`${item.label}面料`"
            />
            <n-popselect
              v-if="item.length.length"
              :value="lengths[item.key] ?? ''"
              :options="pickOptions(item.length)"
              trigger="click"
              size="small"
              scrollable
              @update:value="(v: string) => (lengths[item.key] = v ?? '')"
            >
              <button
                type="button"
                class="flex-[1.15_1_0] min-w-0 flex items-center gap-5px h-30px box-border pl-8px pr-6px border border-solid border-line rounded-6px bg-white text-11px text-ink-2 cursor-pointer shadow-[inset_0_1px_2px_rgba(31,35,41,0.09)] hover:border-violet-line focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-violet focus-visible:outline-offset-2"
                :aria-label="`${item.label}长度：${lengths[item.key] || '按图'}`"
                aria-haspopup="listbox"
              >
                <span class="shrink-0 text-10px text-placeholder">长度</span>
                <b
                  class="flex-1 min-w-0 overflow-hidden text-left text-11px font-400 whitespace-nowrap text-ellipsis"
                  >{{ lengths[item.key] || '按图' }}</b
                >
                <svg
                  class="shrink-0 w-10px h-10px text-placeholder"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            </n-popselect>
            <n-popselect
              v-if="item.sleeve.length"
              :value="sleeves[item.key] ?? ''"
              :options="pickOptions(item.sleeve)"
              trigger="click"
              size="small"
              scrollable
              @update:value="(v: string) => (sleeves[item.key] = v ?? '')"
            >
              <button
                type="button"
                class="flex-[1.15_1_0] min-w-0 flex items-center gap-5px h-30px box-border pl-8px pr-6px border border-solid border-line rounded-6px bg-white text-11px text-ink-2 cursor-pointer shadow-[inset_0_1px_2px_rgba(31,35,41,0.09)] hover:border-violet-line focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-violet focus-visible:outline-offset-2"
                :aria-label="`${item.label}袖长：${sleeves[item.key] || '按图'}`"
                aria-haspopup="listbox"
              >
                <span class="shrink-0 text-10px text-placeholder">袖长</span>
                <b
                  class="flex-1 min-w-0 overflow-hidden text-left text-11px font-400 whitespace-nowrap text-ellipsis"
                  >{{ sleeves[item.key] || '按图' }}</b
                >
                <svg
                  class="shrink-0 w-10px h-10px text-placeholder"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            </n-popselect>
          </div>
        </div>
      </div>

      <!-- 补充说明（原型：框内文本 + 左下角计数，无分组标题） -->
      <CreationPromptInput
        v-model="form.prompt"
        :rows="6"
        :max-length="3000"
        aria-label="补充说明"
        placeholder="门襟暗扣、裤脚开衩这类设计点写这里；背景、姿势要求也可以写（选填）"
      />

      <!-- 弹层放壳内：跟 naive 组件同处 llTheme 的 abstract provider 下（teleport 不丢主题） -->
      <AssetPickerModal v-model:show="assetShow" :limit="garmentRoom" @select="addGarmentAssets" />
      <GarmentAngleDialog
        v-model:show="garmentDialogShow"
        :groups="garmentGroups"
        :angle-of="angleByUrl"
        :max-per-group="MAX_GARMENT_PER_ROLE"
        :max-total="MAX_GARMENT_IMAGES"
        @add="addGarment"
        @remove="(_key: string, url: string) => removeGarment(url)"
      />
    </template>

    <template #action>
      <!-- 原型底部：设置行（模型 | 图片设置）→ 整宽主按钮 -->
      <div class="flex flex-col gap-12px">
        <ModelSettings
          v-model:model="form.model"
          v-model:resolution="form.resolution"
          v-model:aspect-ratio="form.aspect_ratio"
          v-model:count="form.count_per_model"
          count-label="每位模特生成张数"
          auto-ratio
        />
        <StudioSubmitBar
          :label="submitText"
          :submitting="submitting"
          :disabled="!!disabledReason"
          :disabled-reason="disabledReason"
          :retry="idem.retrying.value"
          @submit="submit"
        />
      </div>
    </template>
  </StudioWorkspaceColumns>
</template>
