<script setup lang="ts">
/**
 * 资产详情 ·「相关」页签：相关资产（参考关系 + 生成来源；可按编号手动关联、悬停 / 触屏常显 × 解除）
 * 与「由它生成」两组缩略图网格，各自加载更多。点缩略图就地换成那个资产。
 */
import IconButton from '@/components/IconButton/index.vue'
import PageEmpty from '@/components/PageEmpty/index.vue'
import { NInput } from 'naive-ui'
import { useAssetDetail } from './context.ts'

const d = useAssetDetail()

function open(id: number) {
  d.assetId.value = id
}

const GRID = 'grid grid-cols-3 gap-10px'
const TILE = 'group relative min-w-0 text-left p-0 border-none bg-transparent cursor-pointer rounded-12px sx-focus'
const THUMB = 'block w-full aspect-square object-cover rounded-12px bg-sunken border border-solid border-line-soft transition-[border-color] duration-fast group-hover:border-violet-line'
const CAP = 'block mt-6px text-12px leading-16px text-ink-2 truncate group-hover:text-violet-ink'
const H3 = 'm-0 text-13px font-600 text-ink'
</script>

<template>
  <div v-if="d.asset.value" class="flex flex-col gap-22px">
    <section class="flex flex-col gap-10px">
      <div class="flex items-center gap-8px">
        <h3 :class="H3">相关资产</h3>
        <span class="text-12px text-placeholder tabular-nums">{{ d.related.value.total }}</span>
        <button
          type="button"
          class="ml-auto"
          :class="d.addingRelation.value ? 'sx-btn-ghost' : 'sx-btn-tint'"
          :aria-expanded="d.addingRelation.value"
          @click="d.addingRelation.value = !d.addingRelation.value"
        >
          {{ d.addingRelation.value ? '收起' : '+ 添加关联' }}
        </button>
      </div>
      <div v-if="d.addingRelation.value" class="flex items-center gap-8px p-10px rounded-12px bg-surface2 border border-solid border-line-soft">
        <n-input
          v-model:value="d.relationIdDraft.value"
          class="flex-1"
          size="small"
          autofocus
          placeholder="输入对方资产编号（数字）"
          @keydown.enter="d.submitRelation"
        />
        <button type="button" class="sx-btn-primary shrink-0" :disabled="d.relationBusy.value" @click="d.submitRelation">建立关联</button>
      </div>
      <div v-if="d.related.value.items.length" :class="GRID">
        <div v-for="r in d.related.value.items" :key="r.id" class="relative min-w-0 group">
          <button type="button" :class="TILE" class="w-full" :title="r.title || '未命名资产'" @click="open(r.id)">
            <img v-if="r.image && !d.miniThumbFailed.value[r.id]" :class="THUMB" :src="r.image" alt="" loading="lazy" @error="d.miniThumbFailed.value[r.id] = true" />
            <span v-else :class="THUMB" class="grid place-items-center text-11px text-placeholder">无图</span>
            <span :class="CAP">{{ r.title || '未命名资产' }}</span>
          </button>
          <IconButton
            label="解除关联"
            variant="overlay"
            size="sm"
            reveal
            class="!absolute top-6px right-6px"
            :disabled="d.relationBusy.value"
            @click.stop="d.removeRelation(r.id)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </IconButton>
        </div>
      </div>
      <PageEmpty
        v-else-if="!d.addingRelation.value"
        compact
        text="还没有相关资产"
        description="用它当参考生成的图、或你手动关联的资产会出现在这里。"
      />
      <button
        v-if="d.hasMoreRelated.value"
        type="button"
        class="sx-btn-ghost self-center"
        :disabled="d.loadingRelated.value"
        @click="d.loadMoreRelated"
      >
        {{ d.loadingRelated.value ? '加载中…' : '加载更多' }}
      </button>
    </section>

    <section class="flex flex-col gap-10px border-t border-t-solid border-line-soft pt-16px">
      <div class="flex items-center gap-8px">
        <h3 :class="H3">由它生成</h3>
        <span class="text-12px text-placeholder tabular-nums">{{ d.generatedResults.value.total }}</span>
      </div>
      <div v-if="d.generatedResults.value.items.length" :class="GRID">
        <button
          v-for="r in d.generatedResults.value.items"
          :key="r.id"
          type="button"
          :class="TILE"
          :title="r.title || '未命名资产'"
          @click="open(r.id)"
        >
          <img v-if="r.image && !d.miniThumbFailed.value[r.id]" :class="THUMB" :src="r.image" alt="" loading="lazy" @error="d.miniThumbFailed.value[r.id] = true" />
          <span v-else :class="THUMB" class="grid place-items-center text-11px text-placeholder">无图</span>
          <span :class="CAP">{{ r.title || '未命名资产' }}</span>
        </button>
      </div>
      <p v-else class="m-0 text-12px leading-18px text-placeholder">
        还没有用它生成的资产。点上方「用于画布」，以它为素材开始创作。
      </p>
      <button
        v-if="d.hasMoreResults.value"
        type="button"
        class="sx-btn-ghost self-center"
        :disabled="d.loadingResults.value"
        @click="d.loadMoreResults"
      >
        {{ d.loadingResults.value ? '加载中…' : '加载更多' }}
      </button>
    </section>
  </div>
</template>
