<script setup lang="ts">
/**
 * 资产媒体卡：封面（image 直显 / video 用 video_url + image 封面）、标题、标签小徽标、
 * 收藏星标（父级 PATCH 即点即存）、悬浮多选框；点卡片开详情。
 */
import { computed, ref } from "vue";
import { NCheckbox } from "naive-ui";
import MediaFallback from "@/components/MediaFallback/index.vue";
import type { IAssetLibAsset } from "@/api/assetLibrary.ts";

const props = defineProps<{
  asset: IAssetLibAsset;
  checked: boolean;
}>();

const emit = defineEmits<{
  "toggle-select": [id: number];
  "toggle-favorite": [asset: IAssetLibAsset];
  open: [asset: IAssetLibAsset];
  "filter-tag": [name: string];
}>();

const isVideo = computed(() => props.asset.media === "video" && !!props.asset.video_url);

// 封面加载失败降级：video 播不了先退回封面图，图也裂了才上占位
const videoFailed = ref(false);
const imageFailed = ref(false);
</script>

<template>
  <div
    class="group bg-white border border-solid rounded-10px overflow-hidden cursor-pointer transition-[border-color,box-shadow] duration-200 hover:shadow-[0_4px_12px_0_rgba(31,35,41,0.1)]"
    :class="checked ? 'border-violet shadow-[0_0_0_2px_rgba(135,95,154,0.18)]' : 'border-line'"
    @click="emit('open', asset)"
  >
    <div class="relative aspect-square bg-sunken">
      <video
        v-if="isVideo && !videoFailed"
        :src="asset.video_url"
        :poster="asset.image || undefined"
        class="block w-full h-full object-cover"
        muted
        preload="metadata"
        @error="videoFailed = true"
      />
      <img
        v-else-if="asset.image && !imageFailed"
        class="block w-full h-full object-cover"
        :src="asset.image"
        alt=""
        loading="lazy"
        @error="imageFailed = true"
      />
      <MediaFallback v-else type="image" reason="loadFailed" />

      <span
        v-if="asset.media === 'video'"
        class="absolute left-8px bottom-8px px-6px py-2px rounded-4px bg-[rgba(31,35,41,0.6)] text-white text-11px leading-[1.4]"
        >视频</span
      >

      <div
        class="absolute top-8px left-8px leading-none transition-opacity duration-150 group-hover:opacity-100"
        :class="checked ? 'opacity-100' : 'opacity-0'"
        @click.stop
      >
        <n-checkbox
          :checked="checked"
          size="small"
          @update:checked="emit('toggle-select', asset.id)"
        />
      </div>

      <span
        class="absolute top-6px right-8px text-18px leading-[1.2]"
        :class="
          asset.favorite
            ? 'text-violet [text-shadow:0_1px_2px_rgba(255,255,255,0.6)]'
            : 'text-white [text-shadow:0_1px_2px_rgba(31,35,41,0.4)]'
        "
        :title="asset.favorite ? '取消收藏' : '收藏'"
        @click.stop="emit('toggle-favorite', asset)"
      >
        {{ asset.favorite ? "★" : "☆" }}
      </span>
    </div>

    <div class="pt-8px px-10px pb-10px">
      <div
        class="text-13px text-ink whitespace-nowrap overflow-hidden text-ellipsis mb-6px"
        :title="asset.title"
      >
        {{ asset.title || "未命名资产" }}
      </div>
      <div v-if="asset.tags.length" class="flex flex-wrap gap-4px">
        <span
          v-for="t in asset.tags.slice(0, 3)"
          :key="t"
          class="bg-surface3 text-ink-2 text-11px leading-[1.4] px-6px py-1px rounded-4px max-w-full whitespace-nowrap overflow-hidden text-ellipsis cursor-pointer hover:(text-violet-ink bg-violet-soft)"
          :title="`按标签「${t}」筛选`"
          @click.stop="emit('filter-tag', t)"
          >{{ t }}</span
        >
        <span
          v-if="asset.tags.length > 3"
          class="bg-surface3 text-placeholder text-11px leading-[1.4] px-6px py-1px rounded-4px max-w-full whitespace-nowrap overflow-hidden text-ellipsis cursor-default"
          >+{{ asset.tags.length - 3 }}</span
        >
      </div>
    </div>
  </div>
</template>
