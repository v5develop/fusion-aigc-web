<script setup lang="ts">
/**
 * 图片生成工作台（三栏：左操作 / 中历史 / 右预览）。
 *
 * <p>原型「画面描述」一体卡：参考图（≤9）+ 提示词（必填，可从我的提示词选择）+ 输入润色开关；
 * 底部 模型 / 图片设置（含生成张数 1–9）+ 立即生成。
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
import PromptLibraryPicker from '../components/PromptLibraryPicker/index.vue'
import { PromptWriteButton } from '@/components/prompt-write'
import { useIdempotentSubmit, useStudioCost } from '../hooks.ts'
import { MAX_REF_IMAGES, MODEL_OPTIONS, RESOLUTION_OPTIONS } from '../constants.ts'

defineOptions({ name: 'studio-imagegen' })

const message = useMessage()

// ---------------- 表单 ----------------

const form = reactive({
  prompt: '',
  model: '通用',
  resolution: '1k',
  aspect_ratio: '3:4',
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

/** 按钮第二行「消耗 N 点」：把提交体里影响价格的字段（张数 / 模型 / 分辨率 / 比例）原样发给报价接口，拿不到价就不显示 */
const { points: costPoints } = useStudioCost('imagegen', () => ({
  count: form.count,
  model: form.model || undefined,
  resolution: form.resolution || undefined,
  aspect_ratio: form.aspect_ratio || undefined,
}))
idem.bindForm(form, refImages)

/** 按钮文案对齐原型「立即生成」 */
const submitText = '立即生成'

/** 未就绪（提交条置灰）：没写提示词；原型不在按钮上方写原因 */
const notReady = computed(() => !form.prompt.trim())

/** 提示词字数上限（与原 CreationPromptInput 传值一致） */
const PROMPT_MAX = 3000

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
      <!--
        原型「画面描述」一体卡：顶行 参考图计数 0/9 + 我的提示词（书本图标）→ 参考图浮片 → 提示词输入
        → 底行 字数计数 + 输入润色开关。外观沿用 CreationPromptInput 的输入框（line 描边、圆角 6、四边内影、聚焦藤紫光晕）。
      -->
      <section
        class="flex min-h-320px flex-1 flex-col gap-12px box-border rounded-10px border border-solid border-line bg-white p-12px shadow-[inset_0_0_8px_1px_rgba(31,35,41,0.10),inset_0_1px_0_rgba(31,35,41,0.05)] [transition:box-shadow_110ms] motion-reduce:transition-none focus-within:shadow-[inset_0_0_16px_rgba(31,35,41,0.12),inset_0_1px_0_rgba(31,35,41,0.05),0_0_0_3px_rgba(135,95,154,0.14)]"
        aria-labelledby="imagegen-prompt-label"
      >
        <div class="flex items-center justify-between gap-8px">
          <span class="text-11px leading-16px tabular-nums text-placeholder" aria-label="参考图数量"
            >{{ refImages.length }}/{{ MAX_REF_IMAGES }}</span
          >
          <PromptWriteButton v-model="form.prompt" biz-type="image-prompt" :image-urls="refImages" />
          <button
            type="button"
            class="grid h-24px w-24px cursor-pointer place-items-center rounded-sm border-none bg-transparent p-0 text-ink-2 hover:text-violet sx-focus"
            aria-label="我的提示词"
            title="我的提示词"
            @click="pickerShow = true"
          >
            <svg
              class="h-16px w-16px"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z" />
              <path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z" />
            </svg>
          </button>
        </div>

        <!-- 单角色参考图槽（s1.1 MlReferenceSlots 口径）：60×100 白边浮片 + 右下云钮（资产添加） -->
        <div class="flex items-start gap-16px">
          <StudioImageUpload v-model="refImages" :max="MAX_REF_IMAGES" name="参考图" cloud />
        </div>

        <label id="imagegen-prompt-label" for="imagegen-prompt" class="sr-only">画面描述（必填）</label>
        <textarea
          id="imagegen-prompt"
          v-model="form.prompt"
          :maxlength="PROMPT_MAX"
          placeholder="描述想要的画面：主体、场景、风格、光影"
          aria-describedby="imagegen-prompt-count"
          class="block min-h-120px w-full flex-1 box-border m-0 resize-none overflow-y-auto overscroll-contain border-none bg-transparent p-0 text-13px leading-20px text-ink outline-none placeholder:text-placeholder"
        />

        <div class="flex h-24px flex-none items-center justify-between gap-8px">
          <span
            id="imagegen-prompt-count"
            class="select-none text-11px leading-16px tabular-nums"
            :class="form.prompt.length >= PROMPT_MAX ? 'text-warning' : 'text-placeholder'"
            :aria-live="form.prompt.length >= PROMPT_MAX ? 'polite' : undefined"
            >{{ form.prompt.length }} / {{ PROMPT_MAX }}</span
          >
          <span class="flex items-center gap-6px">
            <span id="imagegen-rewrite-label" class="text-12px leading-16px text-ink-2">输入润色</span>
            <n-switch v-model:value="form.rewrite_prompt" size="small" aria-labelledby="imagegen-rewrite-label" />
          </span>
        </div>
      </section>

      <!-- 弹层放壳内：跟 naive 组件同处 llTheme 的 abstract provider 下（teleport 不丢主题） -->
      <PromptLibraryPicker v-model:show="pickerShow" @select="onPickPrompt" />
    </template>

    <template #action>
      <!-- 原型底部：设置行（模型 | 图片设置）→ 段距 12 → 整宽主按钮 -->
      <div class="flex flex-col gap-12px">
        <ModelSettings
          v-model:model="form.model"
          v-model:resolution="form.resolution"
          v-model:aspect-ratio="form.aspect_ratio"
          v-model:count="form.count"
        />
        <StudioSubmitBar
          :label="submitText"
          :points="costPoints"
          :submitting="submitting"
          :disabled="notReady"
          :retry="idem.retrying.value"
          @submit="submit"
        />
      </div>
    </template>
  </StudioWorkspaceColumns>
</template>
