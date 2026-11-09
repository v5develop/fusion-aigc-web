<script setup lang="ts">
/**
 * 姿态复刻工作台（三栏：左操作 / 中历史 / 右预览）。
 *
 * <p>一张人物图锁定身份 / 服装 / 场景，1–9 张姿势参考图各出一个任务。
 * 补充说明拆两处：全局说明放 global_prompt，单张动作说明按姿势下标进 pose_prompts。
 * 服务端按姿势拆任务，每张的提示词 = 全局补充 + 本张补充（换行拼，空的不写）；姿态没有「生成张数」。
 * 版式对齐线上原型 /tools/ai-posture-fission（.pm-mat / .pm-slots / 两列逐张补充）：入口、补充说明、各姿势补充同在一块输入框里；
 * 两块入口见 PoseMaterialSlots，逐张补充见 PoseNotesList。原型的提交按钮不置灰，未就绪在点击时由 submit() 提示。
 */
import { computed, reactive, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { studioSubmitPose } from '@/api/studio.ts'
import type { StudioPosePayload, StudioPoseSubmitReq } from '@/api/studioTypes.ts'
import StudioWorkspaceColumns from '../components/StudioWorkspaceColumns/index.vue'
import StudioSubmitBar from '../components/StudioSubmitBar/index.vue'
import ColorFixToggle from '../components/StudioSubmitBar/ColorFixToggle.vue'
import { useColorFix } from '@/views/studio/colorfix/useColorFix'
import ModelSettings from '../components/ModelSettings/index.vue'
import PoseMaterialSlots from './PoseMaterialSlots.vue'
import PoseNotesList from './PoseNotesList.vue'
import PosePairingPanel from './PosePairingPanel.vue'
import { usePosePairing } from './usePosePairing.ts'
import { useIdempotentSubmit, useStudioCost } from '../hooks.ts'
import { MAX_POSE_IMAGES, MODEL_OPTIONS, RESOLUTION_OPTIONS } from '../constants.ts'

defineOptions({ name: 'studio-pose' })

const message = useMessage()

// ---------------- 表单 ----------------

const sourceImages = ref<string[]>([])
const poseImages = ref<string[]>([])
/** 逐张「动作补充」按 url 记：删掉中间一张姿势图，其余说明不会串位 */
const poseNotes = reactive<Record<string, string>>({})
const form = reactive({
  global_prompt: '',
  model: '通用',
  resolution: '1k',
  aspect_ratio: '3:4',
})

/** 组装 pose_prompts：键为姿势下标字符串（从 0 起），空说明不下发 */
const posePrompts = computed(() => {
  const out: Record<string, string> = {}
  poseImages.value.forEach((url, i) => {
    const note = (poseNotes[url] ?? '').trim()
    if (note) out[String(i)] = note
  })
  return out
})

/** 逐张补充那一行删图：图和它的说明一起删 */
function removePose(url: string) {
  const at = poseImages.value.indexOf(url)
  if (at >= 0) poseImages.value.splice(at, 1)
  delete poseNotes[url]
}

/** 多人配对（付费前确认）：状态随人物图 / 姿势图签名失效，没跑识别时提交体不带任何配对字段 */
const pairing = usePosePairing(sourceImages, poseImages)

/** 叠片右上清空：姿势图和全部逐张说明一起清 */
function clearPoses() {
  poseImages.value = []
  Object.keys(poseNotes).forEach((k) => delete poseNotes[k])
}

// ---------------- 提交 ----------------

const submitting = ref(false)
const shell = ref<InstanceType<typeof StudioWorkspaceColumns> | null>(null)

/** 幂等重试：失败缓存 key 进「重试生成」态；表单任意字段变化换新 key */
const idem = useIdempotentSubmit()

/** 默认校色（与结果区校色面板同一份状态）：提交时作 color_fix 下发 */
const { enabled: colorFix } = useColorFix()

/** 按钮第二行「消耗 N 点」：把提交体里影响价格的字段（张数 / 模型 / 分辨率 / 比例）原样发给报价接口，拿不到价就不显示 */
const { points: costPoints } = useStudioCost('pose', () => ({
  pose_image_urls: poseImages.value,
  model: form.model || undefined,
  resolution: form.resolution || undefined,
  aspect_ratio: form.aspect_ratio || undefined,
}))
idem.bindForm(form, sourceImages, poseImages, poseNotes, pairing.state, colorFix)

const submitText = computed(() => (poseImages.value.length ? `开始复刻（${poseImages.value.length} 张）` : '开始复刻'))

/** 未就绪原因：按钮保持可点（点了 toast 同一句），悬停在提交条上能看到；空 = 就绪 */
const disabledReason = computed(() => {
  if (!sourceImages.value.length) return '上传一张人物图（图里需有人物，且不能是未成年人）'
  if (!poseImages.value.length) return '上传 1–9 张姿势参考图'
  return ''
})
const SUBMIT_HINT = '每个姿势一个任务，单独出图'

async function submit() {
  if (submitting.value) return
  if (!sourceImages.value.length) return message.warning('请上传一张人物图（图里需有人物，且不能是未成年人）')
  if (!poseImages.value.length) return message.warning('请上传 1–9 张姿势参考图')

  // 提交即放弃进行中的识别；有效的多人配对先校验，不合规直接拦下
  pairing.cancel()
  const pair = pairing.buildPayload()
  if (pair && 'error' in pair) return message.warning(pair.error)

  const prompts = posePrompts.value
  const body: StudioPoseSubmitReq = {
    source_image_url: sourceImages.value[0] ?? '',
    pose_image_urls: [...poseImages.value],
    global_prompt: form.global_prompt.trim() || undefined,
    ...(Object.keys(prompts).length ? { pose_prompts: prompts } : {}),
    model: form.model || undefined,
    resolution: form.resolution || undefined,
    aspect_ratio: form.aspect_ratio || undefined,
    ...(pair ? { source_person_count: pair.sourcePersonCount, mappings: pair.mappings } : {}),
    color_fix: colorFix.value,
  }

  submitting.value = true
  try {
    // 重试沿用失败那次的 Idempotency-Key（同 key 同 body 契约幂等），改过表单则是新 key
    const res = await studioSubmitPose(body, { 'Idempotency-Key': idem.take() })
    idem.settle()
    const d = res.data
    const points = d?.estimated_points
    message.success(
      `已提交 ${d?.task_total ?? poseImages.value.length} 个复刻任务${points ? `，预估消耗 ${points} 点` : ''}${
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
  const p = payload as unknown as StudioPosePayload

  sourceImages.value = []
  poseImages.value = []
  Object.keys(poseNotes).forEach((k) => delete poseNotes[k])

  sourceImages.value = p.source_image_url ? [p.source_image_url] : []
  const poses = (Array.isArray(p.pose_image_urls) ? p.pose_image_urls : []).filter((u): u is string => !!u)
  poseImages.value = poses
  // 快照里的单张说明按下标找回姿势图（按 url 记，避免后续删图串位）
  for (const [k, v] of Object.entries(p.pose_prompts ?? {})) {
    const url = poses[Number(k)]
    if (url && typeof v === 'string') poseNotes[url] = v
  }

  form.global_prompt = typeof p.global_prompt === 'string' ? p.global_prompt : ''
  form.model = MODEL_OPTIONS.some((o) => o.value === p.model) ? (p.model as string) : '通用'
  form.resolution = RESOLUTION_OPTIONS.some((o) => o.value === p.resolution) ? (p.resolution as string) : '1k'
  form.aspect_ratio = typeof p.aspect_ratio === 'string' ? p.aspect_ratio : ''
  pairing.restore(p, sourceImages.value, poseImages.value)
  // 默认校色跟着快照走（老快照没有这个字段 = 没开）
  colorFix.value = p.color_fix === true
  // 回填是一次全新的提交：bindForm 的深度 watch 会作废旧 key，这里再兜一道
  idem.invalidate()
}
</script>

<template>
  <StudioWorkspaceColumns ref="shell" kind="pose" title="姿态复刻" @reedit="onReedit">
    <template #operate>
      <!-- 原型 .pm-mat：一块输入框装下 人物图 / 姿势图 → 补充说明 + 计数 → 各姿势补充 -->
      <!-- flex-1：卡吃满操作区剩余高度（原型 .pm-mat flex 1 1 auto），补充说明框跟着长 -->
      <div
        class="flex min-h-320px flex-1 flex-col gap-10px box-border p-12px rounded-6px border border-solid border-line bg-white shadow-[inset_0_0_16px_rgba(31,35,41,0.12),inset_0_1px_0_rgba(31,35,41,0.05)]"
      >
        <!-- 人物图 + 姿势图：两块白边浮片同排，中间切口；人物图悬停单图预览，姿势图悬停摊开 + 3 列序号面板 -->
        <PoseMaterialSlots
          v-model:source="sourceImages"
          v-model:poses="poseImages"
          :max="MAX_POSE_IMAGES"
          :disabled="submitting"
          @remove-pose="removePose"
          @clear-poses="clearPoses"
        />

        <PosePairingPanel
          v-if="sourceImages.length && poseImages.length"
          :state="pairing.state.value"
          :stale="pairing.stale.value"
          :running="pairing.running.value"
          :elapsed="pairing.elapsed.value"
          :error-text="pairing.errorText.value"
          :can-run="pairing.canRun.value"
          :cooldown="pairing.cooldown.value"
          :disabled="submitting"
          @run="pairing.run"
          @cancel="pairing.abort"
          @reverse="pairing.reverse"
          @reset="pairing.reset"
          @set="pairing.setMapping"
        />

        <!-- 补充说明（全局）：框内无边 textarea；底行左计数 11px、右「默认校色」开关 -->
        <div class="flex min-h-0 flex-1 flex-col gap-6px">
          <label for="pose-global-prompt" class="sr-only">补充说明</label>
          <textarea
            id="pose-global-prompt"
            v-model="form.global_prompt"
            class="block w-full min-h-96px flex-1 box-border m-0 p-0 resize-none overflow-y-auto overscroll-contain border-none bg-transparent text-13px leading-20px text-ink-2 outline-none placeholder:text-placeholder"
            :maxlength="3000"
            aria-describedby="pose-global-prompt-count"
            placeholder="这套姿势统一的补充要求，会加到每一张里，例如：动作幅度小一点、手里不要拿东西（选填）"
          />
          <div class="flex items-center justify-between gap-8px mt-2px">
            <span
              id="pose-global-prompt-count"
              class="text-11px leading-15px tabular-nums select-none"
              :class="form.global_prompt.length >= 3000 ? 'text-warning' : 'text-placeholder'"
              >{{ form.global_prompt.length }} / 3000</span
            >
            <ColorFixToggle v-model="colorFix" :disabled="submitting" />
          </div>
        </div>

        <!-- 各姿势补充：两列，每格 32 缩略图（悬停小预览 / 右上删除）+ 30 高 / 11px 单行输入（200 字） -->
        <PoseNotesList v-model:notes="poseNotes" :items="poseImages" :disabled="submitting" @remove="removePose" />
      </div>
    </template>

    <template #action>
      <!-- 原型底部：设置行（模型 | 图片设置）→ 整宽主按钮 -->
      <div class="flex flex-col gap-12px">
        <ModelSettings
          v-model:model="form.model"
          v-model:resolution="form.resolution"
          v-model:aspect-ratio="form.aspect_ratio"
          auto-ratio
        />
        <StudioSubmitBar
          :label="submitText"
          :points="costPoints"
          :submitting="submitting"
          :disabled-reason="disabledReason"
          :hint="SUBMIT_HINT"
          :retry="idem.retrying.value"
          @submit="submit"
        />
      </div>
    </template>
  </StudioWorkspaceColumns>
</template>
