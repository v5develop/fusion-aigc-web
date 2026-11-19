<script setup lang="ts">
/**
 * 资产详情 · 右栏头部（不随正文滚动）：标题（悬停出铅笔 / 点标题即改，回车保存、Esc 取消）、说明行、
 * 收藏星标、关闭；下面紧跟主操作行：「下载」（主色；调过色时右侧小箭头选 校色后 / 原图，主体下载屏幕上看到的那张）、
 * 「用于画布」、「⋯」（复制提示词、删除——删除的二次确认由列表页弹出）。
 */
import { NDropdown, NInput } from 'naive-ui'
import IconButton from '@/components/IconButton/index.vue'
import SaveJpgButton from '@/components/SaveJpgButton/index.vue'
import { downloadName } from '../../ui.ts'
import { useAssetDetail } from './context.ts'

const d = useAssetDetail()

const BTN = '!h-40px !text-13px !px-14px !rounded-14px min-w-0 justify-center'

function onTitleKey(e: KeyboardEvent) {
  if (e.key === 'Enter') void d.saveTitle()
  else if (e.key === 'Escape') {
    // 只取消编辑，不关弹层
    e.stopPropagation()
    d.editingTitle.value = false
  }
}
function onPlainDownload() {
  d.message.success('已开始下载')
}
</script>

<template>
  <header v-if="d.asset.value" class="shrink-0 px-20px pt-18px pb-14px bg-white">
    <div class="flex items-start gap-8px">
      <div class="flex-1 min-w-0">
        <div v-if="d.editingTitle.value" class="flex items-center gap-8px">
          <n-input
            v-model:value="d.titleDraft.value"
            class="flex-1"
            maxlength="100"
            show-count
            placeholder="1-100 字"
            autofocus
            @keydown="onTitleKey"
          />
          <button type="button" class="sx-btn-primary !h-34px" :disabled="d.saving.value" @click="d.saveTitle">保存</button>
          <button type="button" class="sx-btn-ghost !h-34px" @click="d.editingTitle.value = false">取消</button>
        </div>
        <div v-else class="group flex items-start gap-4px min-w-0">
          <h2
            class="m-0 min-w-0 text-18px leading-26px font-600 text-ink break-all line-clamp-2 cursor-text rounded-6px hover:bg-surface2"
            :title="`${d.asset.value.title || '未命名资产'}（点击改名）`"
            @click="d.startEditTitle"
          >
            {{ d.asset.value.title || '未命名资产' }}
          </h2>
          <IconButton label="重命名" size="sm" variant="quiet" reveal class="mt-1px" @click="d.startEditTitle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" />
            </svg>
          </IconButton>
        </div>
        <p class="m-0 mt-4px text-12px leading-18px text-muted truncate">{{ d.metaLine.value }}</p>
      </div>
      <div class="flex items-center gap-8px shrink-0">
        <IconButton
          :label="d.asset.value.favorite ? '取消收藏' : '收藏'"
          variant="quiet"
          :pressed="d.asset.value.favorite"
          :disabled="d.saving.value"
          @click="d.toggleFavorite"
        >
          <svg viewBox="0 0 24 24" :fill="d.asset.value.favorite ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">
            <path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />
          </svg>
        </IconButton>
        <!-- 关闭钮在 DetailModal 里统一放在弹层右上角（窄屏压在舞台上），这里留位 -->
        <span class="asset-close-slot w-32px" aria-hidden="true" />
      </div>
    </div>

    <!-- 主操作：下载 / 用于画布 / 更多 -->
    <div class="flex items-center gap-8px mt-14px">
      <template v-if="d.downloadHref.value">
        <div v-if="d.cf.active.value" class="flex-[1.7] min-w-0 flex">
          <button
            type="button"
            :class="[BTN, 'sx-soft-btn sx-soft-btn-primary flex-1 !rounded-r-0']"
            :title="d.showFixed.value ? '下载校色后的图片（PNG）' : '下载原图'"
            @click="d.downloadCurrent"
          >
            <svg class="w-15px h-15px flex-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" />
            </svg>
            <span class="truncate">{{ d.showFixed.value ? '下载校色后' : '下载原图' }}</span>
          </button>
          <NDropdown trigger="click" placement="bottom-end" :options="d.downloadMenu.value" @select="d.onDownloadMenu">
            <button
              type="button"
              :class="['sx-soft-btn sx-soft-btn-primary !h-40px !w-36px !px-0 shrink-0 !rounded-r-14px !rounded-l-0 border-l border-l-solid !border-l-white/30']"
              aria-label="选择下载校色后或原图"
              title="选择下载校色后或原图"
            >
              <svg class="w-14px h-14px flex-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </NDropdown>
        </div>
        <a
          v-else
          :class="[BTN, 'sx-soft-btn sx-soft-btn-primary flex-[1.25] no-underline']"
          :href="d.downloadHref.value"
          :download="downloadName(d.asset.value.title, d.asset.value.media === 'video')"
          target="_blank"
          rel="noopener noreferrer"
          @click="onPlainDownload"
        >
          <svg class="w-15px h-15px flex-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" />
          </svg>
          <span class="truncate">下载</span>
        </a>
        <button
          type="button"
          :class="[BTN, 'sx-soft-btn flex-1 !text-ink-2']"
          :disabled="d.openingCanvas.value"
          :aria-busy="d.openingCanvas.value || undefined"
          title="新建一张画布，把这个素材放进去继续创作"
          @click="d.openInCanvas"
        >
          <svg class="w-15px h-15px flex-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /><path d="M10.5 7H15a2 2 0 0 1 2 2v4.5" />
          </svg>
          <span class="truncate">{{ d.openingCanvas.value ? '正在创建…' : '用于画布' }}</span>
        </button>
      </template>
      <SaveJpgButton
        v-if="d.downloadHref.value && d.asset.value?.media !== 'video'"
        :url="d.downloadHref.value"
        :name="d.asset.value?.title"
        size="lg"
      />
      <NDropdown v-if="d.moreMenu.value.length" trigger="click" placement="bottom-end" :options="d.moreMenu.value" @select="d.onMoreMenu">
        <IconButton label="更多操作" size="lg">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
          </svg>
        </IconButton>
      </NDropdown>
    </div>
  </header>
</template>

<style scoped>
@media (max-width: 900px) {
  /* 窄屏关闭钮在舞台上，头部不用留位 */
  .asset-close-slot {
    display: none;
  }
}
</style>
