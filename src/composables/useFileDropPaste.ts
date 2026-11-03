/**
 * 上传区通用的「拖入 + 粘贴」接入（对齐原型 SingleImageZone / SingleVideoZone / usePasteTarget）。
 *
 * - 拖入：只接管带文件的拖拽（dataTransfer.types 含 Files），画布节点、文本等内部拖拽不受影响；
 *   dragenter/dragover 置 dragging，dragleave 忽略在子元素之间移动，drop 按类型过滤后交给 onFiles。
 * - 粘贴：只取剪贴板里的图片 / 视频文件；纯文本粘贴原样放行。
 *   普通上传区：鼠标悬停在上传区上、或焦点在上传区内时才接管，避免抢走别的输入框的粘贴；
 *   textEditor：监听编辑器自身的 paste，剪贴板带纯文本时一律按文本粘贴（Office 复制会同时带一张截图）。
 * - 过滤后一个都不剩时，用各上传组件原有的「不是有效的图片 / 视频文件」提示。
 * - onFiles 应直接调用该入口「从文件对话框选中文件」时的同一个处理函数，校验、体积 / 数量限制、上传流程都不重复写。
 */
import { createDiscreteApi, useMessage } from 'naive-ui'
import { getCurrentScope, onScopeDispose, ref, toValue, watch } from 'vue'
import type { ComponentPublicInstance, MaybeRefOrGetter } from 'vue'

export type DropAcceptKind = 'image' | 'video' | 'media'

type TargetEl = HTMLElement | ComponentPublicInstance | null | undefined

export interface UseFileDropPasteOptions {
  /** 接受的文件：image / video / media（图片或视频） */
  accept: MaybeRefOrGetter<DropAcceptKind>
  /** 在 accept 之上再收窄（如只收 jpg/png/webp）；不符的同样按类型不符提示 */
  filter?: (file: File) => boolean
  /** 是否多选；false（默认）时只取第一个 */
  multiple?: MaybeRefOrGetter<boolean | undefined>
  /** 最多交出几个（>0 生效）；数量上限的提示仍由 onFiles 里原有的处理函数负责 */
  max?: MaybeRefOrGetter<number | undefined>
  /** 禁用：不高亮、不接收（仍会拦住浏览器默认的「打开文件」） */
  disabled?: MaybeRefOrGetter<boolean | undefined>
  /** 不要求悬停 / 聚焦：目标在页面上就接管粘贴（弹窗里唯一的上传区用；焦点在别的输入框时仍不接管） */
  globalPaste?: MaybeRefOrGetter<boolean | undefined>
  /** 目标是文本编辑器（contenteditable / textarea）：粘贴监听在元素自身，文本粘贴照常 */
  textEditor?: boolean
  /**
   * 额外的接管条件（目标里只有一部分是上传区时用，如每张任务卡各自接收）：返回 false 时不高亮、不接收、
   * 也不拦粘贴（拖拽仍会拦住浏览器默认的「打开文件」）
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
  return isMedia
}

/** 各上传组件原有的类型不符文案（ImageUpload / VideoUpload / ChatImageUpload） */
function defaultReject(accept: DropAcceptKind, file: File): string {
  if (accept === 'video' || (accept === 'media' && isVideo(file))) return `${file.name} 不是有效的视频文件`
  return `${file.name} 不是有效的图片`
}

/** 拖拽里是否带文件（内部拖拽、文本拖拽不接管） */
export function hasDraggedFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files')
}

/** 剪贴板里的图片 / 视频文件（files 优先，取不到再读 items） */
export function clipboardMediaFiles(data: DataTransfer | null | undefined): File[] {
  if (!data) return []
  let files = Array.from(data.files ?? [])
  if (!files.length) {
    files = Array.from(data.items ?? [])
      .filter((it) => it.kind === 'file')
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f)
  }
  return files.filter(isMedia)
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

function isEditable(el: Element | null): boolean {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement)
    return !['button', 'checkbox', 'radio', 'file', 'submit', 'reset'].includes(el.type)
  return (el as HTMLElement).isContentEditable === true
}

function resolveEl(t: TargetEl): HTMLElement | null {
  if (!t) return null
  if (t instanceof HTMLElement) return t
  const el = (t as ComponentPublicInstance).$el
  return el instanceof HTMLElement ? el : null
}

/** 已被某个（更里层的）上传区接管的拖拽事件 */
const handledEvents = new WeakSet<Event>()

// 没有 NMessageProvider 时（极少数游离挂载）退回独立的 message 实例
let discreteMessage: { warning: (s: string) => unknown } | null = null

export function useFileDropPaste(target: MaybeRefOrGetter<TargetEl>, options: UseFileDropPasteOptions) {
  const dragging = ref(false)
  const hovered = ref(false)

  let message: { warning: (s: string) => unknown } | null = null
  try {
    message = useMessage()
  } catch {
    message = null
  }
  const warn = (text: string) => {
    if (message) return message.warning(text)
    discreteMessage ??= createDiscreteApi(['message']).message
    discreteMessage.warning(text)
  }

  const disabled = () => !!toValue(options.disabled)

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
    let picked = toValue(options.multiple) ? ok : ok.slice(0, 1)
    const max = toValue(options.max)
    if (typeof max === 'number' && max > 0) picked = picked.slice(0, max)
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
    if (disabled() || (options.active && !options.active(e))) {
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
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
    if (disabled() || (options.active && !options.active(e))) return
    deliver(Array.from(e.dataTransfer?.files ?? []), e)
  }

  // ---------- 粘贴 ----------
  function onPaste(e: ClipboardEvent) {
    if (e.defaultPrevented || disabled()) return
    const el = resolveEl(toValue(target))
    if (!el?.isConnected) return
    if (options.textEditor) {
      // 带文字就按文字粘贴，交给编辑器原有逻辑
      if (clipboardHasText(e.clipboardData)) return
    } else {
      const active = document.activeElement
      const focusedInside = !!active && active !== document.body && el.contains(active)
      if (!hovered.value && !focusedInside && !toValue(options.globalPaste)) return
      // 焦点在别处的输入框里：那是在给输入框粘贴，不接管
      if (!focusedInside && isEditable(active)) return
    }
    // 正在往输入框里粘文字（Office 复制会顺带一张截图）：按文字粘贴
    if (!options.textEditor && isEditable(document.activeElement) && clipboardHasText(e.clipboardData)) return
    const files = clipboardMediaFiles(e.clipboardData)
    if (!files.length) return
    if (options.active && !options.active(e)) return
    e.preventDefault()
    deliver(files, e)
  }

  const onEnter = () => (hovered.value = true)
  const onLeave = () => (hovered.value = false)

  let detach: (() => void) | null = null
  function attach(el: HTMLElement) {
    el.addEventListener('dragenter', onDragOver)
    el.addEventListener('dragover', onDragOver)
    el.addEventListener('dragleave', onDragLeave)
    el.addEventListener('drop', onDrop)
    el.addEventListener('mouseenter', onEnter)
    el.addEventListener('mouseleave', onLeave)
    const pasteHost: HTMLElement | Document = options.textEditor ? el : document
    pasteHost.addEventListener('paste', onPaste as EventListener)
    detach = () => {
      el.removeEventListener('dragenter', onDragOver)
      el.removeEventListener('dragover', onDragOver)
      el.removeEventListener('dragleave', onDragLeave)
      el.removeEventListener('drop', onDrop)
      el.removeEventListener('mouseenter', onEnter)
      el.removeEventListener('mouseleave', onLeave)
      pasteHost.removeEventListener('paste', onPaste as EventListener)
      dragging.value = false
      hovered.value = false
    }
  }

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
      detach?.()
      detach = null
    })
  }

  return {
    /** 正在把文件拖到目标上：用来切换拖入高亮（UnoCSS shortcut sx-drop / sx-drop-ring） */
    dragging,
    /** 鼠标在目标上（粘贴接管条件之一） */
    hovered,
  }
}
