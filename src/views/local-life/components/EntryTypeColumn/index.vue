<script setup lang="ts">
/**
 * 全案设计 · 单个图种列（原型 LocalLifeTypeCard）。
 *
 * 列头圆点 = 勾选本图种；列身 = 每条的设计要求（0/200）+ 设计素材（从品牌档案选图，最多 maxImages 张）
 * + 「添加」（推荐菜只有 1 条）。未勾选的图种列身 40% 灰、不可操作（原型未启用态）；没选档案也能勾选、填写，
 * 点「从档案中选择图片」由父组件提示先选档案并打开档案弹窗。素材满 maxImages 张后选图按钮禁用并提示「每条最多 N 张」。
 * 状态由父组件持有，这里只发事件。尺寸照原型 LocalLifeTypeCard：列 r10、选中描边 violet .3 + 底 violet .025；列头 52 高；列身最高 420 内滚、内边距 12 14 14、gap 12；
 * 条目间 1px 黑 8% 分隔、条目名 12/18·600；设计要求框 73 高、r8、内边距 8 12 24、13/19.5，计数 10/14；素材框 120 高 2px 虚线、内边距 10、gap 5、图标底 36。
 */
import IconButton from '@/components/IconButton/index.vue'
import type { SectionItem } from '../../useFullSet.ts'

const props = defineProps<{
  title: string
  /** 原型 multiItem：推荐菜限 1 条，没有「添加」 */
  multiItem: boolean
  maxImages: number
  maxLength: number
  selected: boolean
  items: SectionItem[]
  /** 生成中等整列只读（与档案无关：没选档案也能勾选、填写） */
  disabled: boolean
}>()

const emit = defineEmits<{
  toggle: []
  add: []
  remove: [index: number]
  content: [index: number, value: string]
  pick: [index: number]
  removeImage: [index: number, url: string]
}>()

const trashIcon = ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12', 'M9 7V4h6v3']
const uploadIcon = ['M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4 4 0 0 1-.5 7.97', 'M12 12v8', 'M9 15l3-3 3 3']
const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet'

function onInput(index: number, event: Event) {
  const value = (event.target as HTMLTextAreaElement).value.slice(0, props.maxLength)
  emit('content', index, value)
}
</script>

<template>
  <article
    :class="[
      'min-w-0 flex flex-col overflow-hidden border border-solid rounded-xl',
      'transition-[border-color,box-shadow] duration-mid ease-sx motion-reduce:transition-none',
      selected
        ? 'border-[rgba(135,95,154,0.3)] bg-[rgba(135,95,154,0.025)] shadow-[0_1px_2px_rgba(31,35,41,0.05)]'
        : 'border-line bg-white hover:(border-violet-line shadow-raised)',
    ]"
  >
    <header
      :class="[
        'h-52px shrink-0 flex items-center justify-between gap-8px px-12px border-b border-b-solid transition-colors duration-mid',
        selected ? 'sx-grad-tint border-b-violet-line' : 'border-b-line-soft',
      ]"
    >
      <span class="truncate sx-title-card">{{ title }}</span>
      <!-- 可点区域 32×32（视觉圆点 20），列头 52 高放得下；触屏外扩到 40 -->
      <button
        type="button"
        role="checkbox"
        :aria-checked="selected"
        :aria-label="`选择${title}`"
        :aria-disabled="disabled || undefined"
        :class="[
          'group/dot relative -mr-6px h-32px w-32px shrink-0 flex items-center justify-center rounded-full border-none bg-transparent p-0',
          '[@media(pointer:coarse)]:after:(content-empty absolute -inset-4px rounded-full)',
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
          focusRing,
        ]"
        @click="!disabled && emit('toggle')"
      >
        <span
          :class="[
            'h-20px w-20px flex items-center justify-center box-border rounded-full border border-solid',
            'transition-[background,border-color] duration-fast ease-sx motion-reduce:transition-none',
            selected
              ? 'sx-grad-primary border-violet-border text-white shadow-btn'
              : 'border-control bg-white group-hover/dot:border-violet',
          ]"
          aria-hidden="true"
        >
          <svg v-if="selected" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3">
            <path d="M5 12l5 5 9-10" />
          </svg>
        </span>
      </button>
    </header>

    <div
      :class="[
        'max-h-420px min-h-0 flex flex-col gap-12px overflow-y-auto px-14px pb-14px pt-12px',
        !selected ? 'pointer-events-none select-none opacity-40' : '',
      ]"
      :aria-hidden="!selected ? 'true' : undefined"
      :inert="disabled || !selected ? true : undefined"
    >
      <div
        v-for="(item, index) in items"
        :key="index"
        class="flex flex-col gap-8px pb-12px border-b border-b-solid border-b-[rgba(31,35,41,0.08)] last-of-type:(pb-0 border-b-0)"
      >
        <span class="min-h-24px flex items-center gap-8px text-12px font-600 leading-18px text-ink">
          {{ title }} {{ index + 1 }}
          <IconButton
            v-if="multiItem && items.length > 1"
            class="ml-auto"
            size="sm"
            variant="danger"
            :label="`删除 ${title} ${index + 1}`"
            @click="emit('remove', index)"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path v-for="d in trashIcon" :key="d" :d="d" />
            </svg>
          </IconButton>
        </span>
        <label class="flex flex-col gap-6px">
          <span class="text-12px font-500 leading-18px text-ink-2">设计要求（选填）</span>
          <span class="relative block">
            <textarea
              :value="item.content"
              :maxlength="maxLength"
              rows="2"
              placeholder="请输入该部分的设计要求..."
              :class="[
                'box-border block h-73px w-full resize-none rounded-lg border border-solid border-control bg-white shadow-inset-input px-12px pb-24px pt-8px text-13px leading-[19.5px] text-ink outline-none [font-family:inherit]',
                'transition-[border-color,box-shadow] duration-fast ease-sx motion-reduce:transition-none',
                'placeholder:text-placeholder hover:border-control-hover focus:(border-violet shadow-focus)',
              ]"
              @input="onInput(index, $event)"
            />
            <em
              class="pointer-events-none absolute bottom-4px right-10px text-10px text-placeholder not-italic leading-14px tabular-nums"
            >
              {{ item.content.length }}/{{ maxLength }}
            </em>
          </span>
        </label>
        <div class="flex flex-col gap-6px">
          <span class="flex items-center gap-4px text-12px font-500 leading-18px text-ink-2">
            设计素材 <em class="text-danger not-italic">*</em>
            <span class="ml-auto text-11px leading-16px text-placeholder tabular-nums"
              >{{ item.images.length }}/{{ maxImages }}</span
            >
          </span>
          <ul v-if="item.images.length" class="m-0 grid grid-cols-4 list-none gap-4px p-0">
            <li
              v-for="(url, imgIndex) in item.images"
              :key="url"
              class="group relative aspect-square rounded-md border border-solid border-line-soft bg-sunken"
            >
              <!-- li 不裁切：移除按钮的 32 命中区（伪元素外扩）不被切掉；圆角放在图上 -->
              <img :src="url" alt="" class="block h-full w-full rounded-[5px] object-cover" loading="lazy" />
              <IconButton
                class="!absolute right-2px top-2px"
                size="sm"
                variant="overlay"
                :label="`移除第 ${imgIndex + 1} 张设计素材`"
                @click="emit('removeImage', index, url)"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </IconButton>
            </li>
          </ul>
          <button
            type="button"
            :aria-disabled="item.images.length >= maxImages || undefined"
            :title="item.images.length >= maxImages ? `每条最多 ${maxImages} 张` : undefined"
            :class="[
              'box-border flex flex-col items-center justify-center gap-5px p-10px rounded-lg border-2 border-dashed border-line-strong sx-grad-upload text-muted [font-family:inherit]',
              'transition-[border-color,background,color] duration-mid ease-sx motion-reduce:transition-none',
              item.images.length >= maxImages
                ? 'cursor-not-allowed opacity-60'
                : 'cursor-pointer hover:(border-violet-line to-#fbf7fd text-violet-ink)',
              item.images.length ? 'h-40px' : 'h-120px',
              focusRing,
            ]"
            :aria-label="
              item.images.length >= maxImages
                ? `${title} ${index + 1}：每条最多 ${maxImages} 张，已选满`
                : `${title} ${index + 1}：点击从档案中选择图片，最多 ${maxImages} 张`
            "
            @click="item.images.length < maxImages && emit('pick', index)"
          >
            <span
              v-if="!item.images.length"
              class="h-36px w-36px flex items-center justify-center box-border rounded-full border border-solid border-line bg-white text-violet-ink"
            >
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path v-for="d in uploadIcon" :key="d" :d="d" />
              </svg>
            </span>
            <b class="text-12px font-500 leading-18px">{{
              item.images.length >= maxImages ? `每条最多 ${maxImages} 张` : '点击从档案中选择图片'
            }}</b>
            <small v-if="!item.images.length" class="text-11px leading-16px text-placeholder"
              >最多 {{ maxImages }} 张</small
            >
          </button>
        </div>
      </div>

      <button
        v-if="multiItem"
        type="button"
        :class="[
          'h-40px shrink-0 flex cursor-pointer items-center justify-center gap-4px rounded-lg border-2 border-dashed border-line-strong bg-transparent text-12px text-muted [font-family:inherit]',
          'transition-[border-color,background,color] duration-mid ease-sx motion-reduce:transition-none',
          'hover:(border-violet-line bg-violet-tint text-violet-ink)',
          focusRing,
        ]"
        @click="emit('add')"
      >
        ＋ 添加{{ title }}
      </button>
    </div>
  </article>
</template>
