<script setup lang="ts">
/**
 * 对话卡片：扣点同意卡（CONTRACT §D / AGENT §13.1–13.2）。
 * 五行固定：本次点数（含后续）/ 预计耗时 / 失败退点 / AI 标识与水印 / 重做规则；需要时加肖像授权勾选（勾上才能点主按钮）。
 * 点主按钮 = 以 `continue` 回答预算确认中断，「先不做」= `cancel`，答案怎么提交由页面决定（与通用表单同一条路径）。
 * 这里不调任何复刻 REST。
 */
import { computed, ref } from 'vue'
import { consentPrimaryLabel, isCancelConsent, type ReplicateConsent } from '@/api/replicate-card.ts'
import { fmtPts } from '@/views/video-replicate/constants.ts'

const props = defineProps<{
  consent: ReplicateConsent
  /** 能不能作答（轮次已收尾、是最后一条、没有流在跑） */
  open: boolean
  submitting?: boolean
  /** 已作答：'continue' | 'cancel'；已失效（被后续消息取代）为 'expired'；未作答为空 */
  result?: '' | 'continue' | 'cancel' | 'expired'
  error?: string
}>()
const emit = defineEmits<{ (e: 'answer', choice: 'continue' | 'cancel', portrait: boolean): void }>()

const portrait = ref(false)
const needPortrait = computed(() => props.consent.needsPortraitConsent)
/** 大额以后端下发的 large_amount 为准（前端不再自己按点数阈值判断）：金额标红 + 必须勾选确认 */
const large = computed(() => props.consent.largeAmount)
const amountOk = ref(false)
const blocked = computed(
  () =>
    !props.open ||
    !!props.submitting ||
    (needPortrait.value && !portrait.value) ||
    (large.value && !amountOk.value),
)
const pointsLine = computed(() => {
  const c = props.consent
  const rest = c.restPoints > 0 ? `，做完全部还需约 ${fmtPts(c.restPoints)} 点` : ''
  return `本次扣 ${fmtPts(c.points)} 点${rest}`
})
/** 终止卡（停止 / 不做剩下的段）：不扣点，写明退回与保留，不显示五行费用 */
const cancelKind = computed(() => isCancelConsent(props.consent))
const cancelText = computed(() => {
  const c = props.consent
  if (c.action === 'stop') return '只保留已做好的第 1 段，剩下的段不做、不收费。'
  const running = c.running > 0 ? `正在生成的 ${c.running} 段会做完并照常收费；` : ''
  return `不做剩下的 ${c.cancelSegments} 段，退回 ${fmtPts(c.refundPoints)} 点；${running}已做好的段保留。`
})
const lines = computed(() => {
  const c = props.consent
  return [
    { k: '耗时', v: c.etaText },
    { k: '退点', v: c.refundText },
    { k: '标识', v: [c.aiMarkText, c.watermarkText].filter(Boolean).join('；') },
    { k: '重做', v: c.redoText },
  ].filter((l) => l.v)
})
</script>

<template>
  <section class="sx-squircle w-full max-w-480px rounded-18px sx-soft px-16px py-14px" aria-label="扣点确认">
    <!-- 已作答 / 已失效：收成一行摘要 -->
    <template v-if="result">
      <p class="m-0 text-13px leading-20px" :class="result === 'continue' ? 'text-ink' : 'text-muted'" role="status">
        <template v-if="result === 'continue'">已确认 · {{ cancelKind ? cancelText : pointsLine }}</template>
        <template v-else-if="result === 'cancel'">{{ cancelKind ? '好的，不取消，继续生成' : '先不做了，没有扣点' }}</template>
        <template v-else>这张确认没有作答，已被后面的消息取代</template>
      </p>
    </template>
    <template v-else>
      <template v-if="cancelKind">
        <h3 class="vr-h3">{{ consent.action === 'stop' ? '确认不继续生成' : '确认不做剩下的段' }}</h3>
        <p class="m-0 text-13px leading-20px text-ink">{{ cancelText }}</p>
      </template>
      <template v-else>
      <h3 class="vr-h3">确认后开始，成功才扣点</h3>
      <p v-if="consent.priceChangedFrom > 0" class="m-0 mb-6px text-12px leading-18px text-warning" role="status">
        价格变了：原来 {{ fmtPts(consent.priceChangedFrom) }} 点，现在 {{ fmtPts(consent.points) }} 点
      </p>
      <ul class="m-0 flex list-none flex-col gap-6px p-0">
        <li class="flex gap-8px text-13px leading-20px">
          <b class="w-32px flex-none font-600 text-muted">点数</b>
          <span :class="['min-w-0 flex-1 font-600 tabular-nums', large ? 'text-danger' : 'text-ink']">{{ pointsLine }}</span>
        </li>
        <li v-for="l in lines" :key="l.k" class="flex gap-8px text-12px leading-18px">
          <b class="w-32px flex-none font-600 text-muted">{{ l.k }}</b>
          <span class="min-w-0 flex-1 break-words text-ink-2">{{ l.v }}</span>
        </li>
      </ul>
      <label v-if="needPortrait" class="mt-10px flex cursor-pointer items-start gap-8px text-12px leading-18px text-ink-2">
        <input v-model="portrait" type="checkbox" class="mt-2px" :disabled="!open || submitting" />
        图中是我本人，或已获得本人同意，可用于生成视频
      </label>
      <label v-if="large" class="mt-10px flex cursor-pointer items-start gap-8px text-12px leading-18px text-danger">
        <input v-model="amountOk" type="checkbox" class="mt-2px" :disabled="!open || submitting" />
        我已确认本次扣 {{ fmtPts(consent.points) }} 点（金额较大）
      </label>
      </template>
      <p v-if="error" class="m-0 mt-8px text-12px text-danger" role="alert">{{ error }}</p>
      <div class="mt-12px flex flex-wrap items-center gap-8px">
        <button type="button" class="sx-btn-primary !h-40px !px-18px" :disabled="blocked" @click="emit('answer', 'continue', portrait)">
          {{ consentPrimaryLabel(consent) }}
        </button>
        <button type="button" class="sx-btn !h-40px" :disabled="!open || submitting" @click="emit('answer', 'cancel', false)">{{ cancelKind ? '再想想' : '先不做' }}</button>
        <span v-if="open && ((needPortrait && !portrait) || (large && !amountOk))" class="text-11px text-placeholder">先勾选上面的确认</span>
      </div>
    </template>
  </section>
</template>
