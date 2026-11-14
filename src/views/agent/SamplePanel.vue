<script setup lang="ts">
/**
 * 示例效果（EXPERIENCE 13.2 / M-24）：模板自带的预计算示例，不生成、不扣点数、不限次。
 * 数据来自 /plaza/samples，按 role 配对：第 i 个 INPUT（放进去的）→ 第 i 个 OUTPUT（做出来的）；
 * 没有对应原图的成品单独展示，没有成品的原图不展示（不编造）。成品带「AI 生成」角标。
 */
import { computed, ref } from 'vue'
import type { IPlazaSample } from '@/api/plaza.ts'

const props = defineProps<{ samples: IPlazaSample[]; compact?: boolean; actionLabel?: string }>()
const emit = defineEmits<{ action: [] }>()

const failed = ref<Set<number>>(new Set())
const isVideo = (s: IPlazaSample) => s.kind === 'video' || /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(s.url)
const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'

const rows = computed(() => {
  const ins = props.samples.filter((s) => s.role === 'INPUT')
  const outs = props.samples.filter((s) => s.role !== 'INPUT')
  return outs.map((o, i) => ({ input: ins[i] ?? null, output: o }))
})
</script>

<template>
  <section v-if="rows.length" aria-label="示例效果" class="flex flex-col gap-8px" data-testid="plaza-samples">
    <h4 class="m-0 text-13px font-600 leading-20px text-ink">示例效果</h4>
    <ul class="m-0 grid list-none gap-10px p-0" :class="rows.some((r) => r.input) ? 'grid-cols-2 max-sm:grid-cols-1' : 'grid-cols-3 max-sm:grid-cols-2'">
      <li v-for="r in rows" :key="r.output.id" class="flex items-center gap-6px">
        <template v-if="r.input">
          <div class="relative min-w-0 flex-1 overflow-hidden rounded-10px bg-surface3">
            <img :src="r.input.thumbUrl || r.input.url" :alt="r.input.title || '放进去的'" loading="lazy" class="block aspect-3/4 w-full object-cover" />
            <span class="pointer-events-none absolute bottom-6px left-6px rounded-4px bg-surface/90 px-6px text-10px leading-16px text-ink-2">放进去的</span>
          </div>
          <svg class="h-14px w-14px flex-none text-placeholder" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </template>
        <div class="relative min-w-0 flex-1 overflow-hidden rounded-10px bg-surface3">
          <video v-if="isVideo(r.output)" :src="r.output.url" :poster="r.output.thumbUrl && r.output.thumbUrl !== r.output.url ? r.output.thumbUrl : undefined" muted loop playsinline controls preload="none" class="block aspect-3/4 w-full bg-black object-cover" />
          <img v-else-if="!failed.has(r.output.id)" :src="r.output.thumbUrl || r.output.url" :alt="r.output.title || '做出来的'" loading="lazy" class="block aspect-3/4 w-full object-cover" @error="failed = new Set(failed).add(r.output.id)" />
          <span v-else class="grid aspect-3/4 w-full place-items-center text-11px text-muted">图片没加载出来</span>
          <span class="pointer-events-none absolute left-6px top-6px rounded-4px bg-[rgba(31,35,41,0.62)] px-6px text-10px leading-16px text-white">AI 生成</span>
          <span v-if="r.input" class="pointer-events-none absolute bottom-6px left-6px rounded-4px bg-surface/90 px-6px text-10px leading-16px text-ink-2">做出来的</span>
        </div>
      </li>
    </ul>
    <p class="m-0 text-12px leading-18px text-muted">这是示例效果，换成你的照片再做同款</p>
    <button v-if="actionLabel" type="button" class="sx-btn !h-32px !text-13px self-start" :class="FOCUS" @click="emit('action')">{{ actionLabel }}</button>
  </section>
</template>
