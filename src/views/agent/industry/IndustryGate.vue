<script setup lang="ts">
/**
 * 行业门（agent-template-industry EXPERIENCE §3.1）。两种形态共用本组件：
 * - 首次门（dismissible=false）：内联区域，无 ×、Esc 无效，不设 aria-modal、不做焦点陷阱（门只盖模板区，输入框仍可用）；
 * - 重开门（dismissible=true）：由外层 n-modal 承载，右上 ×、Esc 关闭，当前行业带「当前」角标。
 * 行业按钮 role=radio + roving tabindex，方向键只移动焦点、空格 / 回车选择、数字键 1–9 直选；
 * 门里没有「全部」入口，找不到行业的人走底部「没有我的行业？告诉我们」。
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import type { IIndustry } from '@/api/plaza.ts'
import { plazaIndustrySuggest } from '@/api/plaza.ts'
import PageEmpty from '@/components/PageEmpty/index.vue'
import PageLoadError from '@/components/PageLoadError/index.vue'

const props = defineProps<{
  industries: IIndustry[]
  /** 当前行业 code，重开门时高亮 */
  current?: string
  dismissible?: boolean
  loading?: boolean
  error?: boolean
  /** gateEnabled=false 或 0 个行业 */
  empty?: boolean
}>()
const emit = defineEmits<{ select: [code: string]; close: []; retry: [] }>()

const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'
const titleId = `industry-gate-title-${Math.random().toString(36).slice(2, 8)}`

const focusIdx = ref(0)
const btns = ref<HTMLButtonElement[]>([])
const polite = ref('')

onMounted(() => {
  const i = props.industries.findIndex((x) => x.code === props.current)
  focusIdx.value = i >= 0 ? i : 0
  // 重开门：焦点落在当前项；首次门不抢焦点（输入框可能已聚焦）
  if (props.dismissible) void nextTick(() => btns.value[focusIdx.value]?.focus())
})

function setBtn(el: unknown, i: number) {
  if (el) btns.value[i] = el as HTMLButtonElement
}

function choose(ind: IIndustry) {
  polite.value = `已选择${ind.name}，正在加载头条`
  emit('select', ind.code)
}

function move(to: number) {
  const n = props.industries.length
  if (!n) return
  focusIdx.value = (to + n) % n
  btns.value[focusIdx.value]?.focus()
}

function onKey(e: KeyboardEvent, i: number) {
  const k = e.key
  const go = (to: number) => {
    e.preventDefault()
    move(to)
  }
  if (k === 'ArrowRight' || k === 'ArrowDown') go(i + 1)
  else if (k === 'ArrowLeft' || k === 'ArrowUp') go(i - 1)
  else if (k === 'Home') go(0)
  else if (k === 'End') go(props.industries.length - 1)
  else if (/^[1-9]$/.test(k)) {
    const t = props.industries[Number(k) - 1]
    if (t) {
      e.preventDefault()
      choose(t)
    }
  }
}

// ---- 没有我的行业？告诉我们 ----
const sugOpen = ref(false)
const sugText = ref('')
const sugDone = ref(false)
const sugInput = ref<HTMLInputElement | null>(null)
const sugLink = ref<HTMLButtonElement | null>(null)

async function openSug() {
  sugOpen.value = true
  await nextTick()
  sugInput.value?.focus()
}
function closeSug() {
  sugOpen.value = false
  void nextTick(() => sugLink.value?.focus())
}
async function submitSug() {
  if (sugDone.value) return
  // 失败 / 离线一律视作成功（不让想反馈的人再受一次挫）
  void plazaIndustrySuggest(sugText.value).catch(() => undefined)
  sugDone.value = true
  setTimeout(() => {
    sugOpen.value = false
    sugDone.value = false
    sugText.value = ''
  }, 4000)
}

const hasHint = computed(() => props.industries.some((x) => x.hint))
</script>

<template>
  <div
    class="mx-auto flex w-full max-w-640px flex-col items-center px-16px py-24px text-center"
    :role="dismissible ? undefined : 'group'"
    :aria-labelledby="titleId"
  >
    <h3 :id="titleId" class="m-0 text-20px font-600 leading-28px text-ink">
      {{ dismissible ? '换个行业' : '选择你的行业' }}
    </h3>
    <p class="m-0 mt-6px text-12px leading-18px text-muted">
      {{ dismissible ? '换行业不会丢掉输入框里的内容' : '只给你看和你生意相关的模板，选错了也没关系，随时可以换' }}
    </p>

    <div v-if="loading" class="mt-24px grid w-full grid-cols-3 gap-10px max-sm:grid-cols-2" aria-busy="true">
      <span class="sr-only">正在加载行业</span>
      <span
        v-for="n in 6"
        :key="n"
        class="h-52px animate-pulse rounded-12px bg-surface3 motion-reduce:animate-none"
        aria-hidden="true"
      />
    </div>
    <PageLoadError
      v-else-if="error"
      class="mt-16px"
      compact
      title="行业没加载出来"
      subtitle="检查一下网络，再试一次"
      retryable
      @retry="emit('retry')"
    />
    <PageEmpty
      v-else-if="empty"
      class="mt-8px"
      compact
      text="模板正在准备中"
      description="你的行业模板很快会上线，也可以告诉我们你做什么生意"
    />
    <div
      v-else
      role="radiogroup"
      aria-label="选择行业"
      class="mt-24px grid w-full grid-cols-3 gap-10px max-sm:grid-cols-2"
    >
      <button
        v-for="(ind, i) in industries"
        :key="ind.code"
        :ref="(el) => setBtn(el, i)"
        type="button"
        role="radio"
        :aria-checked="current === ind.code"
        :tabindex="focusIdx === i ? 0 : -1"
        :class="[
          'sx-squircle relative flex flex-col items-center justify-center gap-2px rounded-12px border border-solid px-10px text-ink cursor-pointer select-none',
          hasHint ? 'h-64px max-sm:h-68px' : 'h-52px max-sm:h-56px',
          '[transition:border-color_0.11s,box-shadow_0.11s,transform_0.08s] motion-reduce:transition-none active:scale-98',
          current === ind.code
            ? 'border-violet-line bg-violet-tint font-600 text-violet-ink'
            : 'border-soft-line sx-soft-bg shadow-soft hover:(border-control-hover shadow-soft-hover)',
          FOCUS,
        ]"
        @click="choose(ind)"
        @focus="focusIdx = i"
        @keydown="onKey($event, i)"
      >
        <b class="max-w-full truncate text-15px font-600 leading-22px">{{ ind.name }}</b>
        <span v-if="ind.hint" class="max-w-full truncate text-12px leading-16px text-muted">{{ ind.hint }}</span>
        <span
          v-if="current === ind.code"
          class="absolute right-6px top-6px inline-flex h-16px items-center rounded-8px bg-violet-solid px-6px text-10px font-600 text-white"
          >当前</span
        >
      </button>
    </div>
    <p
      v-if="!loading && !error && !empty && !dismissible"
      class="m-0 mt-14px hidden text-12px text-placeholder [@media(pointer:fine)]:block"
    >
      方向键切换 · 回车确认
    </p>

    <div v-if="!loading" class="mt-16px flex w-full flex-col items-center">
      <button
        v-if="!sugOpen"
        ref="sugLink"
        type="button"
        class="m-0 border-0 bg-transparent px-8px py-10px text-12px text-violet-ink cursor-pointer hover:underline max-sm:text-14px"
        :class="FOCUS"
        @click="openSug"
      >
        没有我的行业？告诉我们
      </button>
      <div v-else class="flex w-full max-w-420px flex-col items-center gap-8px" @keydown.esc.stop="closeSug">
        <p v-if="sugDone" class="m-0 py-8px text-13px text-ink-2" role="status">收到了，谢谢！有新行业会在这里出现</p>
        <template v-else>
          <label class="relative block w-full">
            <span class="sr-only">你做什么生意</span>
            <input
              ref="sugInput"
              v-model="sugText"
              maxlength="40"
              placeholder="你做什么生意？比如：美甲、宠物店、民宿"
              class="box-border h-36px w-full rounded-16px border border-solid border-control bg-surface px-14px text-12px text-ink outline-none placeholder:text-placeholder focus:(border-violet shadow-focus)"
              @keydown.enter.prevent="submitSug"
            />
            <span v-if="sugText.length >= 30" class="absolute right-10px top-10px text-10px text-placeholder"
              >{{ sugText.length }}/40</span
            >
          </label>
          <div class="flex gap-8px">
            <button type="button" class="sx-btn-primary" @click="submitSug">告诉我们</button>
            <button type="button" class="sx-btn" @click="closeSug">先逛逛现有行业</button>
          </div>
          <p class="m-0 text-11px text-placeholder">运营会看到你的建议，上新行业时优先考虑</p>
        </template>
      </div>
    </div>
    <span class="sr-only" aria-live="polite">{{ polite }}</span>
  </div>
</template>
