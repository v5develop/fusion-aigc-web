<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useEcTabsStore } from '@/stores/e-commerce/tabs'
import type { EcEntry } from '../entries'

const { data, title } = defineProps<{ data: EcEntry[]; title: string }>()

const router = useRouter()
const tabsStore = useEcTabsStore()

// 点卡片总是新开一个标签：每次发一个新实例 id 带进 URL，同类目因此可以并存多个。
// 标签本身仍由 layout 的路由监听建出来，这里只负责发号
function goChildPages(item: EcEntry) {
  router.push({ name: item.pathName, query: { tab: tabsStore.nextTabId() } })
}

/** 封面加载失败：藏掉 img，露出 bg-surface2 底 */
function onImgError(e: Event) {
  ;(e.target as HTMLImageElement).style.visibility = 'hidden'
}
</script>

<template>
  <!-- 入口卡片与 image/LandingPage.vue 同一套材质：r18 squircle、1px line 描边、0 10px 16px 轻影，
       hover 换 violet-line + 浅紫渐变 + 标题 violet-ink + 箭头淡入；封面 16:9，hover 放大 1.05 -->
  <section :aria-label="title" class="flex flex-col gap-12px [@media(max-height:880px)]:gap-8px">
    <header class="flex items-baseline gap-8px px-2px">
      <h2 class="m-0 text-15px font-600 leading-22px text-ink">{{ title }}</h2>
      <span class="text-12px text-muted tabular-nums" :aria-label="`共 ${data.length} 个`">{{ data.length }}</span>
    </header>

    <div class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-12px [@media(max-height:880px)]:gap-8px">
      <button
        v-for="item in data"
        :key="item.pathName"
        type="button"
        class="group relative flex flex-col p-0 overflow-hidden text-left box-border rounded-18px border border-solid border-line bg-white cursor-pointer sx-squircle shadow-[0_10px_16px_rgba(0,0,0,0.04)] transition-[border-color,background,box-shadow] duration-110 motion-reduce:transition-none hover:border-violet-line hover:bg-[linear-gradient(180deg,#fff_0%,#f8f3fc_100%)] hover:shadow-[0_1px_2px_rgba(31,35,41,0.05)] active:shadow-[inset_0_1px_2px_rgba(31,35,41,0.1)] outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-violet focus-visible:outline-offset-2"
        @click="goChildPages(item)"
      >
        <span class="block w-full aspect-[16/9] overflow-hidden bg-surface2" aria-hidden="true">
          <img
            class="block w-full h-full object-cover transition-transform duration-200 ease-out motion-reduce:transition-none group-hover:scale-[1.05]"
            :src="item.url"
            alt=""
            loading="lazy"
            @error="onImgError"
          />
        </span>
        <span class="flex items-center gap-8px p-12px">
          <span class="min-w-0 flex-1 flex flex-col gap-2px">
            <span
              class="truncate text-14px font-600 leading-20px text-ink transition-colors duration-110 motion-reduce:transition-none group-hover:text-violet-ink"
              >{{ item.title }}</span
            >
            <span class="truncate text-11px leading-17px text-muted">{{ item.desc }}</span>
          </span>
          <svg
            viewBox="0 0 24 24"
            width="13"
            height="13"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            class="shrink-0 text-placeholder opacity-0 transition-opacity duration-110 group-hover:opacity-100 group-hover:text-violet-ink group-focus-visible:opacity-100 group-focus-visible:text-violet-ink motion-reduce:transition-none"
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
        </span>
      </button>
    </div>
  </section>
</template>
