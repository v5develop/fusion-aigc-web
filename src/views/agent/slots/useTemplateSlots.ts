/** 选中模板后取它的 slots（详情接口），并管理表单值与校验。 */
import { computed, ref, watch } from 'vue'
import { plazaTemplateById, type IPlazaTemplate } from '@/api/plaza.ts'
import {
  buildInputs,
  defaultValues,
  missingText,
  parseSlots,
  validateSlots,
  type ISlot,
  type SlotValues,
} from './slotTypes.ts'

export function useTemplateSlots() {
  const status = ref<'none' | 'loading' | 'ok' | 'unsupported'>('none')
  const items = ref<ISlot[]>([])
  const values = ref<SlotValues>({})
  /** 模板是否做「文字叠加」（详情 / 列表的 textOverlay） */
  const textOverlay = ref(false)
  /** prepare 返回的就地错误（key → 文案）：该字段一改动就清掉 */
  const serverErrors = ref<Record<string, string>>({})
  let seq = 0

  watch(
    () => ({ ...values.value }),
    (now, old) => {
      const cur = serverErrors.value
      if (!Object.keys(cur).length) return
      const next = { ...cur }
      for (const k of Object.keys(cur)) if (JSON.stringify(now[k]) !== JSON.stringify(old?.[k])) delete next[k]
      serverErrors.value = next
    },
  )

  function apply(raw: unknown) {
    const p = parseSlots(raw)
    if (p.status === 'ok') {
      items.value = p.items
      values.value = defaultValues(p.items)
      status.value = 'ok'
    } else {
      items.value = []
      values.value = {}
      status.value = p.status
    }
  }

  /** 列表项不带 slots：先看有没有，没有再按 id 取详情；取失败按旧模板（单图位）处理 */
  async function load(t: IPlazaTemplate | null) {
    const s = ++seq
    if (!t) return reset()
    textOverlay.value = t.textOverlay === true
    if (t.slots !== undefined) return apply(t.slots)
    status.value = 'loading'
    items.value = []
    try {
      const res = await plazaTemplateById(t.plazaTemplateId)
      if (s === seq) {
        textOverlay.value = res.data?.textOverlay === true
        apply(res.data?.slots)
      }
    } catch {
      if (s === seq) apply(undefined)
    }
  }

  function reset() {
    seq++
    status.value = 'none'
    textOverlay.value = false
    items.value = []
    values.value = {}
    serverErrors.value = {}
  }

  const errors = computed(() => (status.value === 'ok' ? validateSlots(items.value, values.value) : {}))
  /** 阻止发送的原因（空串 = 可发） */
  const blocker = computed(() => {
    if (status.value === 'unsupported') return '这个模板需要新版本才能使用'
    if (status.value === 'loading') return '正在准备这个模板'
    if (status.value !== 'ok') return ''
    const m = missingText(items.value, errors.value)
    return m ? `还差：${m}` : ''
  })
  const inputs = () => (status.value === 'ok' ? buildInputs(items.value, values.value) : undefined)

  return { status, textOverlay, items, values, errors, serverErrors, blocker, inputs, load, reset }
}
