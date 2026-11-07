import { computed, ref, type Ref } from 'vue'

/**
 * 历史列选中项（三栏模式）：selectedId 为 null = 跟随最新一条（列表按创建时间倒序，第一条即最新）。
 * 选中的记录被删除 / 翻出已加载范围时自动回落到最新一条。
 * 提交成功后优先用 selectId(接口返回的新记录 id) 明确选中新任务（不依赖列表顺序）；拿不到 id 时退回 followLatest()。
 * 纯前端视图状态，不碰列表数据与轮询。
 */
export function useHistorySelection<T extends { id: number }>(items: Ref<T[]> | { value: T[] }) {
  const selectedId = ref<number | null>(null)
  const current = computed<T | null>(
    () => (selectedId.value !== null ? items.value.find((i) => i.id === selectedId.value) : undefined) ?? items.value[0] ?? null,
  )
  return {
    selectedId,
    current,
    select: (item: T) => {
      selectedId.value = item.id
    },
    /** 按 id 选中（新记录还没进列表时 current 暂时回落到最新一条，列表刷新后自动对上） */
    selectId: (id: number) => {
      selectedId.value = id
    },
    followLatest: () => {
      selectedId.value = null
    },
  }
}
