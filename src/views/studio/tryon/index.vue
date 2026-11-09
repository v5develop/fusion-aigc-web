<script setup lang="ts">
/**
 * 商拍换装工作台（三栏：左操作 / 中历史 / 右功能介绍），版式对齐线上原型 /tools/ai-digital-model（AiDigitalModel）。
 *
 * <p>整批提交：N 位模特 × 每位 count_per_model 张，服务端拆任务。
 * 左列 = 功能卡 → 素材板（服装图 / 模特图两叠白边浮片 → 补充说明 + 计数 → 各单品参数）→ 模型 / 图片设置 → 开始换装。
 * 素材板与服装图弹窗直接复用工具页的 ToolTryonMaterials / ToolGarmentDialog / useTryonGarment，两页行为一致：
 * 单品（8 个、最多 3 件、互斥自动取消）在服装图弹窗里选；分别上传每件 6 个固定角度格，选 2 件起可切「一套合影」。
 * 页面持有 useTryonGarment 状态，按单品 / 角度拼 garment_images；上传走 goUploadImage（studio 只收本服务签发的地址）。
 * 逐件面料 / 长度 / 袖长（没填显示「按图」）；面料提交时拼成契约的「上衣：真丝；鞋子：皮革」一段（fabric 字段不变）。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { studioSubmitTryon } from '@/api/studio.ts'
import { goUploadImage } from '@/api/goUpload.ts'
import { checkMinShortSide } from '../imageSize.ts'
import type { StudioGarmentImage, StudioTryonPayload, StudioTryonSubmitReq } from '@/api/studioTypes.ts'
import ToolTryonMaterials from '@/views/tools/ToolTryonMaterials.vue'
import { useTryonGarment } from '@/views/tools/useTryonGarment.ts'
import type { UploadSpec } from '@/views/tools/schemas.ts'
import StudioWorkspaceColumns from '../components/StudioWorkspaceColumns/index.vue'
import StudioSubmitBar from '../components/StudioSubmitBar/index.vue'
import ColorFixToggle from '../components/StudioSubmitBar/ColorFixToggle.vue'
import { useColorFix } from '@/views/studio/colorfix/useColorFix'
import ModelSettings from '../components/ModelSettings/index.vue'
import StudioMedBtn from '../components/StudioImageUpload/StudioMedBtn.vue'
import { useIdempotentSubmit, useStudioCost } from '../hooks.ts'
import {
  ANGLE_OPTIONS,
  MAX_GARMENT_IMAGES,
  MAX_ITEMS,
  MAX_MODEL_IMAGES,
  MODEL_OPTIONS,
  OUTFIT_MAP,
  RESOLUTION_OPTIONS,
} from '../constants.ts'
import type { StudioOutfitItem } from '../constants.ts'

defineOptions({ name: 'studio-tryon' })

const message = useMessage()

// ---------------- 上传规格 / 通道 ----------------

/** 与原上传口径一致：≤10M（goUploadImage 内部同样拦） */
const IMAGE_ACCEPT = '.jpg,.jpeg,.png,.webp,.bmp'
const IMAGE_MAX_BYTES = 10 * 1024 * 1024
const CLOTH_SPEC: UploadSpec = {
  label: '服装图',
  kind: 'image',
  max: MAX_GARMENT_IMAGES,
  required: true,
  maxBytes: IMAGE_MAX_BYTES,
  accept: IMAGE_ACCEPT,
}
const MODEL_SPEC: UploadSpec = {
  label: '模特图',
  kind: 'image',
  max: MAX_MODEL_IMAGES,
  required: true,
  maxBytes: IMAGE_MAX_BYTES,
  accept: IMAGE_ACCEPT,
}

/** 逐张串行直传；短边 <240px 的先拦下，失败的跳过并提示，不抛（ToolTryonMaterials 的上传通道约定） */
async function studioUpload(files: File[]): Promise<string[]> {
  const urls: string[] = []
  for (const file of files) {
    const small = await checkMinShortSide(file)
    if (small) {
      message.error(small)
      continue
    }
    try {
      urls.push(await goUploadImage(file))
    } catch (err) {
      message.error(err instanceof Error ? err.message : '图片上传失败')
    }
  }
  return urls
}

// ---------------- 表单 ----------------

const form = reactive({
  prompt: '',
  model: '通用',
  resolution: '1k',
  aspect_ratio: '3:4',
  count_per_model: 1,
})

/** 单品 / 一套合影 / 逐件角度格：与工具页同一份状态逻辑 */
const g = useTryonGarment(() => CLOTH_SPEC, { upload: studioUpload })
/** 工具页契约的单张服装图槽位；studio 不用它（按 garment_images 提交），只给素材板回写 */
const clothSlot = ref<string[]>([])
const modelImages = ref<string[]>([])

const lengths = reactive<Record<string, string>>({})
const sleeves = reactive<Record<string, string>>({})
/**
 * 每件面料上限：Go 的 fabric 整段 ≤3000 字（validate.go MaxPromptLen），最多 3 件、拼接时还要加「单品：」与分号，
 * 每件 200 字远在整段上限内，也足够写成分 / 克重 / 织法。
 */
const FABRIC_MAX = 200
/**
 * 服装图弹窗的参考图说明：Go 组图（pipeline/select.go SelectImages）每张生图最多带 9 张输入
 * （主图 + 细节裁切 + 模特 1 张，所有模型同一口径，低于 Seedream 的 10 张上限），服装图多时细节裁切名额会变少。
 */
const GARMENT_NOTE = '每张生图连同模特最多参考 9 张（含细节裁切），服装图越多，细节裁切越少。'
/** 逐件面料（按单品 key）；提交时拼成「上衣：真丝；鞋子：皮革」 */
const fabrics = reactive<Record<string, string>>({})

const selectedItems = computed(() => g.selected.map((key) => OUTFIT_MAP[key]).filter((i): i is StudioOutfitItem => !!i))

// ---------------- 长度 / 袖长下拉（原型 .dm-pick：自绘向上浮层，同一时间只开一个） ----------------

type PickKind = 'length' | 'sleeve'
/** 该单品有的参数下拉：第一项「按图」= 不填（空串），其余为该单品的档位；鞋子 / 配饰 / 文胸 / 内裤没有 */
function pickKinds(item: StudioOutfitItem) {
  const out: { kind: PickKind; label: string; options: string[] }[] = []
  if (item.length.length) out.push({ kind: 'length', label: '长度', options: ['', ...item.length] })
  if (item.sleeve.length) out.push({ kind: 'sleeve', label: '袖长', options: ['', ...item.sleeve] })
  return out
}
const pickStore = (kind: PickKind) => (kind === 'length' ? lengths : sleeves)
/** 打开中的下拉：`${单品}:${kind}`；空 = 都关着 */
const picker = ref('')
function togglePick(id: string) {
  picker.value = picker.value === id ? '' : id
}
function choosePick(key: string, kind: PickKind, value: string) {
  pickStore(kind)[key] = value
  closePick(true)
}
/** 收起下拉；restoreFocus = 焦点回到打开它的那个按钮（Esc / 键盘选完后不丢焦点） */
function closePick(restoreFocus = false) {
  const id = picker.value
  picker.value = ''
  if (!restoreFocus || !id) return
  const sel = `[data-pick-trigger="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id}"]`
  document.querySelector<HTMLElement>(sel)?.focus()
}
/** 点到下拉外面 / 按 Esc 收起（捕获阶段，别的地方 stopPropagation 也拦不住） */
function closePickOutside(event: Event) {
  if (!picker.value) return
  if ((event.target as HTMLElement | null)?.closest?.('[data-tryon-pick]')) return
  picker.value = ''
}
function closePickOnEsc(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !picker.value) return
  event.preventDefault()
  closePick(true)
}
onMounted(() => {
  document.addEventListener('pointerdown', closePickOutside, true)
  document.addEventListener('keydown', closePickOnEsc, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closePickOutside, true)
  document.removeEventListener('keydown', closePickOnEsc, true)
})

/** 中文角度 ↔ 接口传值 */
const angleCode = (label: string) => ANGLE_OPTIONS.find((o) => o.label === label)?.value ?? 'unknown'
const angleLabel = (code: string) => ANGLE_OPTIONS.find((o) => o.value === code)?.label ?? '其他'

/** 合计超额（只会出现在取消单品后又选回时）：分别上传模式下拦提交 */
const garmentOver = computed(() => !g.isTogether && g.allPhotos.length > MAX_GARMENT_IMAGES)

/** 参数行缩略：该件第一张图（原型口径，与一套 / 分别无关） */
const firstPhoto = (key: string) => g.photosOf(key)[0]

// ---------------- 提交 ----------------

const submitting = ref(false)
const shell = ref<InstanceType<typeof StudioWorkspaceColumns> | null>(null)

/** 幂等重试：失败缓存 key 进「重试生成」态；表单任意字段变化换新 key */
const idem = useIdempotentSubmit()

/** 默认校色（与结果区校色面板同一份状态）：提交时作 color_fix 下发 */
const { enabled: colorFix } = useColorFix()

/** 按钮第二行「消耗 N 点」：把提交体里影响价格的字段（张数 / 模型 / 分辨率 / 比例）原样发给报价接口，拿不到价就不显示 */
const { points: costPoints } = useStudioCost('tryon', () => ({
  model_image_urls: modelImages.value,
  count_per_model: form.count_per_model,
  model: form.model || undefined,
  resolution: form.resolution || undefined,
  aspect_ratio: form.aspect_ratio || undefined,
}))
idem.bindForm(
  form,
  () => g.selected,
  () => g.mode,
  () => g.look,
  () => g.allPhotos,
  () => g.selected.map((key) => g.photosOf(key).map((p) => p.angle)),
  modelImages,
  lengths,
  sleeves,
  fabrics,
  colorFix,
)

// 产品决定：「精细读图」「提示词可见」不加。

/** 逐件面料拼成契约格式：「上衣：真丝；鞋子：皮革」，空的不写 */
const fabricText = computed(() =>
  g.selected
    .map((key) => ({ key, value: (fabrics[key] ?? '').trim() }))
    .filter((row) => row.value)
    .map((row) => `${OUTFIT_MAP[row.key]?.label ?? row.key}：${row.value}`)
    .join('；'),
)

/** 还没传图的单品（一套合影没传合影 = 所选单品全算缺） */
const missing = computed(() =>
  g.isTogether
    ? g.look
      ? []
      : g.selected.map((key) => OUTFIT_MAP[key]?.label ?? key)
    : g.selected.filter((key) => !g.photosOf(key).length).map((key) => OUTFIT_MAP[key]?.label ?? key),
)

const taskCount = computed(() => modelImages.value.length * form.count_per_model)
const submitText = computed(() => (taskCount.value ? `开始换装（${taskCount.value} 张）` : '开始换装'))

/** 素材板上传中（服装图 / 模特图）：还没回来的图不会进提交体，先拦下 */
const materialsUploading = ref(false)

/** 未就绪原因（提交条悬停提示；按钮保持可点，点了 toast 同一句）；空 = 就绪，悬停改显示原型的拆任务说明 */
const notReadyReason = computed(() => {
  if (materialsUploading.value) return '图片上传中，稍等再提交'
  if (!g.selected.length) return '先选单品：点服装图打开弹窗'
  if (missing.value.length) return `还没传图：${missing.value.join('、')}`
  if (garmentOver.value) return `服装图最多 ${MAX_GARMENT_IMAGES} 张`
  if (!modelImages.value.length) return '至少上传 1 位模特'
  return ''
})
const SUBMIT_HINT = '按模特 × 生成张数逐个提交，每个任务单独出图'

async function submit() {
  if (submitting.value) return
  if (materialsUploading.value) return message.warning('图片上传中，稍等再提交')
  // 校验顺序对齐原型 / 服务端：单品 → 服装图 → 模特图；按钮常亮，点了给原型同一句提示
  if (!g.selected.length) return message.warning('先选单品：点服装图打开弹窗')
  if (missing.value.length) return message.warning(`还没传图：${missing.value.join('、')}`)
  if (garmentOver.value) return message.warning(`服装图最多 ${MAX_GARMENT_IMAGES} 张`)
  if (!modelImages.value.length) return message.warning('至少上传 1 位模特')

  const garmentImages: StudioGarmentImage[] = g.isTogether
    ? [{ url: g.look, role: '整套', angle: 'front' }]
    : g.selected.flatMap((key) =>
        g.photosOf(key).map((p) => ({ url: p.url, role: OUTFIT_MAP[key]?.label ?? '', angle: angleCode(p.angle) })),
      )

  const lengthsOut: Record<string, string> = {}
  const sleevesOut: Record<string, string> = {}
  for (const key of g.selected) {
    const len = (lengths[key] ?? '').trim()
    const slv = (sleeves[key] ?? '').trim()
    if (len) lengthsOut[key] = len
    if (slv) sleevesOut[key] = slv
  }

  const body: StudioTryonSubmitReq = {
    model_image_urls: [...modelImages.value],
    garment_images: garmentImages,
    items: [...g.selected],
    set_mode: g.isTogether ? 'one' : 'two',
    count_per_model: form.count_per_model,
    model: form.model || undefined,
    resolution: form.resolution || undefined,
    aspect_ratio: form.aspect_ratio || undefined,
    prompt: form.prompt.trim() || undefined,
    fabric: fabricText.value || undefined,
    ...(Object.keys(lengthsOut).length ? { lengths: lengthsOut } : {}),
    ...(Object.keys(sleevesOut).length ? { sleeves: sleevesOut } : {}),
    color_fix: colorFix.value,
  }

  submitting.value = true
  try {
    // 重试沿用失败那次的 Idempotency-Key（同 key 同 body 契约幂等），改过表单则是新 key
    const res = await studioSubmitTryon(body, { 'Idempotency-Key': idem.take() })
    idem.settle()
    const d = res.data
    const points = d?.estimated_points
    message.success(
      `已提交 ${d?.task_total ?? taskCount.value} 个换装任务${points ? `，预估消耗 ${points} 点` : ''}${
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

  Object.keys(lengths).forEach((k) => delete lengths[k])
  Object.keys(sleeves).forEach((k) => delete sleeves[k])
  Object.keys(fabrics).forEach((k) => delete fabrics[k])

  const items = (Array.isArray(p.items) ? p.items : [])
    .filter((k): k is string => !!k && !!OUTFIT_MAP[k])
    .slice(0, MAX_ITEMS)

  // 服装图按 role 归组；整套图收进合影，认不出的角色挂到第一件单品下，避免静默丢图
  const garmentImages = Array.isArray(p.garment_images) ? p.garment_images : []
  let look = ''
  const photos: { url: string; role: string; angle: string }[] = []
  for (const gi of garmentImages) {
    const url = gi?.url ?? ''
    if (!url) continue
    if (gi.role === '整套') {
      look = look || url
      continue
    }
    const key = items.find((k) => OUTFIT_MAP[k]?.label === gi.role) ?? items[0]
    if (key) photos.push({ url, role: key, angle: angleLabel(gi.angle ?? '') })
  }
  let together = p.set_mode === 'one' && !!look
  if (p.set_mode === 'one' && items.length < 2 && look && items[0]) {
    // 不到 2 件页面不提供「一套合影」：合影图挂到这一件的正面，按分别上传回填
    photos.unshift({ url: look, role: items[0], angle: '正面' })
    look = ''
    together = false
  }
  // 快照是整套模式却没有整套图（异常 / 旧数据）：按分别上传回填，别让提交被拦
  g.restore({ selected: items, mode: together ? 'together' : 'separate', photos, look })

  modelImages.value = (Array.isArray(p.model_image_urls) ? p.model_image_urls : [])
    .filter((u): u is string => !!u)
    .slice(0, MAX_MODEL_IMAGES)

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
  // 默认校色跟着快照走（老快照没有这个字段 = 没开）
  colorFix.value = p.color_fix === true
  // 回填是一次全新的提交：bindForm 的深度 watch 会作废旧 key，这里再兜一道
  idem.invalidate()
}

/** 参数行输入 / 选择框（原型 .dm-input / .dm-pick__btn：高 30、1px line、r6、内凹影，聚焦 violet） */
const FIELD =
  'h-30px box-border border border-solid border-line rounded-6px bg-white text-11px text-ink-2 outline-none shadow-[inset_0_1px_2px_rgba(31,35,41,0.09),inset_0_0_0_1px_rgba(255,255,255,0.85)]'
const trashPath = 'M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5M10.5 11v5M13.5 11v5'
</script>

<template>
  <!-- 原型页头无步骤条：不传 steps -->
  <StudioWorkspaceColumns ref="shell" kind="tryon" title="商拍换装" @reedit="onReedit">
    <template #operate>
      <!-- 素材板（原型 .dm-mat，与工具页 /tools/ai-digital-model 同一个组件）：
           服装图 / 模特图叠片 → 补充说明 + 左下计数 → 各单品参数 -->
      <ToolTryonMaterials
        v-model:cloth="clothSlot"
        v-model:models="modelImages"
        v-model:uploading="materialsUploading"
        :cloth-spec="CLOTH_SPEC"
        :model-spec="MODEL_SPEC"
        :garment="g"
        :upload-fn="studioUpload"
        :garment-note="GARMENT_NOTE"
        :disabled="submitting"
      >
        <!-- 补充说明（原型 .dm-notes：卡面上无框 textarea 13/20；底行左计数 11px、右「默认校色」开关，上外边距 2） -->
        <div class="flex min-h-0 flex-[1_1_auto] flex-col gap-6px">
          <label for="tryon-prompt" class="sr-only">补充说明</label>
          <textarea
            id="tryon-prompt"
            v-model="form.prompt"
            class="block w-full min-h-96px flex-[1_1_auto] box-border m-0 p-0 resize-none overflow-y-auto overscroll-contain border-none bg-transparent text-13px leading-20px text-ink-2 outline-none placeholder:text-placeholder"
            :maxlength="3000"
            aria-describedby="tryon-prompt-count"
            placeholder="门襟暗扣、裤脚前开衩这类设计点写这里；包和背景不要动也可以写；不对称、镂空、绑带、五金、拼接、异形下摆也可以写（选填）"
          />
          <div class="flex items-center justify-between gap-8px mt-2px">
            <span
              id="tryon-prompt-count"
              class="text-11px leading-15px tabular-nums select-none"
              :class="form.prompt.length >= 3000 ? 'text-warning' : 'text-placeholder'"
              >{{ form.prompt.length }} / 3000</span
            >
            <ColorFixToggle v-model="colorFix" :disabled="submitting" />
          </div>
        </div>

        <!-- 各单品参数（原型 .dm-params：段距 7、上内边距 5；标题 12·600）：按件一行
             （32 缩略 + 悬停删除 / 放大 + 名称 36 + 面料 + 长度 / 袖长）；鞋子 / 配饰 / 文胸 / 内裤只有面料；没填显示「按图」 -->
        <section v-if="selectedItems.length" class="flex flex-col gap-7px pt-5px" aria-labelledby="tryon-params-title">
          <h2 id="tryon-params-title" class="m-0 flex items-baseline gap-8px text-12px font-600 text-ink">
            各单品参数
          </h2>
          <div
            v-for="item in selectedItems"
            :key="item.key"
            class="group/row relative flex items-center gap-8px min-w-0"
          >
            <span
              class="peer/thumb shrink-0 block w-32px h-32px box-border overflow-hidden border border-solid border-line rounded-4px bg-surface3"
            >
              <img
                v-if="firstPhoto(item.key)"
                class="block w-full h-full object-cover"
                :src="firstPhoto(item.key)!.url"
                alt=""
              />
            </span>
            <StudioMedBtn
              v-if="firstPhoto(item.key) && !submitting"
              :label="`删除${item.label}的这张图`"
              class="top-[-9px] left-21px !z-3 opacity-0 pointer-events-none transition-opacity duration-120 group-hover/row:(opacity-100 pointer-events-auto) group-focus-within/row:(opacity-100 pointer-events-auto) [@media(hover:none)]:(opacity-100 pointer-events-auto) motion-reduce:transition-none"
              @click.stop="g.removePhoto(firstPhoto(item.key)!.id)"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path :d="trashPath" />
              </svg>
            </StudioMedBtn>
            <span
              v-if="firstPhoto(item.key)"
              class="absolute z-26 bottom-[calc(100%+8px)] left-0 w-120px h-160px rounded-6px bg-white bg-cover bg-center bg-no-repeat shadow-[0_12px_32px_rgba(31,35,41,0.18),0_2px_8px_rgba(31,35,41,0.08)] opacity-0 translate-y-4px pointer-events-none transition-[opacity,transform] duration-140 peer-hover/thumb:(opacity-100 translate-y-0) motion-reduce:transition-none"
              :style="{ backgroundImage: `url(${firstPhoto(item.key)!.url})` }"
              aria-hidden="true"
            />
            <span class="shrink-0 w-36px text-11px text-ink-2">{{ item.label }}</span>
            <input
              v-model="fabrics[item.key]"
              :class="[FIELD, 'flex-[1_1_0] min-w-0 px-9px placeholder:text-placeholder focus:border-violet']"
              :maxlength="FABRIC_MAX"
              placeholder="面料（选填）"
              :title="`每件面料最多 ${FABRIC_MAX} 字`"
              :aria-label="`${item.label}面料`"
            />
            <!-- 长度 / 袖长：与输入框同一块材质的按钮 + 自绘向上浮层（原型 .dm-pick__menu：底 100%+4、最小同宽、内边距 4、r8；
                 行 32 高 12px（原型 26，按可点区域 ≥32 放大），选中 白→#f8f3fc + 紫字；箭头展开时转 180°；点外面 / Esc 收起，同一时间只开一个）。
                 按钮视觉 30 高，sx-hit 外扩 4 到 38（行内间距 8 的一半） -->
            <span
              v-for="pk in pickKinds(item)"
              :key="pk.kind"
              data-tryon-pick
              class="relative flex flex-[1.15_1_0] min-w-0"
            >
              <button
                type="button"
                :class="[
                  FIELD,
                  'sx-hit w-full min-w-0 flex items-center gap-5px pl-8px pr-6px cursor-pointer focus-visible:border-violet',
                  picker === `${item.key}:${pk.kind}` ? 'border-violet' : '',
                ]"
                :aria-label="`${item.label}${pk.label}`"
                :data-pick-trigger="`${item.key}:${pk.kind}`"
                aria-haspopup="listbox"
                :aria-expanded="picker === `${item.key}:${pk.kind}`"
                @click="togglePick(`${item.key}:${pk.kind}`)"
              >
                <span class="shrink-0 text-11px text-placeholder">{{ pk.label }}</span>
                <b class="flex-1 min-w-0 overflow-hidden text-left text-12px font-400 whitespace-nowrap text-ellipsis">{{
                  pickStore(pk.kind)[item.key] || '按图'
                }}</b>
                <svg
                  class="shrink-0 w-10px h-10px text-placeholder transition-transform duration-160 motion-reduce:transition-none"
                  :class="picker === `${item.key}:${pk.kind}` ? 'rotate-180' : ''"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
              <div
                v-if="picker === `${item.key}:${pk.kind}`"
                role="listbox"
                :aria-label="`${item.label}${pk.label}`"
                class="absolute z-24 bottom-[calc(100%+4px)] left-0 min-w-full max-h-260px overflow-y-auto overscroll-contain box-border p-4px rounded-8px border border-solid border-line bg-white shadow-[0_12px_32px_rgba(31,35,41,0.18),0_2px_8px_rgba(31,35,41,0.08)]"
              >
                <button
                  v-for="opt in pk.options"
                  :key="opt || 'auto'"
                  type="button"
                  role="option"
                  :aria-selected="(pickStore(pk.kind)[item.key] || '') === opt"
                  class="block w-full h-32px box-border px-8px border-0 rounded-5px text-12px text-left whitespace-nowrap cursor-pointer sx-focus"
                  :class="
                    (pickStore(pk.kind)[item.key] || '') === opt
                      ? 'bg-[linear-gradient(180deg,#fff_0%,#f8f3fc_100%)] text-violet-ink'
                      : 'bg-transparent text-ink-2 hover:bg-surface3'
                  "
                  @click="choosePick(item.key, pk.kind, opt)"
                >
                  {{ opt || '按图' }}
                </button>
              </div>
            </span>
          </div>
        </section>
      </ToolTryonMaterials>
    </template>

    <template #action>
      <!-- 原型底部：设置行（模型 | 图片设置）→ 间距 12 → 整宽主按钮（常亮，未就绪点了给提示） -->
      <div class="flex flex-col gap-12px">
        <ModelSettings
          v-model:model="form.model"
          v-model:resolution="form.resolution"
          v-model:aspect-ratio="form.aspect_ratio"
          v-model:count="form.count_per_model"
          count-label="生成张数"
          count-hint="按模特算：每位模特各出这么多张"
          auto-ratio
        />
        <StudioSubmitBar
          :label="submitText"
          :points="costPoints"
          :submitting="submitting"
          :disabled="submitting"
          :disabled-reason="notReadyReason"
          :hint="SUBMIT_HINT"
          :retry="idem.retrying.value"
          @submit="submit"
        />
      </div>
    </template>
  </StudioWorkspaceColumns>
</template>
