import type { InjectionKey, Ref } from 'vue'

/**
 * 中栏历史卡与右栏结果共用的「当前选中批次」（task 组的 taskId）。
 * Container 提供，HistoryColumn 写、RecordList 读；null = 跟随最新一批。
 */
export const EC_SELECTED_TASK_KEY: InjectionKey<Ref<string | null>> = Symbol('ecSelectedTask')

/** 最新一批：按 createTime（yyyy-MM-dd HH:mm:ss，字符串可直接比较）取最大；没有时间的排在最后 */
export function newestGroup<T extends { createTime?: string }>(groups: T[]): T | undefined {
  let best: T | undefined
  for (const g of groups) {
    if (!best || String(g.createTime ?? '') > String(best.createTime ?? '')) best = g
  }
  return best
}

/** 选中的批次：选中项还在就用它，否则退回最新一批 */
export function selectedGroupOf<T extends { taskId?: string; createTime?: string }>(
  groups: T[],
  selectedId: string | null | undefined,
): T | undefined {
  return (selectedId ? groups.find((g) => g.taskId === selectedId) : undefined) ?? newestGroup(groups)
}
