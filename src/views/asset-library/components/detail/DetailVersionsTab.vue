<script setup lang="ts">
/**
 * 资产详情 ·「版本」页签：原图 + 各版本（缩略图、版本号、校色标记、模型与时间、说明），当前那条高亮；
 * 「设为当前」= 图片底部版本胶囊同一动作。「追加版本」沿用原流程：选文件 / 拖入 / 粘贴（Go 直传）或从资产库选，
 * 选填说明与模型，提交后自动设为当前。
 */
import { ref } from 'vue'
import { NInput, NSelect } from 'naive-ui'
import AssetPickerModal from '@/views/studio/components/AssetPickerModal/index.vue'
import PageEmpty from '@/components/PageEmpty/index.vue'
import { useFileDropPaste } from '@/composables/useFileDropPaste'
import { modelLabelOf } from '@/utils/model-label'
import { formatTime } from '@/views/local-life/constants.ts'
import { isColorFixVersion, useAssetDetail, VERSION_MODEL_OPTIONS } from './context.ts'

const d = useAssetDetail()

const fileRef = ref<HTMLInputElement | null>(null)
const dropRef = ref<HTMLElement | null>(null)

function pickFile() {
  if (!d.versionUploading.value) fileRef.value?.click()
}
async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) await d.uploadVersionFile(file)
}
const { dragging } = useFileDropPaste(dropRef, {
  accept: 'image',
  disabled: d.versionUploading,
  onFiles: ([file]) => {
    if (file) void d.uploadVersionFile(file)
  },
})

const ROW =
  'flex items-center gap-12px p-8px pr-10px rounded-14px border border-solid transition-colors duration-fast'
const ROW_ON = 'border-violet-line bg-violet-soft'
const ROW_OFF = 'border-line bg-white hover:border-line-strong'
const CURRENT_CHIP = 'inline-flex items-center h-22px px-8px rounded-11px text-11px font-600 bg-violet-solid text-white'
const SET_BTN = 'sx-btn !h-32px !px-10px !text-12px shrink-0'
</script>

<template>
  <div v-if="d.asset.value" class="flex flex-col gap-12px">
    <div class="flex items-center gap-8px">
      <p class="m-0 flex-1 text-12px leading-18px text-muted">原图和每次修改都会保留，随时可以切回。</p>
      <button
        type="button"
        class="shrink-0"
        :class="d.addingVersion.value ? 'sx-btn-ghost' : 'sx-btn-tint'"
        :aria-expanded="d.addingVersion.value"
        @click="d.addingVersion.value = !d.addingVersion.value"
      >
        {{ d.addingVersion.value ? '收起' : '+ 追加版本' }}
      </button>
    </div>

    <!-- 追加版本：Go presign 直传（资产库只认 Go 签发地址） -->
    <div v-if="d.addingVersion.value" class="flex flex-col gap-10px p-12px rounded-14px bg-surface2 border border-solid border-line-soft">
      <div
        v-if="!d.versionImage.value.length"
        ref="dropRef"
        class="relative flex flex-col items-center gap-4px py-18px rounded-12px border border-dashed border-line-strong bg-white text-12px text-muted hover:(border-violet text-violet-ink) has-[:focus-visible]:(outline outline-2 outline-solid outline-violet outline-offset-2)"
        :class="[d.versionUploading.value ? 'opacity-60 cursor-wait' : 'cursor-pointer', dragging && 'sx-drop']"
        @click="pickFile"
      >
        <input ref="fileRef" type="file" accept="image/*" class="absolute inset-0 opacity-0 cursor-pointer" aria-label="上传新版本图片" @change="onFile" />
        <svg class="w-22px h-22px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 16V5m0 0-4 4m4-4 4 4M5 19h14" />
        </svg>
        <span class="text-13px text-ink-2">{{ d.versionUploading.value ? '上传中…' : '点击上传，或拖拽 / 粘贴（Ctrl/⌘+V）图片' }}</span>
        <span class="text-11px text-placeholder">单张 ≤10M</span>
        <button
          type="button"
          class="relative z-1 mt-4px h-28px px-10px rounded-14px border border-solid border-violet-line bg-violet-soft text-12px text-violet-ink cursor-pointer hover:bg-violet-soft-2 disabled:(opacity-45 cursor-not-allowed) sx-focus"
          :disabled="d.versionUploading.value"
          @click.stop="d.openVersionAssets"
        >
          从资产库选
        </button>
      </div>
      <div v-else class="relative self-start">
        <img class="block max-w-140px max-h-140px rounded-10px border border-solid border-line" :src="d.versionImage.value[0]" alt="新版本预览" />
        <button
          type="button"
          class="absolute top-6px right-6px h-26px px-8px rounded-13px border-none bg-[rgba(31,35,41,0.6)] text-11px text-white cursor-pointer sx-focus"
          @click="d.versionImage.value = []"
        >
          换一张
        </button>
      </div>
      <n-input v-model:value="d.versionPrompt.value" type="textarea" :rows="2" placeholder="版本说明 / 提示词（选填）" />
      <div class="flex items-center gap-8px">
        <n-select
          v-model:value="d.versionModel.value"
          class="flex-1 min-w-0"
          :options="VERSION_MODEL_OPTIONS"
          placeholder="生成模型（选填）"
          size="small"
          clearable
        />
        <button
          type="button"
          class="sx-btn-primary shrink-0"
          :disabled="d.versionUploading.value || !d.versionImage.value.length"
          :title="d.versionImage.value.length ? '' : '先上传或选一张图片'"
          @click="d.submitVersion"
        >
          {{ d.versionUploading.value ? '处理中…' : '添加为新版本' }}
        </button>
      </div>
    </div>
    <AssetPickerModal v-model:show="d.versionAssetShow.value" :limit="1" @select="d.onVersionAssets" />

    <!-- 原图 -->
    <div :class="[ROW, !d.asset.value.currentVersionId ? ROW_ON : ROW_OFF]">
      <div class="w-56px h-56px shrink-0 rounded-10px overflow-hidden bg-sunken grid place-items-center text-12px text-muted">
        <img
          v-if="!d.asset.value.currentVersionId && d.asset.value.image"
          class="w-full h-full object-cover"
          :src="d.asset.value.image"
          alt=""
          loading="lazy"
        />
        <span v-else>原图</span>
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-8px">
          <span class="text-13px font-600 text-ink">原图</span>
          <span v-if="!d.asset.value.currentVersionId" :class="CURRENT_CHIP">当前</span>
        </div>
        <div class="mt-2px text-12px text-muted">最初入库的那一张</div>
      </div>
      <button v-if="d.asset.value.currentVersionId" type="button" :class="SET_BTN" :disabled="d.saving.value" @click="d.setCurrentVersion(0)">
        切回原图
      </button>
    </div>

    <div
      v-for="v in d.versions.value.items"
      :key="v.id"
      :class="[ROW, v.id === d.asset.value.currentVersionId ? ROW_ON : ROW_OFF]"
    >
      <img
        v-if="v.image && !d.versionThumbFailed.value[v.id]"
        class="w-56px h-56px shrink-0 object-cover rounded-10px bg-sunken"
        :src="v.image"
        alt=""
        loading="lazy"
        @error="d.versionThumbFailed.value[v.id] = true"
      />
      <div v-else class="w-56px h-56px shrink-0 rounded-10px bg-sunken grid place-items-center text-11px text-placeholder">无图</div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-6px flex-wrap">
          <span class="text-13px font-600 text-ink">版本 {{ v.versionNo }}</span>
          <span v-if="v.id === d.asset.value.currentVersionId" :class="CURRENT_CHIP">当前</span>
          <span
            v-if="isColorFixVersion(v.params)"
            class="inline-flex items-center h-22px px-8px rounded-11px text-11px bg-white text-violet-ink border border-solid border-violet-line"
          >校色</span>
        </div>
        <div class="mt-2px text-11px text-muted truncate">
          {{ modelLabelOf(v.model) || '未记录模型' }} · {{ formatTime(v.createdAt) }}
        </div>
        <div v-if="v.prompt && !isColorFixVersion(v.params)" class="mt-2px text-12px text-ink-2 line-clamp-1" :title="v.prompt">
          {{ v.prompt }}
        </div>
      </div>
      <button
        v-if="v.id !== d.asset.value.currentVersionId"
        type="button"
        :class="SET_BTN"
        :disabled="d.saving.value"
        @click="d.setCurrentVersion(v.id)"
      >
        设为当前
      </button>
    </div>

    <PageEmpty
      v-if="!d.versions.value.items.length && !d.addingVersion.value"
      compact
      text="还没有其他版本"
      :description="d.isImage.value ? '调色后「保存为新版本」，或上传一张修改后的图，都会出现在这里。' : '上传一张新封面或修改后的文件，会出现在这里。'"
    />

    <button
      v-if="d.hasMoreVersions.value"
      type="button"
      class="sx-btn-ghost self-center"
      :disabled="d.loadingVersions.value"
      @click="d.loadMoreVersions"
    >
      {{ d.loadingVersions.value ? '加载中…' : `加载更多（还有 ${d.versions.value.total - d.versions.value.items.length} 个）` }}
    </button>
  </div>
</template>
