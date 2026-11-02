/** 本地生活套件共享常量与展示辅助 */

import type * as types from '@/api/localLifeTypes.ts'

// ---------------- 状态文案 ----------------

/** AI文案：0 生成中 / 1 已完成 / 2 失败（形象同义复用） */
export const COPY_STATUS_MAP: Record<number, { label: string; type: 'running' | 'success' | 'error' }> = {
  0: { label: '生成中', type: 'running' },
  1: { label: '已完成', type: 'success' },
  2: { label: '失败', type: 'error' },
}

/** 数字人：0 配音中 / 1 视频生成中 / 2 已完成 / 3 失败 */
export const DH_STATUS_MAP: Record<number, { label: string; type: 'running' | 'success' | 'error' }> = {
  0: { label: '配音中', type: 'running' },
  1: { label: '视频生成中', type: 'running' },
  2: { label: '已完成', type: 'success' },
  3: { label: '失败', type: 'error' },
}

/** 图文笔记：0 构思中 / 1 待确认 / 2 构思失败 / 3 生成中 / 4 已完成 / 5 生成失败 */
export const NOTE_STATUS_MAP: Record<number, { label: string; type: 'running' | 'success' | 'error' | 'warning' }> = {
  0: { label: '构思中', type: 'running' },
  1: { label: '待确认', type: 'warning' },
  2: { label: '构思失败', type: 'error' },
  3: { label: '生成中', type: 'running' },
  4: { label: '已完成', type: 'success' },
  5: { label: '生成失败', type: 'error' },
}

/** 海报/长图/动作迁移/口播：0 生成中 / 1 已完成（含部分成功） / 2 全部失败 */
export const CREATION_STATUS_MAP: Record<number, { label: string; type: 'running' | 'success' | 'error' }> = {
  0: { label: '生成中', type: 'running' },
  1: { label: '已完成', type: 'success' },
  2: { label: '失败', type: 'error' },
}

/** 探店/短剧/复刻：0 构思中 / 1 待确认 / 2 生成中 / 3 已完成 / 4 失败 */
export const VIDEO_STATUS_MAP: Record<number, { label: string; type: 'running' | 'success' | 'error' | 'warning' }> = {
  0: { label: '构思中', type: 'running' },
  1: { label: '待确认', type: 'warning' },
  2: { label: '生成中', type: 'running' },
  3: { label: '已完成', type: 'success' },
  4: { label: '失败', type: 'error' },
}

// ---------------- 各模块「还在跑」的判定（列表轮询依据） ----------------

export const isCopyRunning = (item: { status: number }) => item.status === 0
export const isDhRunning = (item: { status: number }) => item.status === 0 || item.status === 1
/** 笔记只有构思（0）/ 生成（3）两个在跑状态；待确认（1）停在原地等用户操作 */
export const isNoteRunning = (item: { status: number }) => item.status === 0 || item.status === 3
export const isCreationRunning = (item: { status: number }) => item.status === 0
export const isVideoRunning = (item: { status: number }) => item.status === 0 || item.status === 2

// ---------------- 文案衍生成品 kind ----------------

export const DERIVATIVE_KIND_MAP: Record<string, string> = {
  note: '图文笔记',
  poster: 'AI海报',
  long_image: 'AI长图',
  voiceover: '数字人口播',
  digital_human: '数字人视频',
  explore_video: '探店视频',
  promo_drama: '带货短剧',
}

// ---------------- 展示辅助 ----------------

export function formatTime(ms?: number) {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 字符长度：汉字按 2 计（与店铺档案后端校验口径一致）。
 * 码点 > 0xFFFF 的 emoji 等同样按 2 计，不细分。
 */
export function charLen(text: string) {
  let len = 0
  for (const ch of text) len += ch.charCodeAt(0) > 0x7f ? 2 : 1
  return len
}

/** 秒数 → 「X分XX秒」 */
export function formatDuration(sec?: number) {
  if (!sec) return ''
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return m ? `${m}分${s}秒` : `${s}秒`
}

/** 文件大小 → 可读文案 */
export function formatBytes(bytes?: number) {
  if (!bytes) return ''
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)}M`
  return `${Math.max(1, Math.round(bytes / 1024))}K`
}

/** 探店/短剧剧本 JSON 解析。结构不保证，失败返回 null（调用方整段展示原文） */
export function parseScript(script?: string): types.ILScriptScene[] | null {
  if (!script) return null
  try {
    const parsed = JSON.parse(script)
    const scenes = Array.isArray(parsed) ? parsed : parsed?.scenes
    return Array.isArray(scenes) && scenes.length ? (scenes as types.ILScriptScene[]) : null
  } catch {
    return null
  }
}

/** 非本地生活模块也复用：从选项里取展示名 */
export function choiceLabel(list: types.ILLChoice[] | undefined, code?: string) {
  if (!code) return ''
  return list?.find((i) => i.code === code)?.label ?? code
}
