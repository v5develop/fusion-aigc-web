<script setup lang="ts">
/**
 * 十一维里的一项：现状描述 + 保持 / 替换 / 描述；改的时候按需出现主体、造型、换法（逐段指定）、挂参考图（@n）与说明。
 * 画面里没有这一项（present=false）时整卡置灰、不能改（Java 受理面同样拒）。
 */
import { computed } from 'vue'
import type { VideoCloneDimKey, VideoCloneDimMode } from '@/api/video-clone'
import { VC_DIM_CN, VC_NOTE_MAX, VC_SUBJECT_DIMS, fmtSpan } from '../video-clone/constants'
import type { VideoCloneState } from '../video-clone/useVideoClone'

const props = defineProps<{
  state: VideoCloneState
  dimKey: VideoCloneDimKey
  /** 当前参考图（顺序即 @n） */
  refs: string[]
  disabled?: boolean
}>()

const MODES: { key: VideoCloneDimMode; label: string }[] = [
  { key: 'keep', label: '保持' },
  { key: 'replace', label: '替换' },
  { key: 'describe', label: '描述' },
]

const name = computed(() => VC_DIM_CN[props.dimKey])
const dim = computed(() => props.state.dims[props.dimKey])
const present = computed(() => !!dim.value?.present)
const edit = computed(() => props.state.edits[props.dimKey])
const occurrences = computed(() => props.state.occurrencesOf(props.dimKey))
const showSubjects = computed(
  () => edit.value.mode !== 'keep' && props.state.subjects.length > 1 && VC_SUBJECT_DIMS.includes(props.dimKey),
)
const showOutfit = computed(() => props.dimKey === 'model' && edit.value.mode === 'replace')
const showPerSegment = computed(() => edit.value.mode === 'replace' && occurrences.value.length > 1)
const perSegment = computed(() => props.state.perSegmentActive(props.dimKey))
const highRisk = computed(() => present.value && dim.value?.risk === 'high')
const idBase = computed(() => `vc-dim-${props.dimKey}`)

/** 渲染时只读，不在这里补段（补段在切到逐段时做） */
const segRefs = (i: number) => edit.value.segs[i]?.refs ?? []
const subjectName = (id?: string) => (id ? props.state.subjects.find((s) => s.id === id)?.name : undefined)

function onNote(e: Event) {
  edit.value.note = (e.target as HTMLInputElement).value.slice(0, VC_NOTE_MAX)
}
function onSegNote(i: number, e: Event) {
  props.state.segOf(props.dimKey, i).note = (e.target as HTMLInputElement).value.slice(0, VC_NOTE_MAX)
}

const segBtn =
  'h-32px box-border px-10px rounded-6px border border-solid text-12px whitespace-nowrap cursor-pointer sx-focus ' +
  '[transition:border-color_.15s,background_.15s,color_.15s] motion-reduce:transition-none disabled:(opacity-45 cursor-not-allowed)'
const segOn =
  'border-violet-line bg-[linear-gradient(180deg,#fff_0%,#f8f3fc_100%)] text-violet-ink font-600 shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
const segOff = 'border-transparent bg-transparent text-muted hover:enabled:text-ink'
const chipBtn =
  'h-32px box-border px-12px rounded-full border border-solid text-12px whitespace-nowrap cursor-pointer sx-focus ' +
  'disabled:(opacity-45 cursor-not-allowed)'
const chipOn = 'border-violet-line bg-violet-soft text-violet-ink font-500'
const chipOff = 'border-line bg-white text-ink-2 hover:enabled:border-control-hover'
const inputCls =
  'w-full h-34px box-border rounded-12px border border-solid border-#c9cfd6 bg-white pl-10px pr-56px text-12px text-ink ' +
  'shadow-[inset_0_1px_2px_rgba(31,35,41,0.055)] outline-none placeholder:text-placeholder hover:border-#aeb6bf ' +
  'focus:(border-violet shadow-[0_0_0_3px_rgba(135,95,154,0.14)]) disabled:(bg-surface3 text-placeholder cursor-not-allowed)'
</script>

<template>
  <article
    class="flex flex-col gap-6px py-10px border-b border-b-solid border-line-soft last:border-b-0"
    :aria-labelledby="`${idBase}-name`"
  >
    <header class="flex items-center gap-6px min-h-36px">
      <h3
        :id="`${idBase}-name`"
        class="m-0 text-13px font-600 leading-18px"
        :class="present ? 'text-ink' : 'text-placeholder'"
      >
        {{ name }}
      </h3>
      <span
        v-if="highRisk"
        class="px-5px rounded-4px bg-warning-soft text-11px leading-16px text-warning"
        title="这一项改动幅度大，出片更容易跑偏"
        >改动风险高</span
      >
      <div
        class="ml-auto inline-flex gap-2px p-2px box-border rounded-8px border border-solid border-line bg-surface3 shadow-[inset_0_1px_2px_rgba(31,35,41,0.055)]"
        role="group"
        :aria-label="`${name}的处理方式`"
        :title="present ? undefined : '画面里没有这一项，不能修改'"
      >
        <button
          v-for="m in MODES"
          :key="m.key"
          type="button"
          :class="[segBtn, edit.mode === m.key ? segOn : segOff]"
          :aria-pressed="edit.mode === m.key"
          :disabled="!present || disabled"
          @click="state.setMode(dimKey, m.key)"
        >
          {{ m.label }}
        </button>
      </div>
    </header>
    <p class="m-0 text-12px leading-18px" :class="present ? 'text-muted' : 'text-placeholder'">
      {{ present ? dim?.desc || '—' : '画面里没有这一项' }}
    </p>

    <div v-if="present && edit.mode !== 'keep'" class="flex flex-col gap-8px mt-2px p-8px rounded-10px bg-surface2">
      <!-- 主体：多人出镜时可以只改其中几个人；空 = 所有人 -->
      <div v-if="showSubjects" class="flex items-start gap-8px">
        <span :id="`${idBase}-subj`" class="flex-none w-28px pt-8px text-11px leading-16px text-placeholder">主体</span>
        <div class="flex flex-wrap gap-6px" role="group" :aria-labelledby="`${idBase}-subj`">
          <button
            type="button"
            :class="[chipBtn, !edit.subjects.length ? chipOn : chipOff]"
            :aria-pressed="!edit.subjects.length"
            :disabled="disabled"
            @click="state.toggleSubject(dimKey, null)"
          >
            所有人
          </button>
          <button
            v-for="s in state.subjects"
            :key="s.id"
            type="button"
            :class="[chipBtn, edit.subjects.includes(s.id) ? chipOn : chipOff]"
            :aria-pressed="edit.subjects.includes(s.id)"
            :title="s.desc || undefined"
            :disabled="disabled"
            @click="state.toggleSubject(dimKey, s.id)"
          >
            {{ s.name }}
          </button>
        </div>
      </div>

      <!-- 造型：换人时衣服沿用原片，还是跟参考图一起换 -->
      <div v-if="showOutfit" class="flex items-center gap-8px">
        <span :id="`${idBase}-outfit`" class="flex-none w-28px text-11px leading-16px text-placeholder">造型</span>
        <div class="flex flex-wrap gap-6px" role="group" :aria-labelledby="`${idBase}-outfit`">
          <button
            type="button"
            :class="[chipBtn, !edit.withOutfit ? chipOn : chipOff]"
            :aria-pressed="!edit.withOutfit"
            :disabled="disabled"
            @click="edit.withOutfit = false"
          >
            沿用原片
          </button>
          <button
            type="button"
            :class="[chipBtn, edit.withOutfit ? chipOn : chipOff]"
            :aria-pressed="edit.withOutfit"
            :disabled="disabled"
            @click="edit.withOutfit = true"
          >
            用参考图
          </button>
        </div>
      </div>

      <!-- 换法：这一项在片子里出现了多段（如六套衣服） -->
      <div v-if="showPerSegment" class="flex items-center gap-8px">
        <span :id="`${idBase}-per`" class="flex-none w-28px text-11px leading-16px text-placeholder">换法</span>
        <div class="flex flex-wrap gap-6px" role="group" :aria-labelledby="`${idBase}-per`">
          <button
            type="button"
            :class="[chipBtn, !edit.perSegment ? chipOn : chipOff]"
            :aria-pressed="!edit.perSegment"
            :disabled="disabled"
            @click="state.setPerSegment(dimKey, false)"
          >
            全部换同一套
          </button>
          <button
            type="button"
            :class="[chipBtn, edit.perSegment ? chipOn : chipOff]"
            :aria-pressed="edit.perSegment"
            :disabled="disabled"
            @click="state.setPerSegment(dimKey, true)"
          >
            逐段指定（{{ occurrences.length }} 段）
          </button>
        </div>
      </div>

      <template v-if="edit.mode === 'replace'">
        <!-- 逐段：每段各自挂参考图、写说明 -->
        <ol v-if="perSegment" class="m-0 p-0 list-none flex flex-col gap-6px">
          <li
            v-for="(o, i) in occurrences"
            :key="o.t0"
            class="flex flex-col gap-6px p-8px box-border rounded-8px border border-solid border-line bg-white"
          >
            <div class="flex items-baseline gap-6px min-w-0">
              <code class="flex-none text-11px leading-16px text-violet-ink tabular-nums">{{
                fmtSpan(o.t0, o.t1)
              }}</code>
              <span class="min-w-0 truncate text-12px leading-18px text-muted" :title="o.desc">
                <template v-if="subjectName(o.subject)">{{ subjectName(o.subject) }} · </template>{{ o.desc || '—' }}
              </span>
            </div>
            <div
              class="flex flex-wrap items-center gap-6px"
              role="group"
              :aria-label="`${fmtSpan(o.t0, o.t1)} 挂参考图`"
            >
              <button
                v-for="(url, n) in refs"
                :key="url"
                type="button"
                class="relative w-40px h-40px p-0 overflow-hidden box-border rounded-6px border border-solid cursor-pointer sx-focus disabled:cursor-not-allowed"
                :class="segRefs(i).includes(url) ? 'border-violet shadow-[0_0_0_1px_#875f9a]' : 'border-line'"
                :aria-pressed="segRefs(i).includes(url)"
                :aria-label="`参考图 @${n + 1}`"
                :disabled="disabled"
                @click="state.toggleRef(state.segOf(dimKey, i).refs, url)"
              >
                <img :src="url" alt="" class="block w-full h-full object-cover" draggable="false" />
                <em
                  class="absolute left-1px bottom-1px px-2px rounded-2px bg-[rgba(15,17,20,0.6)] text-10px not-italic leading-13px text-white"
                  >@{{ n + 1 }}</em
                >
              </button>
              <span v-if="!refs.length" class="text-11px leading-16px text-placeholder"
                >先在上方「参考图」里上传，或只写说明</span
              >
            </div>
            <div class="relative">
              <input
                type="text"
                :class="inputCls"
                :value="edit.segs[i]?.note ?? ''"
                :maxlength="VC_NOTE_MAX"
                :disabled="disabled"
                placeholder="这一段的说明（可选）"
                :aria-label="`${name} ${fmtSpan(o.t0, o.t1)} 的说明`"
                @input="onSegNote(i, $event)"
              />
              <span
                class="pointer-events-none absolute right-10px top-1/2 -translate-y-1/2 text-11px text-placeholder tabular-nums"
              >
                {{ (edit.segs[i]?.note ?? '').length }}/{{ VC_NOTE_MAX }}
              </span>
            </div>
          </li>
        </ol>

        <!-- 整体：挂哪几张参考图 -->
        <div v-else class="flex flex-wrap items-center gap-6px" role="group" :aria-label="`${name}挂参考图`">
          <button
            v-for="(url, n) in refs"
            :key="url"
            type="button"
            class="relative w-40px h-40px p-0 overflow-hidden box-border rounded-6px border border-solid cursor-pointer sx-focus disabled:cursor-not-allowed"
            :class="edit.refs.includes(url) ? 'border-violet shadow-[0_0_0_1px_#875f9a]' : 'border-line'"
            :aria-pressed="edit.refs.includes(url)"
            :aria-label="`参考图 @${n + 1}`"
            :disabled="disabled"
            @click="state.toggleRef(edit.refs, url)"
          >
            <img :src="url" alt="" class="block w-full h-full object-cover" draggable="false" />
            <em
              class="absolute left-1px bottom-1px px-2px rounded-2px bg-[rgba(15,17,20,0.6)] text-10px not-italic leading-13px text-white"
              >@{{ n + 1 }}</em
            >
          </button>
          <span v-if="!refs.length" class="text-11px leading-16px text-placeholder"
            >先在上方「参考图」里上传一张，或直接在下面写说明</span
          >
        </div>
      </template>

      <div class="relative">
        <input
          type="text"
          :class="inputCls"
          :value="edit.note"
          :maxlength="VC_NOTE_MAX"
          :disabled="disabled"
          :placeholder="
            edit.mode === 'describe' ? '改成什么样：一句话写清（必填）' : '补充说明（可选）：只换外套、下摆到脚踝…'
          "
          :aria-label="`${name}${edit.mode === 'describe' ? '改成什么样' : '补充说明'}`"
          :aria-required="edit.mode === 'describe' || undefined"
          @input="onNote"
        />
        <span
          class="pointer-events-none absolute right-10px top-1/2 -translate-y-1/2 text-11px text-placeholder tabular-nums"
        >
          {{ edit.note.length }}/{{ VC_NOTE_MAX }}
        </span>
      </div>
    </div>
  </article>
</template>
