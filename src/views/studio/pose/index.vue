<script setup lang="ts">
/**
 * 姿态复刻工作台（三栏：左操作 / 中历史 / 右预览）。
 *
 * <p>一张人物图锁定身份 / 服装 / 场景，1–9 张姿势参考图各出一个任务。
 * 补充说明拆两处：全局说明放 global_prompt，单张动作说明按姿势下标进 pose_prompts。
 * 服务端按姿势拆任务，每张的提示词 = 全局补充 + 本张补充（换行拼，空的不写）；姿态没有「生成张数」。
 * 两块入口为 s1.1 白边浮片叠片（StudioImageUpload），同排、中间切口；姿势满 9 张只拦点击 / 拖入，悬停照常摊开。
 */
import { computed, reactive, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { studioSubmitPose } from '@/api/studio.ts'
import type { StudioPosePayload, StudioPoseSubmitReq } from '@/api/studioTypes.ts'
import StudioWorkspaceColumns from '../components/StudioWorkspaceColumns/index.vue'
import StudioImageUpload from '../components/StudioImageUpload/index.vue'
import StudioSubmitBar from '../components/StudioSubmitBar/index.vue'
import ModelSettings from '../components/ModelSettings/index.vue'
import StudioMedBtn from '../components/StudioImageUpload/StudioMedBtn.vue'
import { useIdempotentSubmit } from '../hooks.ts'
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
  aspect_ratio: '',
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

// ---------------- 提交 ----------------

const submitting = ref(false)
const shell = ref<InstanceType<typeof StudioWorkspaceColumns> | null>(null)

/** 幂等重试：失败缓存 key 进「重试生成」态；表单任意字段变化换新 key */
const idem = useIdempotentSubmit()
idem.bindForm(form, sourceImages, poseImages, poseNotes)

const submitText = computed(() => (poseImages.value.length ? `开始复刻（${poseImages.value.length} 张）` : '开始复刻'))
const metaText = computed(() => `共 ${poseImages.value.length} 张 = 每张姿势参考图各出一个任务`)

/** 未就绪原因（提交条置灰展示）；空 = 就绪 */
const disabledReason = computed(() => {
  if (!sourceImages.value.length) return '上传一张人物图（图里需有人物，且不能是未成年人）'
  if (!poseImages.value.length) return '上传 1–9 张姿势参考图'
  return ''
})

async function submit() {
  if (submitting.value) return
  if (!sourceImages.value.length) return message.warning('请上传一张人物图（图里需有人物，且不能是未成年人）')
  if (!poseImages.value.length) return message.warning('请上传 1–9 张姿势参考图')

  const prompts = posePrompts.value
  const body: StudioPoseSubmitReq = {
    source_image_url: sourceImages.value[0] ?? '',
    pose_image_urls: [...poseImages.value],
    global_prompt: form.global_prompt.trim() || undefined,
    ...(Object.keys(prompts).length ? { pose_prompts: prompts } : {}),
    model: form.model || undefined,
    resolution: form.resolution || undefined,
    aspect_ratio: form.aspect_ratio || undefined,
  }

  submitting.value = true
  try {
    // 重试沿用失败那次的 Idempotency-Key（同 key 同 body 契约幂等），改过表单则是新 key
    const res = await studioSubmitPose(body, { 'Idempotency-Key': idem.take() })
    idem.settle()
    const d = res.data
    message.success(
      `已提交 ${d?.task_total ?? poseImages.value.length} 张，预估消耗 ${d?.estimated_points ?? 0} 点${
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
  // 回填是一次全新的提交：bindForm 的深度 watch 会作废旧 key，这里再兜一道
  idem.invalidate()
}
</script>

<template>
  <StudioWorkspaceColumns ref="shell" kind="pose" title="姿态复刻" @reedit="onReedit">
    <template #operate>
      <!-- 人物图 + 姿势参考图：两块白边浮片同排，中间切口 -->
      <div class="mb-16px">
        <div class="ll-section-title flex items-baseline gap-6px">
          人物图 · 姿势参考图<span class="text-11px text-placeholder font-400"
            >姿势 {{ poseImages.length }}/{{ MAX_POSE_IMAGES }} · 每张出一个任务</span
          >
        </div>
        <div class="flex items-start gap-16px">
          <StudioImageUpload v-model="sourceImages" :max="1" :multiple="false" label="人物图" hint="1 张" cloud />
          <StudioImageUpload v-model="poseImages" :max="MAX_POSE_IMAGES" panel-fill label="姿势图" cloud />
        </div>
        <div class="mt-8px text-11px leading-16px text-placeholder">
          人物图锁定身份 / 服装 / 场景；姿势图只取动作与表情
        </div>
      </div>

      <!-- 逐张动作说明 -->
      <div v-if="poseImages.length" class="mb-16px">
        <div class="ll-section-title flex items-baseline gap-6px">
          逐张动作说明<span class="text-11px text-placeholder font-400">选填，对应每张姿势图</span>
        </div>
        <!-- 两列：每格 32 缩略图 + 30 高 / 11px 单行输入；缩略图右上角悬停出删除 -->
        <div class="grid grid-cols-2 gap-x-12px gap-y-8px items-start mt-5px">
          <div v-for="(url, i) in poseImages" :key="url" class="group relative flex items-center gap-8px min-w-0">
            <span
              class="shrink-0 block w-32px h-32px box-border overflow-hidden border border-solid border-line rounded-4px bg-surface3"
            >
              <img class="block w-full h-full object-cover" :src="url" :alt="`姿势${i + 1}`" />
            </span>
            <StudioMedBtn
              :label="`删除姿势${i + 1}`"
              class="top-[-9px] left-21px z-2 opacity-0 pointer-events-none transition-opacity duration-120 group-hover:(opacity-100 pointer-events-auto) group-focus-within:(opacity-100 pointer-events-auto) motion-reduce:transition-none"
              @click="removePose(url)"
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
                <path d="M4.5 7h15M9.5 7V5h5v2M6.5 7l1 12.5h9l1-12.5M10.5 11v5M13.5 11v5" />
              </svg>
            </StudioMedBtn>
            <input
              v-model="poseNotes[url]"
              type="text"
              class="flex-[1_1_0] w-0 min-w-0 h-30px box-border px-10px border border-solid border-line rounded-6px bg-white text-11px leading-18px text-ink outline-none shadow-[inset_0_1px_2px_rgba(31,35,41,0.09)] placeholder:text-placeholder focus:border-violet"
              :maxlength="3000"
              placeholder="这张的动作补充（选填）"
              :aria-label="`姿势${i + 1}：动作补充`"
            />
          </div>
        </div>
      </div>

      <!-- 全局说明 -->
      <div class="mb-16px">
        <div class="ll-section-title flex items-baseline gap-6px">
          全局补充说明<span class="text-11px text-placeholder font-400">选填，对所有姿势生效</span>
        </div>
        <n-input
          v-model:value="form.global_prompt"
          type="textarea"
          :rows="3"
          :maxlength="3000"
          show-count
          placeholder="如：保持服装不变，表情自然，室内暖光"
        />
      </div>

      <!-- 生图参数 -->
      <div class="mb-16px">
        <div class="ll-section-title flex items-baseline gap-6px">生图参数</div>
        <ModelSettings
          v-model:model="form.model"
          v-model:resolution="form.resolution"
          v-model:aspect-ratio="form.aspect_ratio"
          auto-ratio
        />
      </div>
    </template>

    <template #action>
      <StudioSubmitBar
        :label="submitText"
        :submitting="submitting"
        :disabled="!!disabledReason"
        :disabled-reason="disabledReason"
        :meta-text="metaText"
        :retry="idem.retrying.value"
        @submit="submit"
      />
    </template>
  </StudioWorkspaceColumns>
</template>
