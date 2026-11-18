<script setup lang="ts">
/**
 * 「需求复杂？去对话里说」：带上原片与全部素材（和想怎么改的原文）跳到智能体页，复刻技能预选。
 * 素材经 sessionStorage 一次性交接（agentHandoff.ts），存储不可用时只跳转。
 */
import { useRouter } from 'vue-router'
import { REPLICATE_SKILL_ID } from '@/api/agent.ts'
import type { useReplicate } from '../useReplicate.ts'

const props = defineProps<{ rep: ReturnType<typeof useReplicate> }>()
const router = useRouter()
function go() {
  const ok = props.rep.handoffToAgent()
  void router.push({ path: '/agent', query: { skill: REPLICATE_SKILL_ID, ...(ok ? { handoff: '1' } : {}) } })
}
</script>

<template>
  <p class="m-0 text-center text-12px text-muted">
    需求复杂？
    <button
      type="button"
      class="border-0 bg-transparent p-0 text-12px text-violet-ink underline cursor-pointer focus-visible:(outline outline-2 outline-violet outline-offset-2)"
      @click="go"
    >
      去对话里说
    </button>
  </p>
</template>
