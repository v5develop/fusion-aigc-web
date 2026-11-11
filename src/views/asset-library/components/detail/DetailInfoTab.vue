<script setup lang="ts">
/**
 * 资产详情 ·「详情」页签：提示词卡（复制；没有时只给一行灰字）、标签（chip + 行内「+ 标签」，
 * 与改版前同一套：输入回车新建、点「我的标签」加上、编辑态点 × 去掉，整组替换 ≤10）、属性表
 * （分类 / 授权即改即存；尺寸 / 比例 / 格式 / 来源 / 模型 / 创建时间只读）、补充信息（行业 / 风格 / 镜头 / 颜色，
 * 草稿 + 保存）与生成记录（溯源）按需展开、校色状态说明。
 */
import { computed, ref } from 'vue'
import { NInput, NSelect } from 'naive-ui'
import IconButton from '@/components/IconButton/index.vue'
import { formatTime } from '@/views/local-life/constants.ts'
import {
  formatOfUrl,
  KIND_OPTIONS,
  LICENSE_OPTIONS,
  META_FIELDS,
  META_MAX,
  ratioOf,
  SOURCE_LABELS,
  useAssetDetail,
} from './context.ts'

const d = useAssetDetail()

const promptExpanded = ref(false)
const promptLong = computed(() => (d.asset.value?.prompt || '').length > 160)
const metaOpen = ref(false)
const provOpen = ref(false)

const readonlyRows = computed(() => {
  const a = d.asset.value
  if (!a) return []
  const rows = [
    { label: '尺寸', value: a.width && a.height ? `${a.width} × ${a.height}` : '' },
    { label: '比例', value: ratioOf(a.width, a.height) },
    { label: '格式', value: formatOfUrl(a.media === 'video' ? a.videoUrl : a.image) || (a.media === 'video' ? '视频' : '图片') },
    { label: '来源', value: SOURCE_LABELS[a.source] ?? a.source },
    { label: '模型', value: d.modelLabel.value },
    { label: '创建时间', value: a.createdAt ? formatTime(a.createdAt) : '' },
  ]
  return rows.filter((r) => r.value)
})

const SECTION = 'flex flex-col gap-10px'
const H3 = 'm-0 text-13px font-600 text-ink'
const DISCLOSURE =
  'flex items-center gap-6px w-full min-h-36px px-0 border-none bg-transparent text-13px font-600 text-ink cursor-pointer rounded-8px sx-focus hover:text-violet-ink'
</script>

<template>
  <div v-if="d.asset.value" class="flex flex-col gap-20px">
    <!-- 校色状态：只在调过色 / 当前是校色版本时出现 -->
    <p
      v-if="d.fixSavedAsVersion.value && !d.cf.active.value"
      class="m-0 flex gap-8px p-10px rounded-12px bg-info-soft text-12px leading-18px text-#654876"
    >
      <span aria-hidden="true">ⓘ</span>
      当前显示的是校色后保存的版本，原图仍保留，可在图片底部切回「原图」。
    </p>
    <p
      v-else-if="d.cf.active.value && !d.fixSavedAsVersion.value"
      class="m-0 flex gap-8px p-10px rounded-12px bg-warning-soft text-12px leading-18px text-#7d5a20"
    >
      <span aria-hidden="true">ⓘ</span>
      校色效果目前只存在这台设备的浏览器里。点图片左上「保存为新版本」可存进资产，换设备也能用。
    </p>

    <!-- 提示词 -->
    <section v-if="d.asset.value.prompt" class="asset-prompt relative rounded-14px border border-solid border-violet-line">
      <header class="flex items-center justify-between pl-12px pr-6px pt-6px">
        <h3 class="m-0 text-12px font-600 text-violet-ink">提示词</h3>
        <IconButton label="复制提示词" size="sm" variant="quiet" @click="d.copyPrompt">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
          </svg>
        </IconButton>
      </header>
      <p
        class="m-0 px-12px pt-2px pb-10px whitespace-pre-wrap break-words text-13px leading-21px text-ink-2"
        :class="!promptExpanded && promptLong && 'line-clamp-5'"
      >
        {{ d.asset.value.prompt }}
      </p>
      <button
        v-if="promptLong"
        type="button"
        class="block ml-12px mb-8px -mt-4px h-28px px-0 border-none bg-transparent text-12px text-violet-ink cursor-pointer hover:underline sx-focus"
        :aria-expanded="promptExpanded"
        @click="promptExpanded = !promptExpanded"
      >
        {{ promptExpanded ? '收起' : '展开全部' }}
      </button>
    </section>
    <p v-else class="m-0 text-12px text-placeholder">没有提示词（上传的素材通常不带）</p>

    <!-- 标签 -->
    <section :class="SECTION">
      <div class="flex items-center gap-8px">
        <h3 :class="H3">标签</h3>
        <span class="text-11px text-placeholder tabular-nums">{{ d.currentTags.value.length }}/10</span>
      </div>
      <div class="flex flex-wrap items-center gap-8px">
        <span
          v-for="t in d.currentTags.value"
          :key="t"
          class="inline-flex items-center gap-2px h-28px pl-10px rounded-14px text-12px bg-violet-soft text-violet-ink border border-solid border-violet-line"
          :class="d.tagEditing.value ? 'pr-2px' : 'pr-10px'"
        >
          {{ t }}
          <button
            v-if="d.tagEditing.value"
            type="button"
            class="sx-hit inline-grid place-items-center w-24px h-24px rounded-full border-none bg-transparent text-violet-ink cursor-pointer hover:bg-violet-soft-2 sx-focus"
            :aria-label="`移除标签 ${t}`"
            :title="`移除「${t}」`"
            :disabled="d.saving.value"
            @click="d.removeTag(t)"
          >
            <svg class="w-12px h-12px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </span>
        <span v-if="!d.currentTags.value.length && !d.tagEditing.value" class="text-12px text-placeholder">
          还没有标签，加上后可在资产库按标签筛选
        </span>
        <button
          type="button"
          class="inline-flex items-center h-28px px-10px rounded-14px border border-dashed border-line-strong bg-transparent text-12px text-ink-2 cursor-pointer hover:(border-violet text-violet-ink) sx-focus"
          :class="d.tagEditing.value && '!border-solid !border-violet-line !bg-violet-soft !text-violet-ink font-600'"
          :aria-expanded="d.tagEditing.value"
          @click="d.tagEditing.value = !d.tagEditing.value"
        >
          {{ d.tagEditing.value ? '完成' : '+ 标签' }}
        </button>
      </div>
      <div v-if="d.tagEditing.value" class="flex flex-col gap-8px p-10px rounded-12px bg-surface2 border border-solid border-line-soft">
        <n-input
          v-model:value="d.newTagName.value"
          maxlength="20"
          autofocus
          :placeholder="`输入标签名后回车，没有的会自动新建`"
          @keydown.enter="d.addTag"
        />
        <div v-if="d.dictOptions.value.length" class="flex flex-wrap items-center gap-6px">
          <span class="text-11px text-placeholder">点一下加上：</span>
          <button
            v-for="t in d.dictOptions.value"
            :key="t.id"
            type="button"
            class="inline-flex items-center h-28px px-10px rounded-14px border border-solid border-line bg-white text-12px text-ink-2 cursor-pointer hover:(border-violet-line text-violet-ink) sx-focus"
            :disabled="d.saving.value"
            @click="d.toggleDictTag(t.name)"
          >
            {{ t.name }}
          </button>
        </div>
      </div>
    </section>

    <!-- 属性 -->
    <section :class="SECTION">
      <h3 :class="H3">属性</h3>
      <dl class="asset-props m-0 grid grid-cols-[64px_1fr] items-center gap-x-12px gap-y-8px">
        <dt class="text-12px text-muted">分类</dt>
        <dd class="m-0 min-w-0">
          <n-select
            size="small"
            :options="KIND_OPTIONS"
            :value="d.asset.value.kind"
            :disabled="d.saving.value"
            @update:value="(v: string) => d.setKind(v)"
          />
        </dd>
        <dt class="text-12px text-muted">授权</dt>
        <dd class="m-0 min-w-0">
          <n-select
            size="small"
            :options="LICENSE_OPTIONS"
            :value="d.asset.value.license ?? ''"
            :disabled="d.saving.value"
            @update:value="(v: string) => d.setLicense(v)"
          />
        </dd>
        <template v-for="r in readonlyRows" :key="r.label">
          <dt class="text-12px text-muted">{{ r.label }}</dt>
          <dd class="m-0 min-w-0 text-13px leading-20px text-ink break-all tabular-nums">{{ r.value }}</dd>
        </template>
      </dl>
    </section>

    <!-- 补充信息（行业 / 风格 / 镜头 / 颜色）：按需展开，草稿 + 保存 -->
    <section class="flex flex-col border-t border-t-solid border-line-soft pt-6px">
      <button type="button" :class="DISCLOSURE" :aria-expanded="metaOpen" @click="metaOpen = !metaOpen">
        <span class="inline-block w-12px text-muted transition-transform motion-reduce:transition-none" :class="metaOpen && 'rotate-90'" aria-hidden="true">›</span>
        补充信息
        <span class="font-400 text-12px text-placeholder">
          {{ d.metaFilledCount.value ? `已填 ${d.metaFilledCount.value} 项` : '行业、风格、镜头、颜色' }}
        </span>
      </button>
      <div v-if="metaOpen" class="flex flex-col gap-8px pt-4px pb-8px">
        <div v-for="f in META_FIELDS" :key="f.key" class="grid grid-cols-[64px_1fr] items-center gap-12px">
          <label class="text-12px text-muted" :for="`asset-meta-${f.key}`">{{ f.label }}</label>
          <n-input
            v-model:value="d.metaDraft.value[f.key]"
            :input-props="{ id: `asset-meta-${f.key}` }"
            size="small"
            :maxlength="META_MAX"
            :disabled="d.saving.value"
            :placeholder="`${f.label}（选填）`"
          />
        </div>
        <div class="flex items-center gap-8px mt-4px">
          <button type="button" class="sx-btn-primary" :disabled="!d.metaDirty.value || d.saving.value" @click="d.saveMeta">
            保存补充信息
          </button>
          <button type="button" class="sx-btn-ghost" :disabled="!d.metaDirty.value || d.saving.value" @click="d.resetDrafts">
            还原
          </button>
          <span v-if="d.metaDirty.value" class="text-11px text-warning">有未保存的修改</span>
        </div>
      </div>

      <template v-if="d.provRows.value.length">
        <button type="button" :class="DISCLOSURE" :aria-expanded="provOpen" @click="provOpen = !provOpen">
          <span class="inline-block w-12px text-muted transition-transform motion-reduce:transition-none" :class="provOpen && 'rotate-90'" aria-hidden="true">›</span>
          生成记录
          <span class="font-400 text-12px text-placeholder">运行 ID、工作流等</span>
        </button>
        <dl v-if="provOpen" class="m-0 grid grid-cols-[64px_1fr] gap-x-12px gap-y-6px pt-4px pb-8px">
          <template v-for="r in d.provRows.value" :key="r.label">
            <dt class="text-12px text-muted">{{ r.label }}</dt>
            <dd class="m-0 text-12px leading-18px text-ink break-all select-text">{{ r.value }}</dd>
          </template>
        </dl>
      </template>
    </section>
  </div>
</template>

<style scoped>
.asset-prompt {
  background: linear-gradient(180deg, #fbf8fd 0%, #fff 100%);
}
</style>
