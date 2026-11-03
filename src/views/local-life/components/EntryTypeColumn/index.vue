<script setup lang="ts">
/**
 * 全案设计 · 单个图种列（原型 LocalLifeTypeCard）。
 *
 * 列头圆点 = 勾选本图种；列身 = 每条的设计要求（0/200）+ 设计素材（从品牌档案选图，最多 maxImages 张）
 * + 「添加」（推荐菜只有 1 条）。未选档案时整列 40% 灰、不可操作（原型未启用态）。
 * 状态由父组件持有，这里只发事件。尺寸照原型：列头 52 高、列身最高 420 内滚、素材框 120 高 2px 虚线。
 */
import type { SectionItem } from '../../useFullSet.ts'

const props = defineProps<{
  title: string
  /** 原型 multiItem：推荐菜限 1 条，没有「添加」 */
  multiItem: boolean
  maxImages: number
  maxLength: number
  selected: boolean
  items: SectionItem[]
  /** 未选品牌档案：未启用态 */
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
      'min-w-0 flex flex-col overflow-hidden border rounded-10px bg-white transition-colors',
      selected && !disabled ? 'border-violet-line' : 'border-line',
    ]"
  >
    <header class="h-52px shrink-0 flex items-center justify-between gap-8px px-12px">
      <span class="truncate text-14px font-600 leading-20px text-ink">{{ title }}</span>
      <button
        type="button"
        role="checkbox"
        :aria-checked="selected"
        :aria-label="`选择${title}`"
        :disabled="disabled"
        :class="[
          'h-20px w-20px shrink-0 flex items-center justify-center rounded-full border p-0 transition-colors',
          disabled ? 'cursor-not-allowed border-ink/20 bg-white' : 'cursor-pointer',
          selected && !disabled ? 'border-violet bg-violet text-white' : 'border-ink/20 bg-white',
          focusRing,
        ]"
        @click="emit('toggle')"
      >
        <svg
          v-if="selected && !disabled"
          viewBox="0 0 24 24"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          stroke-width="3"
        >
          <path d="M5 12l5 5 9-10" />
        </svg>
      </button>
    </header>

    <div
      :class="[
        'max-h-420px min-h-0 flex flex-col gap-12px overflow-y-auto px-14px pb-14px pt-12px',
        disabled || !selected ? 'pointer-events-none select-none opacity-40' : '',
      ]"
      :aria-hidden="disabled || !selected ? 'true' : undefined"
      :inert="disabled || !selected ? true : undefined"
    >
      <div v-for="(item, index) in items" :key="index" class="flex flex-col gap-8px">
        <span class="flex items-center gap-6px text-12px font-500 leading-18px text-ink/58">
          {{ title }} {{ index + 1 }}
          <button
            v-if="multiItem && items.length > 1"
            type="button"
            :class="[
              'ml-auto cursor-pointer border-none bg-transparent p-0 text-11px text-ink/45 hover:text-danger',
              focusRing,
            ]"
            :aria-label="`删除${title} ${index + 1}`"
            @click="emit('remove', index)"
          >
            删除
          </button>
        </span>
        <label class="flex flex-col gap-6px">
          <span class="text-12px font-500 leading-18px text-ink/58">设计要求（选填）</span>
          <span class="relative block">
            <textarea
              :value="item.content"
              :maxlength="maxLength"
              rows="2"
              placeholder="请输入该部分的设计要求..."
              :class="[
                'box-border block h-73px w-full resize-none border border-ink/8 rounded-8px bg-ink/4 px-12px pb-24px pt-8px text-13px leading-19.5px text-ink outline-none',
                'placeholder:text-ink/30 focus:(border-violet-line bg-white)',
              ]"
              @input="onInput(index, $event)"
            />
            <em
              class="pointer-events-none absolute bottom-4px right-10px text-10px text-ink/28 not-italic leading-14px"
            >
              {{ item.content.length }}/{{ maxLength }}
            </em>
          </span>
        </label>
        <div class="flex flex-col gap-6px">
          <span class="flex items-center gap-4px text-12px font-500 leading-18px text-ink/58">
            设计素材 <em class="text-danger not-italic">*</em>
            <span class="ml-auto text-11px text-ink/40">{{ item.images.length }}/{{ maxImages }}</span>
          </span>
          <ul v-if="item.images.length" class="m-0 grid grid-cols-4 list-none gap-4px p-0">
            <li
              v-for="url in item.images"
              :key="url"
              class="group relative aspect-square overflow-hidden rounded-6px bg-sunken"
            >
              <img :src="url" alt="" class="h-full w-full object-cover" loading="lazy" />
              <button
                type="button"
                :class="[
                  'absolute right-2px top-2px h-16px w-16px flex cursor-pointer items-center justify-center rounded-full border-none bg-ink/60 p-0 text-10px text-white leading-none',
                  focusRing,
                ]"
                :aria-label="`移除设计素材`"
                @click="emit('removeImage', index, url)"
              >
                ×
              </button>
            </li>
          </ul>
          <button
            type="button"
            :class="[
              'flex cursor-pointer flex-col items-center justify-center gap-4px border-2 border-ink/12 rounded-8px border-dashed bg-ink/2 text-ink/55 transition-colors',
              'hover:(border-violet/45 bg-violet/5 text-violet-ink)',
              item.images.length ? 'h-40px' : 'h-120px',
              focusRing,
            ]"
            :aria-label="`${title} ${index + 1}：点击从档案中选择图片，最多 ${maxImages} 张`"
            @click="emit('pick', index)"
          >
            <span
              v-if="!item.images.length"
              class="h-32px w-32px flex items-center justify-center rounded-full bg-ink/6"
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
            <b class="text-12px font-500">点击从档案中选择图片</b>
            <small v-if="!item.images.length" class="text-11px text-ink/40">最多 {{ maxImages }} 张</small>
          </button>
        </div>
      </div>

      <button
        v-if="multiItem"
        type="button"
        :class="[
          'h-40px shrink-0 flex cursor-pointer items-center justify-center gap-4px border-2 border-ink/12 rounded-8px border-dashed bg-transparent text-12px text-ink/55',
          'hover:(border-violet/45 bg-violet/5 text-violet-ink)',
          focusRing,
        ]"
        @click="emit('add')"
      >
        + 添加{{ title }}
      </button>
    </div>
  </article>
</template>
