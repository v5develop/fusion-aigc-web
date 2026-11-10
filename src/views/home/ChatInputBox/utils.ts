import type { PromptSlot, FileItem } from './types.ts'
import { DEFAULT_UPLOAD_LIMIT, ROUTE_TO_MODULE_CODE } from './types.ts'
import type { IPromptSlotDef } from '@/api/types'
import { sceneOps } from '@/views/e-commerce/child-pages/constants.ts'

/** 将 slots 数组拼接为纯文本 prompt */
export function slotsToPrompt(slots: PromptSlot[]): {
  plainText: string
  images: FileItem[]
} {
  const images: FileItem[] = []

  const plainText = slots
    .map((s) => {
      switch (s.type) {
        case 'upload':
          images.push(...s.value)
          return s.value.length > 0 ? s.label : ''
        case 'text':
          return s.value
        case 'select':
          // 未选择（如 options 为空的空态下拉）不输出，避免「选择场景图」这类占位 label 混入 prompt
          return s.value ? s.label : ''
      }
    })
    .join('')

  return { plainText, images }
}

// ============ 提示词模板详情 → 编辑器插槽 ============
//
// GET /api/v1/creation/prompts/{id} 返回：
//   content: 带 {{key}} 占位符的模板串，如「将{{apparelImage}} 穿在{{modelImage}} 身上，…」
//   slots:   插槽定义表（非有序内容块），按 key 被 content 占位符引用
// 解析统一收敛在本文件，后端契约调整只需改这里。

function defToSlot(def: IPromptSlotDef, moduleCode?: string): PromptSlot {
  if (def.slotType === 'select') {
    // 穿戴套图「拍摄场景」下拉：选项与子页面共用 sceneOps，不以后端 options 为数据源。
    // 识别规则与 buildTargetParams 的 scenePhoto 一致：该模板下 select 且非 aspectRatio 即场景插槽。
    const isScene = moduleCode === 'wearingProductSetImages' && def.key !== 'aspectRatio'
    if (isScene) {
      return {
        type: 'select',
        key: def.key,
        label: def.label, // 占位符（未选态显示「请选择拍摄场景」）
        value: '',
        options: sceneOps,
        title: def.label,
        ...(def.required ? { required: true } : {}),
      }
    }
    const options = def.options ?? []
    const first = options[0]
    return {
      type: 'select',
      key: def.key,
      label: first?.label ?? def.label,
      value: first?.value ?? '',
      options,
      title: def.label,
      ...(def.required ? { required: true } : {}),
    }
  }
  return {
    type: 'upload',
    key: def.key,
    label: def.label,
    value: [],
    limit: def.maxCount ?? DEFAULT_UPLOAD_LIMIT,
    ...(def.required ? { required: true } : {}),
    moduleCode,
  }
}

/** 将提示词模板详情接口返回的 data 解析为编辑器插槽 */
export function promptDetailToSlots(
  detail: { content?: string | null; slots?: IPromptSlotDef[] | null } | null | undefined,
  routeCode?: string,
): PromptSlot[] {
  const content = detail?.content
  if (!content) return []

  const moduleCode = routeCode ? ROUTE_TO_MODULE_CODE[routeCode] : undefined
  const defMap = new Map((detail?.slots ?? []).map((d) => [d.key, d]))

  const slots: PromptSlot[] = []
  const re = /\{\{\s*([^{}]+?)\s*\}\}/g
  let lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(content))) {
    if (m.index > lastIndex) slots.push({ type: 'text', value: content.slice(lastIndex, m.index) })
    const def = defMap.get(m[1]!)
    // 占位符无对应定义时保留为可编辑空文本，避免正文语义丢失
    const slot: PromptSlot = def ? defToSlot(def, moduleCode) : { type: 'text', value: '' }
    // 每个插槽（chip）前补一个空格，避免紧贴前文
    if (slot.type !== 'text') {
      const prev = slots[slots.length - 1]
      if (prev && prev.type === 'text') prev.value += ' '
      else slots.push({ type: 'text', value: ' ' })
    }
    slots.push(slot)
    lastIndex = re.lastIndex
  }
  if (lastIndex < content.length) slots.push({ type: 'text', value: content.slice(lastIndex) })
  return slots
}
