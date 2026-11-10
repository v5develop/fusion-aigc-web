<script setup lang="ts">
/**
 * 姿态复刻 · 识别人物与配对（付费前确认）。
 *
 * <p>多人照片先识别：原图人物按画面左→右标 A/B/C/D，每张姿势图下展示「人物A ← 图2画面左侧」；
 * 2 对 2 给「反转配对」；原图 ≥3 人或与参考图人数不同给逐人下拉（含「保持原姿势」）与「恢复默认」。单人照片可跳过本步，提交行为不变。
 * 原图单人时列出每张姿势图的人数（多人参考图只取其中 1 位）；原图多人但服务端没开放配对时说明按默认左→左、右→右。
 * 取消识别 / 撞上 4002 后有冷却，按钮上显示剩余秒数。
 * 状态与校验在 usePosePairing，这里只负责展示。
 */
import { computed } from 'vue'
import PickDropdown, { type PickOption } from '../components/PickDropdown.vue'
import { PEOPLE_LETTERS, poseWho, validateMapping, type PairPose, type PairState } from './usePosePairing.ts'

const {
  state,
  stale,
  running,
  elapsed,
  errorText,
  canRun,
  cooldown = 0,
  disabled,
} = defineProps<{
  state: PairState | null
  stale: boolean
  running: boolean
  elapsed: number
  errorText: string
  canRun: boolean
  /** 重新识别冷却剩余秒数 */
  cooldown?: number
  disabled?: boolean
}>()

const emit = defineEmits<{
  run: []
  cancel: []
  reverse: [poseIndex: number]
  reset: [poseIndex: number]
  set: [poseIndex: number, mapping: number[]]
}>()

const letter = (i: number) => PEOPLE_LETTERS[i] ?? String(i + 1)

function line(p: PairPose, i: number) {
  const v = p.mapping[i]
  return v == null || v < 0 ? `人物${letter(i)}：保持原姿势` : `人物${letter(i)} ← ${poseWho(p, v)}`
}

function mismatch(p: PairPose, n: number) {
  if (p.poseCount === n) return ''
  return p.poseCount > n
    ? `参考图 ${p.poseCount} 人 / 原图 ${n} 人：只取前 ${n} 位，不新增人物`
    : `参考图 ${p.poseCount} 人 / 原图 ${n} 人：没配上的人保持原姿势`
}

function problem(p: PairPose, n: number) {
  return validateMapping(p.mapping, n, p.poseCount)
}

function pick(p: PairPose, i: number, value: number) {
  const next = [...p.mapping]
  next[i] = value
  emit('set', p.poseIndex, next)
}

function optionsOf(p: PairPose, i: number): PickOption<number>[] {
  return [
    { value: -1, label: '保持原姿势（该人物不换姿势）' },
    ...Array.from({ length: p.poseCount }, (_, k) => ({
      value: k,
      label: `${poseWho(p, k)}${taken(p, i, k) ? '（已被占用）' : ''}`,
      disabled: taken(p, i, k),
    })),
  ]
}

/** 逐人下拉：2 对 2 只给「反转配对」，其余（姿势图 ≥2 人且人数不同，或原图 ≥3 人）都给下拉 */
function needSelects(p: PairPose, n: number) {
  if (p.poseCount === 2 && n === 2) return false
  return n >= 3 || (p.poseCount >= 2 && p.poseCount !== n)
}

/** 该选项已被本图其他人物占用（-1 永远可选） */
function taken(p: PairPose, i: number, k: number) {
  return p.mapping.some((v, j) => j !== i && v === k)
}

const single = computed(() => !!state && state.sourceCount < 2)
/** 原图多人但服务端没开放配对：按默认左→左、右→右 */
const fixedDefault = computed(() => !!state && state.sourceCount >= 2 && !state.mappingEnabled)
</script>

<template>
  <section class="flex flex-[0_0_auto] flex-col gap-8px" aria-label="识别人物与配对">
    <header class="flex flex-wrap items-center gap-8px">
      <span class="text-12px font-600 leading-18px text-ink-2">识别人物与配对</span>
      <span class="flex-1" />
      <button
        v-if="!running"
        type="button"
        class="sx-btn-tint"
        :disabled="!canRun || disabled"
        :title="cooldown > 0 ? '上一次识别还在服务端进行，稍等几秒再试' : '多人照片建议先识别配对；单人照片可直接提交'"
        @click="emit('run')"
      >
        {{ state && !stale ? '重新识别' : '识别人物与配对'
        }}<template v-if="cooldown > 0">（{{ cooldown }} 秒）</template>
      </button>
      <button v-else type="button" class="sx-btn" @click="emit('cancel')">取消识别</button>
    </header>

    <p v-if="running" class="m-0 text-11px leading-17px text-ink-2" role="status">
      正在识别人物，约 20 秒–2 分钟（已等待 {{ elapsed }} 秒）。免费，不扣点数；取消只是放弃结果。
    </p>
    <p v-else-if="errorText" class="m-0 text-11px leading-17px text-danger" role="alert">{{ errorText }}</p>
    <p v-else-if="stale" class="m-0 text-11px leading-17px text-warning" role="status">
      人物图或姿势图有变动，之前的识别结果已失效，需要的话请重新识别。
    </p>

    <template v-if="state && !stale">
      <template v-if="single || fixedDefault">
        <p class="m-0 text-11px leading-17px text-ink-2">
          <template v-if="single">原图只识别到 1 位人物，无需配对，直接提交即可。</template>
          <template v-else>已识别 {{ state.sourceCount }} 位人物，将按默认左→左、右→右配对。</template>
        </p>
        <ul v-if="state.poses.length" class="m-0 p-0 list-none flex flex-col gap-4px">
          <li
            v-for="p in state.poses"
            :key="p.poseIndex"
            class="flex flex-wrap items-baseline gap-x-8px text-11px leading-17px text-ink-2"
          >
            <span class="font-600 text-ink">姿势图{{ p.poseIndex + 1 }}</span>
            <span v-if="p.error" class="text-danger">{{ p.error }}</span>
            <template v-else>
              <span class="text-placeholder">{{ p.poseCount }} 人</span>
              <span v-if="single && p.poseCount >= 2" class="text-11px leading-16px text-warning"
                >参考图 {{ p.poseCount }} 人：只取其中 1 位，其余人不会出现在画面里</span
              >
            </template>
          </li>
        </ul>
      </template>
      <template v-else>
        <div class="flex flex-col gap-6px p-10px rounded-6px border border-solid border-line-soft bg-surface2">
          <div class="text-12px font-600 leading-18px text-ink">
            已锁定 {{ state.sourceCount }} 位人物<template v-if="state.group"> · {{ state.group }}</template>
          </div>
          <div v-if="state.restored" class="text-11px leading-16px text-placeholder">
            已带入上次提交的配对；重新识别可查看每位人物的详情。
          </div>
          <ul v-else class="m-0 p-0 list-none flex flex-col gap-4px">
            <li
              v-for="(person, i) in state.sourcePeople"
              :key="i"
              class="flex flex-wrap items-baseline gap-6px text-11px leading-17px text-ink-2"
            >
              <span class="sx-chip bg-violet-soft text-violet-ink font-600">人物{{ letter(i) }}</span>
              <span>{{ person.position }}</span>
              <span v-if="person.genderAge">{{ person.genderAge }}</span>
              <span v-if="person.summary" class="text-placeholder">{{ person.summary }}</span>
            </li>
          </ul>
          <p v-if="state.sourceTruncated" class="m-0 text-11px leading-16px text-warning">
            原图超过 4 人，只分析了画面最左边的 4 位。
          </p>
        </div>

        <div
          v-for="p in state.poses"
          :key="p.poseIndex"
          class="flex flex-col gap-4px p-10px rounded-6px border border-solid border-line-soft bg-surface2"
          :aria-label="`姿势图${p.poseIndex + 1}的人物配对`"
        >
          <div class="flex flex-wrap items-center gap-8px">
            <span class="text-12px font-600 leading-18px text-ink">姿势图{{ p.poseIndex + 1 }}</span>
            <span v-if="!p.error && p.poseCount" class="text-11px leading-16px text-placeholder"
              >{{ p.poseCount }} 人</span
            >
            <span class="flex-1" />
            <template v-if="!p.error && !disabled">
              <button
                v-if="p.poseCount === state.sourceCount && state.sourceCount === 2"
                type="button"
                class="sx-btn-ghost"
                @click="emit('reverse', p.poseIndex)"
              >
                反转配对
              </button>
              <button
                v-if="needSelects(p, state.sourceCount) && p.mapping.join() !== p.defaultMapping.join()"
                type="button"
                class="sx-btn-ghost"
                @click="emit('reset', p.poseIndex)"
              >
                恢复默认
              </button>
            </template>
          </div>

          <p v-if="p.error" class="m-0 text-11px leading-17px text-danger">
            姿势图{{ p.poseIndex + 1 }}：{{ p.error }}（提交时这张按默认配对：左→左、右→右）
          </p>
          <template v-else>
            <p class="m-0 text-11px leading-18px text-ink-2">
              配对：{{ p.mapping.map((_, i) => line(p, i)).join('；') }}
            </p>
            <div v-if="needSelects(p, state.sourceCount)" class="flex flex-col gap-4px">
              <PickDropdown
                v-for="(_, i) in p.mapping"
                :key="i"
                :label="`人物${letter(i)}`"
                :model-value="p.mapping[i] ?? -1"
                :options="optionsOf(p, i)"
                :disabled="disabled"
                @update:model-value="pick(p, i, $event)"
              />
            </div>
            <p v-if="mismatch(p, state.sourceCount)" class="m-0 text-11px leading-16px text-warning">
              {{ mismatch(p, state.sourceCount) }}
            </p>
            <p v-if="p.truncated" class="m-0 text-11px leading-16px text-warning">
              这张参考图超过 4 人，只分析了前 4 位。
            </p>
            <p v-if="problem(p, state.sourceCount)" class="m-0 text-11px leading-16px text-danger" role="alert">
              {{ problem(p, state.sourceCount) }}
            </p>
          </template>
        </div>
      </template>
    </template>
  </section>
</template>
