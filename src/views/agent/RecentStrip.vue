<script setup lang="ts">
/**
 * 「接着做」条（V-06，所有 Tab 顶部）：登录后才取，严格只含当前行业（含二级整体），最多 5 个小卡；没有历史 / 未登录 / 失败都不渲染、不占位。
 * 点小卡 = 放进输入框（与点「做同款」同一条 pick 路径，再来一版）。
 */
import { ref, watch } from 'vue'
import { plazaRecent, type IPlazaRecent, type IPlazaTemplate } from '@/api/plaza.ts'
import { loginVersion } from './industry/useLoginGate.ts'
import { coverOf } from './templateMedia.ts'

const props = defineProps<{ industry: string; sub?: string; disabled?: boolean; pickedId?: number | null }>()
const emit = defineEmits<{ pick: [item: IPlazaTemplate] }>()

const MAX = 5
const items = ref<IPlazaRecent[]>([])
let seq = 0

function loggedIn(): boolean {
  try {
    return !!localStorage.getItem('fusion_accessToken')
  } catch {
    return false
  }
}

watch(
  () => [props.industry, loggedIn(), loginVersion.value] as const,
  async ([ind, logged]) => {
    const my = ++seq
    items.value = []
    if (!ind || !logged) return
    try {
      // 选了二级仍显示整个行业的内容（V-06），所以只传一级
      const res = await plazaRecent({ industry: ind, limit: MAX })
      if (my === seq) items.value = (res.data?.items ?? []).slice(0, MAX)
    } catch {
      // 失败当没有历史：不打扰、不占位
    }
  },
  { immediate: true },
)

const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'
</script>

<template>
  <section v-if="items.length" aria-label="接着做" class="mb-14px flex flex-col gap-6px" data-testid="plaza-recent">
    <h4 class="m-0 text-12px font-600 leading-18px text-muted">接着做</h4>
    <ul class="m-0 flex list-none gap-8px overflow-x-auto p-0 pb-2px">
      <li v-for="t in items" :key="t.plazaTemplateId" class="flex-none">
        <button
          type="button"
          :disabled="disabled"
          :aria-pressed="pickedId === t.plazaTemplateId"
          :title="`再来一版：${t.title}`"
          class="group flex h-64px w-188px items-center gap-8px rounded-12px border border-solid border-soft-line bg-surface p-4px pr-10px text-left cursor-pointer hover:(border-violet-line bg-violet-tint) disabled:(cursor-not-allowed opacity-60)"
          :class="[FOCUS, pickedId === t.plazaTemplateId ? 'border-violet-line bg-violet-tint' : '']"
          @click="emit('pick', t)"
        >
          <img v-if="coverOf(t)" :src="coverOf(t)" alt="" class="h-56px w-56px flex-none rounded-8px bg-surface3 object-cover" aria-hidden="true" />
          <span v-else class="h-56px w-56px flex-none rounded-8px bg-surface3" aria-hidden="true" />
          <span class="flex min-w-0 flex-1 flex-col gap-2px">
            <span class="line-clamp-1 text-12px font-600 leading-18px text-ink">{{ t.title }}</span>
            <span class="text-11px leading-16px text-violet-ink">再来一版</span>
          </span>
        </button>
      </li>
    </ul>
  </section>
</template>
