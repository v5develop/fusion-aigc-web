/**
 * 上传区通用的「拖入 + 粘贴」接入（对齐原型 SingleImageZone / SingleVideoZone / usePasteTarget）。
 * 全站每个上传入口都要同时支持拖入与粘贴（2026-11-11 用户反馈），新上传区一律接这一份，不要再手写 drop / paste。
 *
 * 拖入：整块上传区就是放置目标。只接管带文件的拖拽（dataTransfer.types 含 Files），画布节点、文本等内部拖拽不受影响；
 *   dragenter/dragover 置 dragging（配 sx-drop / sx-drop-ring 或组件原有的拖入样式），dragleave 忽略在子元素之间移动；
 *   drop 按 accept / filter 过滤，类型不符给明确提示；禁用 / 已满时提示「已达上限」或 disabledMessage，不再静默忽略。
 *
 * 粘贴：全页只有一个 document 级监听，按下面的顺序把一次粘贴交给唯一的上传区（见 routePaste）：
 *   0. 剪贴板里没有文件 → 不管（纯文本粘贴、画布节点粘贴照常）；事件已被别的处理器 preventDefault → 不管
 *   1. 只看「当前层」：有打开的弹窗 / 抽屉时只在最上层那个里面找，底下页面的上传区不参与
 *   2. 焦点在输入框 / 文本框 / 可编辑区里：剪贴板带文字一律按文字粘贴；只有文件时，交给关联了这个输入框的上传区
 *      （焦点在上传区内，或在它的 pasteArea 里，如智能体输入框 / 提示词框参考图条），没有关联的就不接管
 *   3. 鼠标悬停的上传区，其次焦点所在的上传区（嵌套时取最里层；同一处多个时优先类型对得上的）
 *   4. 当前层里只有一个可用的上传区 → 它
 *   5. 标了 pastePrimary 的上传区 → 它
 *   6. 仍分不出来 → 提示先把鼠标移到目标上传区；都已满 → 「已达上限」
 *   选中的上传区已满提示「已达上限」、禁用提示 disabledMessage，不静默忽略；交出去的文件走 onFiles，与文件对话框同一个处理函数（校验、体积、时长、上传、进度都不重复写）。
 */
import { createDiscreteApi, useMessage } from 'naive-ui'
import { getCurrentScope, onScopeDispose, ref, toValue, watch } from 'vue'
import type { ComponentPublicInstance, MaybeRefOrGetter, Ref } from 'vue'

/** image / video / media（图片或视频）/ file（任意文件，再用 filter 收窄） */
export type DropAcceptKind = 'image' | 'video' | 'media' | 'file'

type TargetEl = HTMLElement | ComponentPublicInstance | null | undefined

/** 上传区说明文字里的统一提示（有地方放时加上） */
export const DROP_PASTE_HINT = '支持拖拽或粘贴（Ctrl/⌘+V）'
/** 已满 / 禁用的上传区收到文件时的默认提示 */
export const ZONE_FULL_TEXT = '已达上限'
/** 禁用（上传中 / 生成中等）的上传区收到文件时的默认提示 */
export const ZONE_BUSY_TEXT = '当前不可添加，请稍候再试'

export interface UseFileDropPasteOptions {
  /** 接受的文件：image / video / media / file */
  accept: MaybeRefOrGetter<DropAcceptKind>
  /** 在 accept 之上再收窄（如只收 jpg/png/webp）；不符的同样按类型不符提示 */
  filter?: (file: File) => boolean
  /** 是否多选；false（默认）时只取第一个 */
  multiple?: MaybeRefOrGetter<boolean | undefined>
  /** 最多还能交出几个；是数字且 ≤ 0 视为已满。多出的截掉并提示 */
  max?: MaybeRefOrGetter<number | undefined>
  /** 已满：不高亮，收到文件提示 fullMessage */
  full?: MaybeRefOrGetter<boolean | undefined>
  /** 已满时的提示；不传为「已达上限」（需要说明怎么腾位置时才传） */
  fullMessage?: MaybeRefOrGetter<string | undefined>
  /** 禁用（上传中 / 表单锁定等）：不高亮，收到文件提示 disabledMessage */
  disabled?: MaybeRefOrGetter<boolean | undefined>
  /** 禁用时的提示；不传为 ZONE_BUSY_TEXT */
  disabledMessage?: MaybeRefOrGetter<string | undefined>
  /** 页面 / 弹窗里有多个上传区、又没悬停在任何一个上时，粘贴交给它 */
  pastePrimary?: MaybeRefOrGetter<boolean | undefined>
  /** @deprecated 同 pastePrimary（弹窗里唯一的上传区不需要再标，路由规则 4 会选中它） */
  globalPaste?: MaybeRefOrGetter<boolean | undefined>
  /**
   * 关联的输入区（如智能体输入框整块）：焦点在这里时，只带文件的粘贴交给本上传区；带文字仍按文字粘贴。
   * 鼠标悬停在这里也算悬停在本上传区上。不传时，上传区若在带 data-paste-area 属性的容器里，就以该容器为关联输入区
   * （只影响焦点判断，悬停仍以上传区本身为准）
   */
  pasteArea?: MaybeRefOrGetter<TargetEl>
  /** 目标本身是文本编辑器（contenteditable / textarea）：效果同把自己设为 pasteArea，文字粘贴照常 */
  textEditor?: boolean
  /** 只接粘贴、不接拖入（拖入另有自己的实现时用，如画布舞台） */
  drop?: boolean
  /** 不接粘贴（默认接） */
  paste?: MaybeRefOrGetter<boolean | undefined>
  /**
   * 额外的接管条件（目标里只有一部分是上传区时用，如每张任务卡各自接收）：返回 false 时不高亮、不接收
   * （拖拽仍会拦住浏览器默认的「打开文件」）
   */
  active?: (event: DragEvent | ClipboardEvent) => boolean
  /** 类型不符的提示；不传按 accept 用各上传组件原有的文案 */
  rejectMessage?: (file: File) => string
  /** 收到通过类型过滤的文件；event 是触发它的 drop / paste 事件 */
  onFiles: (files: File[], event: DragEvent | ClipboardEvent) => void
}

const isImage = (f: File) => f.type.startsWith('image/')
const isVideo = (f: File) => f.type.startsWith('video/')
const isMedia = (f: File) => isImage(f) || isVideo(f)

function matcherOf(accept: DropAcceptKind): (f: File) => boolean {
  if (accept === 'image') return isImage
  if (accept === 'video') return isVideo
  if (accept === 'file') return () => true
  return isMedia
}

/** 各上传组件原有的类型不符文案（ImageUpload / VideoUpload / ChatImageUpload） */
function defaultReject(accept: DropAcceptKind, file: File): string {
  if (accept === 'file') return `${file.name} 格式不支持`
  if (accept === 'video' || (accept === 'media' && isVideo(file))) return `${file.name} 不是有效的视频文件`
  return `${file.name} 不是有效的图片`
}

/** 拖拽里是否带文件（内部拖拽、文本拖拽不接管） */
export function hasDraggedFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files')
}

/** 剪贴板里的全部文件（files 优先，取不到再读 items） */
export function clipboardFiles(data: DataTransfer | null | undefined): File[] {
  if (!data) return []
  const files = Array.from(data.files ?? [])
  if (files.length) return files
  return Array.from(data.items ?? [])
    .filter((it) => it.kind === 'file')
    .map((it) => it.getAsFile())
    .filter((f): f is File => !!f)
}

/** 剪贴板里的图片 / 视频文件 */
export function clipboardMediaFiles(data: DataTransfer | null | undefined): File[] {
  return clipboardFiles(data).filter(isMedia)
}

/** 剪贴板是否带非空纯文本 */
export function clipboardHasText(data: DataTransfer | null | undefined): boolean {
  return !!data?.getData('text/plain')?.trim()
}

/** 自定义上传块（div role=button）的键盘入口：Enter / Space 打开选择器 */
export function onPickerKeydown(e: KeyboardEvent, open: () => void) {
  if (e.target !== e.currentTarget) return
  if (e.key !== 'Enter' && e.key !== ' ') return
  e.preventDefault()
  open()
}

export function isEditable(el: Element | null): boolean {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement)
    return !['button', 'checkbox', 'radio', 'file', 'submit', 'reset', 'range', 'color'].includes(el.type)
  return (el as HTMLElement).isContentEditable === true
}

function resolveEl(t: TargetEl): HTMLElement | null {
  if (!t) return null
  if (t instanceof HTMLElement) return t
  const el = (t as ComponentPublicInstance).$el
  return el instanceof HTMLElement ? el : null
}

const isShown = (el: Element) => el.isConnected && el.getClientRects().length > 0

// ---------------- 消息 ----------------

// 没有 NMessageProvider 时（极少数游离挂载）退回独立的 message 实例
let discreteMessage: { warning: (s: string) => unknown } | null = null
function fallbackWarn(text: string) {
  discreteMessage ??= createDiscreteApi(['message']).message
  discreteMessage.warning(text)
}

// ---------------- 粘贴路由 ----------------

interface PasteZone {
  el: () => HTMLElement | null
  area: () => HTMLElement | null
  hovered: Ref<boolean>
  areaHovered: Ref<boolean>
  enabled: () => boolean
  blocked: () => string | null
  primary: () => boolean
  accepts: (e: ClipboardEvent) => boolean
  /** 剪贴板里至少有一个文件符合本上传区的类型 */
  matches: (files: File[]) => boolean
  receive: (files: File[], e: ClipboardEvent) => void
  warn: (text: string) => void
}

const zones = new Set<PasteZone>()

/** 弹窗 / 抽屉层：Naive n-modal（body-wrapper）/ n-drawer，及自绘的 aria-modal 弹层 */
const LAYER_SELECTOR = '.n-modal-body-wrapper, .n-drawer, [aria-modal="true"]'

/** 弹层在 body 下的叠放层级：取最外层带数字 z-index 的祖先（Naive 的 zindexable 写在 n-modal-container 上） */
function stackZ(el: Element): number {
  let z = 0
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    const v = Number.parseInt(getComputedStyle(n).zIndex, 10)
    if (!Number.isNaN(v)) z = v
  }
  return z
}

function topLayer(): Element | null {
  const layers = Array.from(document.querySelectorAll(LAYER_SELECTOR)).filter(isShown)
  // 不能只看文档顺序：Naive 的弹层容器在第一次打开时才挂到 body 并一直留着，先开过的弹层再次叠在上面时反而排在前面。
  // 按 z-index 取最高，同层级再取文档顺序最后一个
  let top: Element | null = null
  let topZ = -Infinity
  for (const layer of layers) {
    const z = stackZ(layer)
    if (z >= topZ) {
      top = layer
      topZ = z
    }
  }
  return top
}

function inside(container: HTMLElement | null, node: Element | null): boolean {
  return !!container && !!node && node !== document.body && container.contains(node)
}

/** 嵌套时取最里层（不包含其它候选的那个） */
function innermost(list: PasteZone[]): PasteZone | undefined {
  return list.find((z) => !list.some((o) => o !== z && inside(z.el(), o.el())))
}

function pasteTarget(e: ClipboardEvent, files: File[], typing: boolean): PasteZone | 'ambiguous' | 'none' {
  const layer = topLayer()
  const candidates = [...zones].filter((z) => {
    const el = z.el()
    if (!el || !isShown(el) || !z.enabled() || !z.accepts(e)) return false
    // 有弹层时只认最上层里面的；没有弹层时排除挂在（隐藏中的）弹层里的
    return layer ? layer.contains(el) : true
  })
  if (!candidates.length) return 'none'
  // 同一处有多个上传区时，优先类型对得上的（图片槽 / 视频槽并排）；都对不上就照常选，由选中的那个提示类型不符
  const prefer = (list: PasteZone[]) => {
    const fit = list.filter((z) => z.matches(files))
    return fit.length ? fit : list
  }
  const active = document.activeElement
  const focused = () => innermost(prefer(candidates.filter((z) => inside(z.el(), active) || inside(z.area(), active))))
  // 正在输入：只交给关联了这个输入框的上传区；不属于任何上传区的输入框不接管
  if (typing) return focused() ?? 'none'
  // 悬停优先于焦点：点过上传按钮后焦点会留在那里，鼠标已经移到别的上传区时以鼠标为准
  // 再用 :hover 核一遍：元素被 KeepAlive 挪走 / 被别的层盖住时收不到 mouseleave，标记可能残留
  const isHovered = (z: PasteZone) =>
    (z.hovered.value && !!z.el()?.matches(':hover')) || (z.areaHovered.value && !!z.area()?.matches(':hover'))
  const hovered = innermost(prefer(candidates.filter(isHovered)))
  if (hovered) return hovered
  const focusedZone = focused()
  if (focusedZone) return focusedZone
  // 嵌套的上传区（如工具槽里的叠片）算一个：数「唯一」时只数最外层
  const pool = prefer(candidates)
  const roots = pool.filter((z) => !pool.some((o) => o !== z && inside(o.el(), z.el())))
  const open = roots.filter((z) => !z.blocked())
  if (open.length === 1) return open[0]!
  const primary = pool.find((z) => z.primary())
  if (primary) return primary
  if (roots.length === 1) return roots[0]!
  return open.length ? 'ambiguous' : roots[0]!
}

function onDocumentPaste(e: ClipboardEvent) {
  if (e.defaultPrevented) return
  const files = clipboardFiles(e.clipboardData)
  if (!files.length) return
  const typing = isEditable(document.activeElement)
  // 正在输入框里粘文字（Office 复制会顺带一张截图）：按文字粘贴
  if (typing && clipboardHasText(e.clipboardData)) return
  const target = pasteTarget(e, files, typing)
  if (target === 'none') return
  e.preventDefault()
  if (target === 'ambiguous') {
    const anyZone = [...zones][0]
    const text = '页面上有多个上传区，请先把鼠标移到要放入的上传区上再粘贴'
    if (anyZone) anyZone.warn(text)
    else fallbackWarn(text)
    return
  }
  const blocked = target.blocked()
  if (blocked) {
    target.warn(blocked)
    return
  }
  target.receive(files, e)
}

function register(zone: PasteZone) {
  if (!zones.size) document.addEventListener('paste', onDocumentPaste)
  zones.add(zone)
}
function unregister(zone: PasteZone) {
  zones.delete(zone)
  if (!zones.size) document.removeEventListener('paste', onDocumentPaste)
}

/** 已被某个（更里层的）上传区接管的拖拽事件 */
const handledEvents = new WeakSet<Event>()

export function useFileDropPaste(target: MaybeRefOrGetter<TargetEl>, options: UseFileDropPasteOptions) {
  const dragging = ref(false)
  const hovered = ref(false)
  const areaHovered = ref(false)

  let message: { warning: (s: string) => unknown } | null = null
  try {
    message = useMessage()
  } catch {
    message = null
  }
  const warn = (text: string) => {
    if (message) message.warning(text)
    else fallbackWarn(text)
  }

  const disabled = () => !!toValue(options.disabled)
  const maxValue = () => {
    const max = toValue(options.max)
    return typeof max === 'number' ? max : undefined
  }
  const full = () => !!toValue(options.full) || (maxValue() ?? 1) <= 0
  /** 不能接收时的提示；能接收为 null */
  const blocked = (): string | null => {
    if (full()) return toValue(options.fullMessage) || ZONE_FULL_TEXT
    if (disabled()) return toValue(options.disabledMessage) || ZONE_BUSY_TEXT
    return null
  }

  /** 过滤、截断后交给 onFiles；返回是否真的交出了文件 */
  function deliver(files: File[], event: DragEvent | ClipboardEvent): boolean {
    if (!files.length) return false
    const accept = toValue(options.accept)
    const match = matcherOf(accept)
    const ok = files.filter((f) => match(f) && (!options.filter || options.filter(f)))
    if (!ok.length) {
      warn(options.rejectMessage ? options.rejectMessage(files[0]!) : defaultReject(accept, files[0]!))
      return false
    }
    if (ok.length < files.length) {
      const bad = files.find((f) => !ok.includes(f))!
      warn(options.rejectMessage ? options.rejectMessage(bad) : `已跳过 ${files.length - ok.length} 个格式不符的文件`)
    }
    let picked = toValue(options.multiple) ? ok : ok.slice(0, 1)
    const max = maxValue()
    if (typeof max === 'number' && max > 0 && picked.length > max) {
      warn(`最多还能添加 ${max} 个，已忽略多出的 ${picked.length - max} 个`)
      picked = picked.slice(0, max)
    }
    options.onFiles(picked, event)
    return true
  }

  // ---------- 拖入 ----------
  function onDragOver(e: DragEvent) {
    if (!hasDraggedFiles(e)) return
    // 一律拦住：否则松手时浏览器会直接打开这个文件
    e.preventDefault()
    // 嵌套的上传区：最里层的那个接管，外层只清自己的高亮
    if (handledEvents.has(e)) {
      dragging.value = false
      return
    }
    handledEvents.add(e)
    if (options.active && !options.active(e)) {
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
      dragging.value = false
      return
    }
    if (blocked()) {
      // 不高亮，但不设 dropEffect = 'none'：那样松手时浏览器不派发 drop，「已达上限 / 请稍候」的提示就出不来了
      dragging.value = false
      return
    }
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    dragging.value = true
  }
  function onDragLeave(e: DragEvent) {
    const el = resolveEl(toValue(target))
    const next = e.relatedTarget
    // 在子元素之间移动不算离开
    if (el && next instanceof Node && el.contains(next)) return
    dragging.value = false
  }
  function onDrop(e: DragEvent) {
    if (!hasDraggedFiles(e)) return
    e.preventDefault()
    dragging.value = false
    if (handledEvents.has(e)) return
    handledEvents.add(e)
    if (options.active && !options.active(e)) return
    const reason = blocked()
    if (reason) {
      warn(reason)
      return
    }
    deliver(Array.from(e.dataTransfer?.files ?? []), e)
  }

  // ---------- 粘贴（登记到全局路由） ----------
  const zone: PasteZone = {
    el: () => resolveEl(toValue(target)),
    area: () => {
      if (options.textEditor) return resolveEl(toValue(target))
      const explicit = resolveEl(toValue(options.pasteArea))
      if (explicit) return explicit
      // 放在带 data-paste-area 的输入框容器里（如提示词一体框里的参考图条）：容器即关联的输入区
      const host = resolveEl(toValue(target))?.parentElement?.closest('[data-paste-area]')
      return host instanceof HTMLElement ? host : null
    },
    hovered,
    areaHovered,
    enabled: () => toValue(options.paste) !== false,
    blocked,
    primary: () => !!toValue(options.pastePrimary) || !!toValue(options.globalPaste),
    accepts: (e) => !options.active || options.active(e),
    matches: (files) => {
      const match = matcherOf(toValue(options.accept))
      return files.some((f) => match(f) && (!options.filter || options.filter(f)))
    },
    receive: (files, e) => void deliver(files, e),
    warn,
  }
  register(zone)

  const onEnter = () => (hovered.value = true)
  const onLeave = () => (hovered.value = false)
  const onAreaEnter = () => (areaHovered.value = true)
  const onAreaLeave = () => (areaHovered.value = false)

  let detach: (() => void) | null = null
  function attach(el: HTMLElement) {
    const withDrop = options.drop !== false
    if (withDrop) {
      el.addEventListener('dragenter', onDragOver)
      el.addEventListener('dragover', onDragOver)
      el.addEventListener('dragleave', onDragLeave)
      el.addEventListener('drop', onDrop)
    }
    el.addEventListener('mouseenter', onEnter)
    el.addEventListener('mouseleave', onLeave)
    detach = () => {
      if (withDrop) {
        el.removeEventListener('dragenter', onDragOver)
        el.removeEventListener('dragover', onDragOver)
        el.removeEventListener('dragleave', onDragLeave)
        el.removeEventListener('drop', onDrop)
      }
      el.removeEventListener('mouseenter', onEnter)
      el.removeEventListener('mouseleave', onLeave)
      dragging.value = false
      hovered.value = false
    }
  }

  let detachArea: (() => void) | null = null
  const stopArea = watch(
    () => (options.textEditor ? null : resolveEl(toValue(options.pasteArea))),
    (el) => {
      detachArea?.()
      detachArea = null
      if (!el) return
      el.addEventListener('mouseenter', onAreaEnter)
      el.addEventListener('mouseleave', onAreaLeave)
      detachArea = () => {
        el.removeEventListener('mouseenter', onAreaEnter)
        el.removeEventListener('mouseleave', onAreaLeave)
        areaHovered.value = false
      }
    },
    { immediate: true, flush: 'post' },
  )

  const stop = watch(
    () => resolveEl(toValue(target)),
    (el) => {
      detach?.()
      detach = null
      if (el) attach(el)
    },
    { immediate: true, flush: 'post' },
  )

  if (getCurrentScope()) {
    onScopeDispose(() => {
      stop()
      stopArea()
      detach?.()
      detachArea?.()
      detach = null
      detachArea = null
      unregister(zone)
    })
  }

  return {
    /** 正在把文件拖到目标上：用来切换拖入高亮（UnoCSS shortcut sx-drop / sx-drop-ring） */
    dragging,
    /** 鼠标在目标上（粘贴路由条件之一） */
    hovered,
  }
}
