<script setup lang="ts">
import { upload } from '@/api/ossUpload.ts'
import { ACCEPT_IMAGE } from '@/utils/utils'
import { useDialog, useMessage } from 'naive-ui'
import { computed, defineAsyncComponent, ref } from 'vue'
import { useFileDropPaste } from '@/composables/useFileDropPaste'
import {
  UPLOAD_ENTRY_ASSET_LABEL,
  badgeClass,
  isBadgeDisabled,
  parseAspectRatio,
  resolveUploadBadges,
  type ResolvedUploadBadge,
  type UploadBadgeInput,
  type UploadBadgeVisibility,
} from './uploadBadges.ts'

// 资产库选择弹窗按需加载：只有开了 fromAsset 角标的页面才会用到
const AssetPickerModal = defineAsyncComponent(() => import('@/views/studio/components/AssetPickerModal/index.vue'))

interface IProps {
  type?: 'card' // 上传控件样式
  limitNumber?: number // 限制上传张数
  exampleImages?: string[] // 示例图
  btnName?: string // 按钮名称
  multiple?: boolean
  topRightTips?: boolean // 把topRightTips=false和limitNumber=1，就能提示只能上传一张
  bottomTips?: boolean
  tryImages?: any[] // 试一试图片
  field?: string // imgList为对象数组时，取图片地址的key，默认image
  customResultHandle?: (value: string[]) => void // 自定义返回处理
  customBeforeUpload?: () => boolean // 文件上传之前的回调，返回 false 会取消本次上传

  // ---- 以下为可选配置；不传时外观与行为和原来完全一致 ----
  /** 缩略图宽（px），默认 58 */
  tileSize?: number
  /** 缩略图宽高比，如 "3 / 4"、0.75；默认 1（正方形） */
  tileAspectRatio?: string | number
  /** 上传按钮文字；不传 = btnName */
  placeholderLabel?: string
  /** 每行最多几张缩略图；不传 = 按宽度自动换行（原样） */
  maxPerRow?: number
  /** 缩略图角标（replace / delete / preview / fromAsset 或自定义）；默认不开，沿用原来的黑色删除小圆钮 */
  badgeActions?: UploadBadgeInput[]
  /** 角标显隐：hover（悬停 / 聚焦时出现，默认）| always（常显）；单个角标可再覆盖 */
  badgeVisibility?: UploadBadgeVisibility
  /** 还没有图片时，在按钮下方显示的一行提示；默认不显示 */
  emptyText?: string
  /** 删除前二次确认；true 用默认文案，传字符串作确认文案；默认不确认（原样） */
  confirmDelete?: boolean | string
  /** 上传按钮旁出「从资产库添加」文字入口（只开入口，不开缩略图角标，删除钮等外观不变）；默认不开 */
  fromAsset?: boolean
}
const {
  type = 'default',
  limitNumber,
  exampleImages,
  multiple = false,
  topRightTips = true,
  bottomTips,
  btnName = '上传产品图',
  field = 'image',
  customResultHandle,
  customBeforeUpload = () => true,
  tileSize = 58,
  tileAspectRatio,
  placeholderLabel,
  maxPerRow,
  badgeActions,
  badgeVisibility = 'hover',
  emptyText,
  confirmDelete = false,
  fromAsset = false,
} = defineProps<IProps>()

const emit = defineEmits<{
  /** 角标被点击（内置动作照常执行；自定义 key 只发这个事件） */
  'badge-click': [key: string, index: number]
}>()
const imgList = defineModel<any[]>('imgList', {
  default: () => [],
})

const message = useMessage()
const dialog = useDialog()
const loading = ref(false)
const uploadRef = ref<HTMLInputElement | null>(null)

// 已达上传上限：此时按钮点击只会弹「最多上传N张」，没有操作意义，直接隐藏。
// 需要换图时先删除已传图片，上传按钮会重新出现。
const limitReached = computed(() => !!limitNumber && imgList.value.length >= limitNumber)

// 只能传 1 张时，让按钮与图片共用一个固定高度的槽位。
// 否则上传瞬间按钮消失(-72)、图片出现(+58)，净 -14，整个上传框会跳一下。
const singleSlot = computed(() => limitNumber === 1)

const deleteImg = (index: number) => {
  imgList.value.splice(index, 1)
}

// ---------------- 可选配置 ----------------
const triggerLabel = computed(() => placeholderLabel ?? btnName)
const tileHeight = computed(() => Math.round(tileSize / parseAspectRatio(tileAspectRatio)))
// 每行张数：缩略图之间 gap 4
const rowStyle = computed(() =>
  maxPerRow ? { maxWidth: `${maxPerRow * tileSize + (maxPerRow - 1) * 4}px` } : undefined,
)
const badges = computed(() => resolveUploadBadges(badgeActions, 'image', badgeVisibility))
const hasBadges = computed(() => badges.value.length > 0)
const entryAssetBadge = computed(
  () =>
    badges.value.find((b) => b.key === 'fromAsset') ??
    (fromAsset ? resolveUploadBadges(['fromAsset'], 'image', badgeVisibility)[0] : undefined),
)

const urlOf = (item: any): string => item?.[field] ?? item

/** 删除（角标入口）：调用方开了 confirmDelete 才二次确认 */
const removeAt = (index: number) => {
  if (!confirmDelete) return deleteImg(index)
  dialog.warning({
    title: '移除图片',
    content: typeof confirmDelete === 'string' ? confirmDelete : '确定移除这张图片吗？',
    positiveText: '移除',
    negativeText: '取消',
    onPositiveClick: () => deleteImg(index),
  })
}

/** 替换第 index 张：对象项只改图片地址字段，其余字段保留 */
const setAt = (index: number, url: string) => {
  const old = imgList.value[index]
  imgList.value.splice(index, 1, old && typeof old === 'object' ? { ...old, [field]: url } : url)
}

// 替换：复用同一个 input，单选
const replaceIndex = ref<number | null>(null)
const openReplace = (index: number) => {
  if (!customBeforeUpload?.()) return
  replaceIndex.value = index
  uploadRef.value!.multiple = false
  uploadRef.value!.click()
}

// 预览
const previewUrl = ref('')
const previewShow = ref(false)
const openPreview = (index: number) => {
  previewUrl.value = urlOf(imgList.value[index])
  previewShow.value = true
}

// 资产库：index = -1 表示追加，否则替换该张
const assetShow = ref(false)
const assetIndex = ref(-1)
const assetLimit = computed(() => (assetIndex.value >= 0 ? 1 : Math.max(1, (limitNumber ?? 1) - imgList.value.length)))
const openAsset = (index: number) => {
  if (loading.value || !customBeforeUpload?.()) return
  if (index < 0 && limitNumber && imgList.value.length >= limitNumber) {
    return message.warning(`最多上传${limitNumber}张图片`)
  }
  assetIndex.value = index
  assetShow.value = true
}
const onAssetSelect = (urls: string[]) => {
  if (!urls.length) return
  if (assetIndex.value >= 0) return setAt(assetIndex.value, urls[0]!)
  if (customResultHandle) return customResultHandle(urls)
  const fresh = urls.filter((u) => !imgList.value.some((it) => urlOf(it) === u))
  imgList.value.push(...fresh.slice(0, (limitNumber ?? 1) - imgList.value.length))
}

const onBadge = (badge: ResolvedUploadBadge, index: number) => {
  if (isBadgeDisabled(badge, index)) return
  emit('badge-click', badge.key, index)
  if (badge.onClick) return badge.onClick(index)
  if (badge.key === 'delete') removeAt(index)
  else if (badge.key === 'replace') openReplace(index)
  else if (badge.key === 'preview') openPreview(index)
  else if (badge.key === 'fromAsset') openAsset(index)
}

const handleUpload = async (e: Event) => {
  const target = e.target as HTMLInputElement
  const files = target.files
  if (!files || files.length === 0) return
  uploadFiles(Array.from(files))
}

/** 选文件 / 拖入 / 粘贴共用的校验 + 上传 */
const uploadFiles = (fileArray: File[]) => {
  // 校验是否为图片类型
  for (const file of fileArray) {
    if (!file.type.startsWith('image/')) {
      replaceIndex.value = null
      uploadRef.value!.multiple = multiple
      return message.warning(`${file.name} 不是有效的图片`)
    }
  }
  loading.value = true
  const replacing = replaceIndex.value
  replaceIndex.value = null
  upload(fileArray)
    .then((urls) => {
      if (replacing !== null) {
        if (urls[0]) setAt(replacing, urls[0])
        return
      }
      if (customResultHandle) {
        customResultHandle(urls)
        return
      }
      imgList.value.push(...urls.slice(0, (limitNumber ?? 1) - imgList.value.length))
    })
    .finally(() => {
      loading.value = false
      uploadRef.value!.value = ''
      uploadRef.value!.multiple = multiple
    })
}

/** 追加前的统一检查（选文件 / 拖入 / 粘贴同一套） */
const canAppend = () => {
  if (!customBeforeUpload?.()) return false
  // 上次「替换」若取消了选文件，这里清掉，避免普通上传被当成替换
  replaceIndex.value = null
  uploadRef.value!.multiple = multiple

  if (limitNumber && imgList.value.length >= limitNumber) {
    message.warning(`最多上传${limitNumber}张图片`)
    return false
  }
  return true
}

const beforeUpload = () => {
  if (!canAppend()) return
  uploadRef.value!.click()
}

// 拖入 / 粘贴：与选文件走同一套检查和上传
const dropRef = ref<HTMLElement | null>(null)
const { dragging } = useFileDropPaste(dropRef, {
  accept: 'image',
  multiple: () => multiple,
  max: () => (limitNumber ? limitNumber - imgList.value.length : undefined),
  disabled: loading,
  onFiles: (files) => {
    if (canAppend()) uploadFiles(files)
  },
})

const tryClick = (url: string) => {
  if (imgList.value.includes(url)) return

  if (limitNumber && imgList.value.length >= limitNumber) {
    return message.warning(`最多上传${limitNumber}张图片`)
  }

  imgList.value.push(url)
}

// 样式（规范 §5.9 上传槽、§4.1 按钮、§4.2 动效）：1px 控件描边 + 白→#f9fafb，r8；hover 描边 violet-line、底 →#fbf7fd
const ZONE =
  'relative flex flex-col items-center pb-16px overflow-hidden rounded-lg border border-solid border-control sx-grad-upload ' +
  'transition-colors duration-mid ease-sx hover:(border-violet-line to-#fbf7fd) motion-reduce:transition-none'
// 右上角「支持多图」角标：柔紫底 + 紫字，左下圆角与槽位 r8 一致
const LIMIT_TIPS =
  'absolute top-0 right-0 w-124px h-24px flex items-center justify-center text-12px rounded-[0_8px] bg-violet-soft text-violet-ink'
// 上传按钮：默认按钮材质（§4.1 .sx-btn），保持原 40 高、最小宽 130
const UPLOAD_BTN =
  'sx-btn !h-40px min-w-130px !px-16px !gap-8px !text-14px [font-family:inherit] ' +
  'transition-[border-color,color,box-shadow] duration-fast ease-sx motion-reduce:transition-none'
// 删除小圆钮
const DELETE_BTN =
  'absolute top-4px right-4px w-16px h-16px p-0 rounded-full flex items-center justify-center cursor-pointer ' +
  'bg-ink hover:opacity-90 sx-focus'
// card 型触发块：与上传槽同材质
const CARD_TRIGGER =
  'w-full h-full p-0 flex flex-col items-center justify-center gap-4px cursor-pointer rounded-lg [font-family:inherit] ' +
  'border border-solid border-control sx-grad-upload hover:(border-violet-line to-#fbf7fd) active:scale-[0.98] ' +
  'transition-[border-color,transform] duration-mid ease-sx motion-reduce:transition-none sx-focus'
</script>

<template>
  <input
    ref="uploadRef"
    type="file"
    :accept="ACCEPT_IMAGE"
    :multiple="multiple"
    id="file-upload"
    @change="handleUpload"
    class="hidden"
  />

  <div v-if="type === 'default'" class="relative" v-loading="loading">
    <div ref="dropRef" :class="[ZONE, dragging && 'sx-drop']">
      <div v-if="limitNumber && topRightTips" :class="LIMIT_TIPS">支持多图(最多{{ limitNumber }}张)</div>

      <!-- 只能传 1 张时：按钮与图片共用一个固定 58px（一张图高）的槽位，上传/删除不改变整体高度，
           图片正好落在按钮原来的位置。否则按钮消失(-72) 与图片出现(+58) 不抵消，会跳 -14。
           槽位内顶部对齐：按钮保持原本 32px 的上边距位置，上下留白 32 / 34 基本对称 -->
      <div class="w-full flex flex-col items-center" :class="singleSlot ? 'mt-32px h-58px' : ''">
        <template v-if="!limitReached">
          <!-- #empty：上传入口；作用域 { open, openAsset, count, limit } -->
          <slot
            name="empty"
            :open="beforeUpload"
            :open-asset="() => openAsset(-1)"
            :count="imgList.length"
            :limit="limitNumber"
          >
            <!-- flex 包一层：按钮作 flex 项，不产生行盒，尺寸与原来直接放按钮时一致 -->
            <div class="relative flex items-center gap-8px" :class="singleSlot ? 'mt-0' : 'mt-32px'">
              <button type="button" :class="UPLOAD_BTN" @click="beforeUpload">
                <i class="icon-ic_ds_CloudUpload1 text-20px" aria-hidden="true"></i>
                <span>{{ triggerLabel }}</span>
              </button>
              <!-- 开了 fromAsset 才有：与上传按钮同一行的文字入口 -->
              <button
                v-if="entryAssetBadge"
                type="button"
                class="sx-btn-ghost !h-40px !px-12px !text-14px text-violet"
                :aria-label="UPLOAD_ENTRY_ASSET_LABEL.image"
                :title="UPLOAD_ENTRY_ASSET_LABEL.tooltip"
                :disabled="loading || isBadgeDisabled(entryAssetBadge, -1)"
                @click.stop="onBadge(entryAssetBadge, -1)"
              >
                {{ UPLOAD_ENTRY_ASSET_LABEL.tooltip }}
              </button>
            </div>
          </slot>
          <p v-if="emptyText && imgList.length === 0" class="m-0 mt-8px text-12px leading-18px text-placeholder">
            {{ emptyText }}
          </p>
        </template>

        <div v-if="exampleImages" class="h-44px mt-8px flex items-center gap-4px text-placeholder">
          <span>示例</span>
          <template v-for="item in exampleImages" :key="item">
            <n-popover trigger="hover">
              <template #trigger>
                <img class="h-44px rounded-sm" :src="item" alt="" />
              </template>
              <img :src="item" alt="" />
            </n-popover>
          </template>
        </div>

        <div
          class="flex flex-wrap items-center justify-center gap-4px"
          :class="singleSlot ? 'mt-0' : 'mt-8px'"
          :style="rowStyle"
        >
          <div
            class="group relative cursor-pointer"
            :style="{ width: `${tileSize}px`, height: `${tileHeight}px` }"
            v-for="(item, i) in imgList"
            :key="item"
          >
            <!-- #tile：已传图片；作用域 { item, index, url, remove, replace, preview } -->
            <slot
              name="tile"
              :item="item"
              :index="i"
              :url="urlOf(item)"
              :remove="() => removeAt(i)"
              :replace="() => openReplace(i)"
              :preview="() => openPreview(i)"
            >
              <n-image
                :width="tileSize"
                :height="tileHeight"
                :src="urlOf(item)"
                object-fit="cover"
                style="border-radius: 8px"
              />

              <button v-if="!hasBadges" type="button" :class="DELETE_BTN" aria-label="删除图片" @click="deleteImg(i)">
                <i class="icon-ic_ds_return-2 text-white text-10px" aria-hidden="true"></i>
              </button>
            </slot>

            <!-- 角标（badgeActions）：原型 .sx-medbtn，位置 / 显隐见 uploadBadges.ts -->
            <button
              v-for="b in badges"
              :key="b.key"
              type="button"
              :class="badgeClass(b)"
              :aria-label="b.label"
              :title="b.tooltip"
              :disabled="isBadgeDisabled(b, i)"
              @click.stop="onBadge(b, i)"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path :d="b.path" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <slot></slot>

      <!-- #footer：上传槽底部条；不传 = 原来的 bottomTips 提示条 -->
      <slot name="footer">
        <div
          v-if="bottomTips"
          class="w-full h-36px mt-auto relative -bottom-16px flex items-center px-12px text-12px bg-warning-soft text-warning"
        >
          请上传清晰且能够尽量展示商品全貌的图片
        </div>
      </slot>
    </div>

    <!-- 试一试：收窄左右内边距（8px）给 7 张试用图腾出宽度 -->
    <div v-if="tryImages" class="mt-12px px-8px h-44px rounded-lg bg-surface3 flex items-center">
      <span class="text-12px text-placeholder pr-4px flex-shrink-0">试一试</span>
      <!-- 按内容收缩而非占满剩余宽度：排不下时压缩到可用宽度并横向滚动；隐藏滚动条，靠滚轮/触控板横滑 -->
      <div
        class="flex-[0_1_auto] min-w-0 h-[90%] flex items-center gap-4px overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <template v-for="item in tryImages" :key="item">
          <n-popover trigger="hover">
            <template #trigger>
              <img
                class="h-full aspect-square rounded-lg object-cover cursor-pointer"
                :src="item"
                alt=""
                @click="tryClick(item)"
              />
            </template>
            <img :src="item" alt="" />
          </n-popover>
        </template>
      </div>
    </div>
  </div>

  <div
    v-else-if="type === 'card'"
    ref="dropRef"
    class="w-full h-full rounded-lg"
    :class="dragging && 'sx-drop-ring'"
    v-loading="loading"
  >
    <slot
      name="empty"
      :open="beforeUpload"
      :open-asset="() => openAsset(-1)"
      :count="imgList.length"
      :limit="limitNumber"
    >
      <div class="relative w-full h-full">
        <button type="button" :class="CARD_TRIGGER" @click="beforeUpload">
          <i class="icon-ic_ds_CloudUpload1 text-20px text-ink-2" aria-hidden="true"></i>
          <span class="text-14px leading-20px text-ink-2">{{ triggerLabel }}</span>
          <span v-if="emptyText && imgList.length === 0" class="text-12px leading-18px text-placeholder">
            {{ emptyText }}
          </span>
        </button>
        <!-- 卡片本身就是一格：云钮放右下角内缩 4（原型 ProductPipeSlots .ptile__icon） -->
        <button
          v-if="entryAssetBadge"
          type="button"
          class="absolute right-8px bottom-8px px-4px text-12px leading-18px text-violet bg-transparent border-none cursor-pointer rounded-sm hover:underline disabled:(opacity-45 cursor-not-allowed) sx-focus"
          :aria-label="UPLOAD_ENTRY_ASSET_LABEL.image"
          :title="UPLOAD_ENTRY_ASSET_LABEL.tooltip"
          :disabled="loading || isBadgeDisabled(entryAssetBadge, -1)"
          @click.stop="onBadge(entryAssetBadge, -1)"
        >
          {{ UPLOAD_ENTRY_ASSET_LABEL.tooltip }}
        </button>
      </div>
    </slot>
  </div>

  <!-- 角标「放大查看」 -->
  <n-modal v-if="hasBadges" v-model:show="previewShow">
    <img :src="previewUrl" alt="" class="block max-w-[80vw] max-h-[80vh] rounded-lg object-contain bg-white" />
  </n-modal>

  <AssetPickerModal v-if="entryAssetBadge" v-model:show="assetShow" :limit="assetLimit" @select="onAssetSelect" />
</template>
