<script setup lang="ts">
/**
 * 「我的」抽屉（EXPERIENCE 3.9）：当前行业的「收藏」与「我的模板」两个分段（严格只含当前行业，换行业即换内容；
 * 选了二级仍显示整个行业的）。桌面 ≥1024 是右侧抽屉，更窄是底部 sheet。
 * - 收藏：卡片复用 TemplateCard（点开 = 预览，预览里「做同款」），♡ 取消收藏；空态 F-02；
 * - 我的模板：私有小标；点一行 = 恢复「模板 + 入参 + 版数 + 文字」到输入区（不自动发送）；模板已下线则只能改名 / 删除；
 *   模板入参定义变过时标「部分设置已失效」（已失效的那几项不会带回）；重命名 / 删除，删除乐观更新失败回滚。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { NDrawer, NDrawerContent, useMessage } from 'naive-ui'
import {
  plazaDeleteMyTemplate,
  plazaErrorText,
  plazaFavorites,
  plazaMyTemplates,
  plazaRemoveFavorite,
  plazaUpdateMyTemplate,
  type IPlazaFavorite,
  type IPlazaMyTemplate,
  type IPlazaTemplate,
} from '@/api/plaza.ts'
import PageEmpty from '@/components/PageEmpty/index.vue'
import PageLoadError from '@/components/PageLoadError/index.vue'
import TemplateCard from './TemplateCard.vue'
import { markFavorite, useFavoritesVersion } from './industry/useFavorites.ts'
import { coverOf } from './templateMedia.ts'

const props = defineProps<{ show: boolean; industry: string; industryName: string }>()
const emit = defineEmits<{
  close: []
  /** 点收藏卡：开预览 */
  open: [item: IPlazaTemplate]
  /** 点我的模板：恢复到输入区 */
  restore: [item: IPlazaMyTemplate]
}>()

const message = useMessage()
type Seg = 'fav' | 'mine'
const seg = ref<Seg>('fav')
const favs = ref<IPlazaFavorite[]>([])
const mine = ref<IPlazaMyTemplate[]>([])
const loading = ref(false)
const failed = ref(false)
let seq = 0
const favVersion = useFavoritesVersion()

const wide = ref(typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : true)
const mq = typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)') : null
const onMq = () => (wide.value = mq?.matches ?? true)
mq?.addEventListener('change', onMq)
onBeforeUnmount(() => mq?.removeEventListener('change', onMq))

async function load() {
  if (!props.industry) return
  const s = ++seq
  loading.value = true
  failed.value = false
  try {
    const [f, m] = await Promise.all([plazaFavorites({ industry: props.industry }), plazaMyTemplates({ industry: props.industry })])
    if (s !== seq) return
    favs.value = f.data?.items ?? []
    mine.value = m.data?.items ?? []
  } catch {
    if (s === seq) failed.value = true
  } finally {
    if (s === seq) loading.value = false
  }
}

watch(
  () => [props.show, props.industry, favVersion.value] as const,
  ([on]) => {
    if (on) void load()
  },
  { immediate: true },
)

// ---- 收藏 ----
async function unfav(t: IPlazaFavorite) {
  const keep = favs.value
  favs.value = keep.filter((x) => x.plazaTemplateId !== t.plazaTemplateId)
  markFavorite(t.plazaTemplateId, false)
  try {
    await plazaRemoveFavorite(t.plazaTemplateId)
  } catch (err) {
    favs.value = keep
    markFavorite(t.plazaTemplateId, true)
    message.warning(plazaErrorText(err, '没能取消收藏，再试一次'))
  }
}

// ---- 我的模板 ----
const renamingId = ref<number | null>(null)
const renameText = ref('')
function startRename(m: IPlazaMyTemplate) {
  renamingId.value = m.id
  renameText.value = m.name
}
async function commitRename(m: IPlazaMyTemplate) {
  const name = renameText.value.trim().slice(0, 40)
  renamingId.value = null
  if (!name || name === m.name) return
  const old = m.name
  m.name = name
  try {
    const res = await plazaUpdateMyTemplate(m.id, { name })
    if (res.data) Object.assign(m, { name: res.data.name, updatedAt: res.data.updatedAt })
  } catch (err) {
    m.name = old
    message.warning(plazaErrorText(err, '没能改名，再试一次'))
  }
}
async function removeMine(m: IPlazaMyTemplate) {
  const keep = mine.value
  mine.value = keep.filter((x) => x.id !== m.id)
  try {
    await plazaDeleteMyTemplate(m.id)
  } catch (err) {
    mine.value = keep
    message.warning(plazaErrorText(err, '没能删除，再试一次'))
  }
}

const SEGS = computed<{ key: Seg; label: string }[]>(() => [
  { key: 'fav', label: `${props.industryName}收藏` },
  { key: 'mine', label: `${props.industryName}我的模板` },
])
const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'
const drawerHeight = computed(() => Math.min(Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.8), 640))
</script>

<template>
  <NDrawer
    :show="show"
    :placement="wide ? 'right' : 'bottom'"
    :width="wide ? 440 : undefined"
    :height="wide ? undefined : drawerHeight"
    :auto-focus="true"
    trap-focus
    @update:show="(v: boolean) => !v && emit('close')"
  >
    <NDrawerContent :title="`我的 · ${industryName}`" closable :native-scrollbar="true" body-content-style="padding: 12px 16px 20px">
      <div class="flex flex-col gap-12px" data-testid="plaza-my-library">
        <div role="tablist" aria-label="我的" class="flex gap-18px">
          <button
            v-for="s in SEGS"
            :key="s.key"
            type="button"
            role="tab"
            :aria-selected="seg === s.key"
            :class="[
              'm-0 border-0 bg-transparent px-0 py-4px text-14px leading-22px cursor-pointer',
              seg === s.key ? 'font-600 text-ink' : 'font-500 text-placeholder hover:text-ink-2',
              FOCUS,
            ]"
            @click="seg = s.key"
          >
            {{ s.label }}
          </button>
        </div>

        <div v-if="loading && !favs.length && !mine.length" class="flex justify-center py-32px"><n-spin size="small" /></div>
        <PageLoadError v-else-if="failed" compact subtitle="没加载出来，稍后再试" retryable @retry="load" />

        <template v-else-if="seg === 'fav'">
          <PageEmpty v-if="!favs.length" compact :text="`${industryName}还没有收藏`" description="看到喜欢的模板，点卡片上的 ♡">
            <button type="button" class="sx-btn" @click="emit('close')">去逛逛</button>
          </PageEmpty>
          <ul v-else class="m-0 flex list-none flex-col gap-10px p-0">
            <li v-for="t in favs" :key="t.plazaTemplateId" class="relative">
              <TemplateCard :item="t" preview @pick="emit('open', $event)" />
              <button
                type="button"
                class="absolute bottom-10px right-12px z-4 h-26px rounded-13px border border-solid border-soft-line bg-surface px-10px text-11px text-ink-2 cursor-pointer hover:text-ink"
                :class="FOCUS"
                :aria-label="`取消收藏：${t.title}`"
                @click="unfav(t)"
              >
                取消收藏
              </button>
            </li>
          </ul>
        </template>

        <template v-else>
          <PageEmpty v-if="!mine.length" compact :text="`${industryName}还没有自己的模板`" description="做出满意的成品后，点「存为我的模板」" />
          <ul v-else class="m-0 flex list-none flex-col gap-10px p-0">
            <li
              v-for="m in mine"
              :key="m.id"
              class="sx-soft flex items-center gap-10px rounded-14px p-8px"
              :data-testid="`plaza-mine-${m.id}`"
            >
              <button
                type="button"
                class="m-0 flex min-w-0 flex-1 items-center gap-10px border-0 bg-transparent p-0 text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                :class="FOCUS"
                :disabled="!m.templateAvailable"
                :aria-label="m.templateAvailable ? `用我的模板：${m.name}` : `${m.name}（模板已下线）`"
                @click="emit('restore', m)"
              >
                <img v-if="m.template && coverOf(m.template)" :src="coverOf(m.template)" alt="" class="h-56px w-56px flex-none rounded-10px bg-surface3 object-cover" aria-hidden="true" />
                <span v-else class="h-56px w-56px flex-none rounded-10px bg-surface3" aria-hidden="true" />
                <span class="flex min-w-0 flex-1 flex-col gap-2px">
                  <span class="flex min-w-0 items-center gap-6px">
                    <b class="truncate text-13px font-600 leading-20px text-ink">{{ m.name }}</b>
                    <i class="inline-flex h-16px flex-none items-center rounded-4px bg-violet-soft px-5px text-10px font-600 not-italic text-violet-ink">私有</i>
                  </span>
                  <span class="truncate text-11px leading-16px text-muted">
                    {{ m.template?.title ?? '模板已下线' }} · {{ m.variants }} 版
                  </span>
                  <span v-if="!m.templateAvailable" class="text-11px leading-16px text-alert-danger">这个模板已下线，只能改名或删除</span>
                  <span v-else-if="m.stale" class="text-11px leading-16px text-alert-danger" data-testid="plaza-mine-stale">{{ m.staleHint || '部分设置已失效' }}</span>
                </span>
              </button>
              <template v-if="renamingId === m.id">
                <input
                  v-model="renameText"
                  maxlength="40"
                  aria-label="新名称"
                  class="box-border h-30px w-130px flex-none rounded-8px border border-solid border-violet bg-surface px-8px text-12px text-ink outline-none"
                  @keydown.enter.prevent="commitRename(m)"
                  @keydown.esc.prevent="renamingId = null"
                  @blur="commitRename(m)"
                />
              </template>
              <span v-else class="flex flex-none flex-col gap-2px">
                <button type="button" class="m-0 border-0 bg-transparent px-6px py-2px text-11px text-ink-2 cursor-pointer hover:text-ink" :class="FOCUS" @click="startRename(m)">重命名</button>
                <button type="button" class="m-0 border-0 bg-transparent px-6px py-2px text-11px text-alert-danger cursor-pointer" :class="FOCUS" @click="removeMine(m)">删除</button>
              </span>
            </li>
          </ul>
        </template>
      </div>
    </NDrawerContent>
  </NDrawer>
</template>
