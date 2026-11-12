/**
 * 工具页功能目录的「收起 / 展开」记忆（原型 App.vue 的 xq-v3-dir-collapsed），按账号存本机。
 *
 * <p>key 带账号 id（auth-session 的 currentAccountId，即 fusion_identity）；账号还没认出来时不读不写，
 * 用默认（展开）。localStorage 一律 try/catch：无痕 / 禁用存储时只是不记忆，页面照常。
 * 换账号（onAccountChange）重读该账号的值。key 前缀登记在 auth-session 的 ACCOUNT_KEYED_PREFIXES，换号清缓存时保留。
 */
import { onBeforeUnmount, ref, watch } from 'vue'
import { currentAccountId, onAccountChange } from '@/utils/auth-session.ts'

export const DIR_COLLAPSED_KEY_PREFIX = 'xq-dir-collapsed:'

function keyOf(): string {
  const who = currentAccountId()
  return who ? `${DIR_COLLAPSED_KEY_PREFIX}${who}` : ''
}

function read(): boolean {
  const key = keyOf()
  if (!key) return false
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function write(value: boolean) {
  const key = keyOf()
  if (!key) return
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    // 存不了就只在本次页面内生效
  }
}

/** 用户选择的目录收起态（宽屏下才生效；窄屏由宿主固定收起 + 浮层） */
export function useDirCollapsedPref() {
  const collapsed = ref(read())
  /** 账号还没认出来时用户就改了：等账号认出来再补写一次，不然这次选择白丢 */
  let pendingWrite = false
  watch(collapsed, (v) => {
    if (!keyOf()) pendingWrite = true
    write(v)
  })
  const off = onAccountChange(() => {
    if (pendingWrite && keyOf()) {
      pendingWrite = false
      write(collapsed.value)
      return
    }
    // 换到另一个账号：读它自己的值；赋同值不触发 watch，不会回写
    collapsed.value = read()
  })
  onBeforeUnmount(off)
  return collapsed
}
