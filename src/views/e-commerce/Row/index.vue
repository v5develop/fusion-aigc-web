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
</script>

<template>
  <!-- 入口卡片对齐原型工具箱首页（规范 §6）：网格 minmax(240px,1fr) gap 12；卡片 r8、line 描边，
       hover 上抬 2px + 8% 投影 -->
  <section :aria-label="title">
    <h2 class="m-0 mb-12px sx-title-section">{{ title }}</h2>

    <div class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-12px">
      <button
        v-for="item in data"
        :key="item.pathName"
        type="button"
        class="flex flex-col p-0 overflow-hidden text-left rounded-lg border border-solid border-line bg-white cursor-pointer transition-[transform,box-shadow,border-color] duration-mid ease-sx motion-reduce:transition-none hover:(-translate-y-2px border-control shadow-[0_4px_16px_rgba(31,35,41,0.08)]) motion-reduce:hover:translate-y-0 sx-focus"
        @click="goChildPages(item)"
      >
        <img class="block w-full aspect-[97/52] object-cover" :src="item.url" alt="" />
        <span class="flex flex-col gap-4px p-12px">
          <span class="text-14px font-600 leading-20px text-ink">{{ item.title }}</span>
          <span class="text-11px leading-17px text-muted">{{ item.desc }}</span>
        </span>
      </button>
    </div>
  </section>
</template>
