<script setup lang="ts">
/**
 * 对话卡片：可选音色（CONTRACT §P，replicate_list_voices）。点音色 = 发一条用户消息「用「xx」这个声音」，卡片自己不改任何业务状态。
 * 试听：sampleUrl 是签名地址，可能被事件清洗剔除；没有就不显示试听按钮。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import type { ReplicateVoices } from '@/api/replicate-card.ts'

const props = defineProps<{ view: ReplicateVoices; disabled?: boolean }>()
const emit = defineEmits<{ (e: 'send', text: string): void }>()

type Filter = 'all' | 'male' | 'female'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'male', label: '男声' },
  { key: 'female', label: '女声' },
]
const filter = ref<Filter>('all')

/** 性别归一：兼容 male/female、男/女（含「男声」「女声」） */
const genderOf = (g?: string): Filter | '' => {
  const v = (g ?? '').toLowerCase()
  if (v.startsWith('m') || v.includes('男')) return 'male'
  if (v.startsWith('f') || v.includes('女')) return 'female'
  return ''
}
const genderText = (g?: string) => ({ male: '男声', female: '女声' })[genderOf(g) as 'male' | 'female'] ?? ''

const voices = computed(() => props.view.voices ?? [])
const shown = computed(() => voices.value.filter((v) => filter.value === 'all' || genderOf(v.gender) === filter.value))

// 同一时间只放一条样音
const playing = ref('')
let audio: HTMLAudioElement | null = null
function stop() {
  audio?.pause()
  audio = null
  playing.value = ''
}
function toggle(id: string, url?: string) {
  if (!url) return
  if (playing.value === id) return stop()
  stop()
  const a = new Audio(url)
  audio = a
  playing.value = id
  a.addEventListener('ended', () => playing.value === id && stop())
  a.addEventListener('error', () => playing.value === id && stop())
  a.play().catch(() => playing.value === id && stop())
}
onBeforeUnmount(stop)
</script>

<template>
  <section class="sx-squircle w-full max-w-520px rounded-18px sx-soft px-16px py-14px" aria-label="可选音色">
    <h3 class="vr-h3">选一个声音</h3>
    <p class="vr-sub">点音色名就会告诉我用它配音；先点「试听」听听看</p>

    <div class="mb-10px flex flex-wrap gap-6px" role="group" aria-label="按性别筛选">
      <button
        v-for="f in FILTERS"
        :key="f.key"
        type="button"
        :aria-pressed="filter === f.key"
        :class="[
          'h-28px cursor-pointer rounded-full border border-solid px-12px text-12px transition-colors focus-visible:(outline outline-2 outline-violet outline-offset-2)',
          filter === f.key ? 'border-violet bg-violet-tint font-600 text-violet-ink' : 'border-line bg-transparent text-ink-2 hover:bg-surface2',
        ]"
        @click="filter = f.key"
      >
        {{ f.label }}
      </button>
    </div>

    <ul v-if="shown.length" class="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-8px p-0">
      <li
        v-for="v in shown"
        :key="v.voiceId"
        class="flex min-w-0 flex-col gap-6px rounded-12px border border-solid border-line bg-surface2 px-10px py-8px"
      >
        <button
          type="button"
          class="min-w-0 cursor-pointer border-none bg-transparent p-0 text-left text-13px font-600 leading-20px text-ink enabled:hover:text-violet-ink disabled:cursor-not-allowed disabled:opacity-50 focus-visible:(outline outline-2 outline-violet outline-offset-2)"
          :disabled="disabled"
          :aria-label="`用「${v.name}」这个声音`"
          @click="emit('send', `用「${v.name}」这个声音`)"
        >
          <span class="block truncate">{{ v.name }}</span>
        </button>
        <div class="flex flex-wrap items-center gap-4px">
          <span v-if="genderText(v.gender)" class="rounded-9px bg-surface3 px-6px py-1px text-11px text-muted">{{ genderText(v.gender) }}</span>
          <span v-if="v.style" class="rounded-9px bg-violet-tint px-6px py-1px text-11px text-ink-2">{{ v.style }}</span>
        </div>
        <button
          v-if="v.sampleUrl"
          type="button"
          class="sx-btn !h-26px !px-10px !text-12px self-start"
          :aria-label="`${playing === v.voiceId ? '停止' : '试听'}${v.name}`"
          @click="toggle(v.voiceId, v.sampleUrl)"
        >
          {{ playing === v.voiceId ? '■ 停止' : '▶ 试听' }}
        </button>
      </li>
    </ul>
    <p v-else class="m-0 text-12px leading-18px text-muted" role="status">这个分类下暂时没有音色</p>
  </section>
</template>
