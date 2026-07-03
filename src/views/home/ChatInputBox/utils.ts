import type { PromptSlot, FileItem } from './types'

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
          return s.label
      }
    })
    .join('')

  return { plainText, images }
}
