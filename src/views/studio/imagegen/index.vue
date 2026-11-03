<script setup lang="ts">
/**
 * 图片生成工作台（三栏：左操作 / 中历史 / 右预览）。
 *
 * <p>提示词（必填，可从提示词库选择）+ 参考图（≤9）+ 生成张数（1–9）+ 润色开关。
 * count 张拆 count 个任务；比例默认 1:1（无「自动」档）。
 */
import { computed, reactive, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { studioSubmitImageGen } from '@/api/studio.ts'
import type { StudioImageGenPayload, StudioImageGenSubmitReq } from '@/api/studioTypes.ts'
import StudioWorkspaceColumns from '../components/StudioWorkspaceColumns/index.vue'
import StudioImageUpload from '../components/StudioImageUpload/index.vue'
import StudioSubmitBar from '../components/StudioSubmitBar/index.vue'
import ModelSettings from '../components/ModelSettings/index.vue'
import CreationPromptInput from '@/components/creation/CreationPromptInput.vue'
import PromptLibraryPicker from '../components/PromptLibraryPicker/index.vue'
import { useIdempotentSubmit } from '../hooks.ts'
import { MAX_REF_IMAGES, MODEL_OPTIONS, RESOLUTION_OPTIONS } from '../constants.ts'

defineOptions({ name: 'studio-imagegen' })

const message = useMessage()

// ---------------- 表单 ----------------

const form = reactive({
  prompt: '',
  model: '通用',
  resolution: '1k',
  aspect_ratio: '1:1',
  count: 1,
  rewrite_prompt: false,
})
const refImages = ref<string[]>([])

// ---------------- 提示词库 ----------------

const pickerShow = ref(false)

function onPickPrompt(prompt: string) {
  form.prompt = prompt
}

// ---------------- 提交 ----------------

const submitting = ref(false)
const shell = ref<InstanceType<typeof StudioWorkspaceColumns> | null>(null)

/** 幂等重试：失败缓存 key 进「重试生成」态；表单任意字段变化换新 key */
const idem = useIdempotentSubmit()
idem.bindForm(form, refImages)

const submitText = computed(() => `开始生成（${form.count} 张）`)

/** 未就绪原因（提交条置灰展示）；空 = 就绪 */
const disabledReason = computed(() => (form.prompt.trim() ? '' : '输入提示词，或从提示词库选择'))

async function submit() {
  if (submitting.value) return
  if (!form.prompt.trim()) return message.warning('请输入提示词')

  const body: StudioImageGenSubmitReq = {
    prompt: form.prompt.trim(),
    ...(refImages.value.length ? { image_urls: [...refImages.value] } : {}),
    model: form.model || undefined,
    resolution: form.resolution || undefined,
    aspect_ratio: form.aspect_ratio || undefined,
    count: form.count,
    rewrite_prompt: form.rewrite_prompt,
  }

  submitting.value = true
  try {
    // 重试沿用失败那次的 Idempotency-Key（同 key 同 body 契约幂等），改过表单则是新 key
    const res = await studioSubmitImageGen(body, { 'Idempotency-Key': idem.take() })
    idem.settle()
    const d = res.data
    message.success(
      `已提交 ${d?.task_total ?? form.count} 张，预估消耗 ${d?.estimated_points ?? 0} 点${
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
  const p = payload as unknown as StudioImageGenPayload

  refImages.value = (Array.isArray(p.image_urls) ? p.image_urls : []).filter((u): u is string => !!u)

  form.prompt = typeof p.prompt === 'string' ? p.prompt : ''
  form.model = MODEL_OPTIONS.some((o) => o.value === p.model) ? (p.model as string) : '通用'
  form.resolution = RESOLUTION_OPTIONS.some((o) => o.value === p.resolution) ? (p.resolution as string) : '1k'
  form.aspect_ratio = typeof p.aspect_ratio === 'string' && p.aspect_ratio ? p.aspect_ratio : '1:1'
  form.count = Math.min(9, Math.max(1, Math.round(Number(p.count) || 1)))
  form.rewrite_prompt = p.rewrite_prompt === true
  // 回填是一次全新的提交：bindForm 的深度 watch 会作废旧 key，这里再兜一道
  idem.invalidate()
}
</script>

<template>
  <StudioWorkspaceColumns ref="shell" kind="imagegen" title="图片生成" @reedit="onReedit">
    <template #operate>
      <!-- 参考图 -->
      <div class="mb-16px">
        <div class="ll-section-title flex items-baseline gap-6px">
          参考图<span class="text-11px text-placeholder font-400"
            >选填，{{ refImages.length }}/{{ MAX_REF_IMAGES }}</span
          >
        </div>
        <!-- 单角色参考图槽（s1.1 MlReferenceSlots 口径）：60×100 白边浮片，数量写在标题，片下不写说明 -->
        <div class="flex items-start gap-16px">
          <StudioImageUpload v-model="refImages" :max="MAX_REF_IMAGES" cloud />
        </div>
      </div>

      <!-- 提示词 -->
      <div class="mb-16px">
        <div class="ll-section-title flex items-baseline gap-6px">
          提示词<span class="text-11px text-placeholder font-400">必填</span>
          <span class="ll-link ml-auto" @click="pickerShow = true">从提示词库选择</span>
        </div>
        <CreationPromptInput
          v-model="form.prompt"
          :rows="5"
          :max-length="3000"
          aria-label="提示词"
          placeholder="描述想生成的画面，如：一只在窗边晒太阳的橘猫，胶片质感"
        />
      </div>

      <!-- 提示词润色 -->
      <div class="mb-16px flex items-start justify-between gap-12px">
        <div>
          <div class="ll-section-title flex items-baseline gap-6px">提示词自动润色</div>
          <div class="mt-4px text-11px text-placeholder">
            开启后先由 AI 润色一次提示词再生成，批次会多一步「反推中」
          </div>
        </div>
        <n-switch v-model:value="form.rewrite_prompt" size="small" />
      </div>

      <!-- 弹层放壳内：跟 naive 组件同处 llTheme 的 abstract provider 下（teleport 不丢主题） -->
      <PromptLibraryPicker v-model:show="pickerShow" @select="onPickPrompt" />
    </template>

    <template #action>
      <!-- 原型底部：设置行（模型 | 图片设置）→ 整宽主按钮 -->
      <div class="flex flex-col gap-12px">
        <ModelSettings
          v-model:model="form.model"
          v-model:resolution="form.resolution"
          v-model:aspect-ratio="form.aspect_ratio"
          v-model:count="form.count"
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
