<script setup lang="ts">
/**
 * 资产库增强：Java 素材库（/api/v1/asset）之上的增强视图（Go 网关 /api/v1/asset-library）。
 * 分类条计数 / 筛选 / 收藏 / 标签（批量打标签 + 标签管理）/ 版本与相关资产详情。
 * 素材本身的新增删除仍走素材库，本页只做增强展示与编目。
 */
import { computed, onMounted, reactive, ref, watch } from "vue";
import { NButton, NConfigProvider, NInput, NSelect, NSwitch, useMessage } from "naive-ui";
import { llTheme } from "@/views/local-life/theme.ts";
import { assetLibCategories, assetLibList, assetLibUpdate } from "@/api/assetLibrary.ts";
import type { IAssetLibAsset, IAssetLibCategory } from "@/api/assetLibrary.ts";
import { useDebounce } from "@/utils/hooks";
import AssetCard from "./components/AssetCard.vue";
import DetailModal from "./components/DetailModal.vue";
import TagManagerModal from "./components/TagManagerModal.vue";
import BatchTagModal from "./components/BatchTagModal.vue";

defineOptions({ name: "asset-library" });

const message = useMessage();

// ---------------- 分类条 ----------------

const KIND_LABELS: Record<string, string> = {
  all: "全部",
  model: "模特",
  scene: "场景",
  makeup: "妆造",
  hair: "发型",
  accessory: "配饰",
  uncategorized: "未分类",
};
const kindLabel = (key: string) => KIND_LABELS[key] ?? key;

const categories = ref<IAssetLibCategory[]>([]);
const activeKind = ref("all");

async function loadCategories() {
  try {
    const res = await assetLibCategories({
      source: filters.source || undefined,
      media: filters.media || undefined,
    });
    categories.value = res.data?.items ?? [];
  } catch {
    // 分类条拉失败不挡列表：pill 置空，下次换筛选会重试
    categories.value = [];
  }
}

// ---------------- 筛选 ----------------

const SOURCE_OPTIONS = [
  { label: "全部来源", value: "" },
  { label: "我的素材", value: "input" }, // input = official + upload
  { label: "AI 生成", value: "generated" },
  { label: "官方", value: "official" },
  { label: "上传", value: "upload" },
];
const MEDIA_OPTIONS = [
  { label: "全部类型", value: "" },
  { label: "图片", value: "image" },
  { label: "视频", value: "video" },
];

const filters = reactive({
  source: "",
  media: "",
  favorite_only: false,
  q: "",
  tag: "",
});

// ---------------- 列表 ----------------

const PAGE_SIZE = 20;

const items = ref<IAssetLibAsset[]>([]);
const total = ref(0);
const page = ref(0);
const loading = ref(false);
const loadingMore = ref(false);
const hasMore = computed(() => items.value.length < total.value);

async function loadPage(p: number): Promise<IAssetLibAsset[]> {
  const res = await assetLibList({
    kind: activeKind.value === "all" ? undefined : activeKind.value,
    source: filters.source || undefined,
    media: filters.media || undefined,
    tag: filters.tag || undefined,
    favorite_only: filters.favorite_only || undefined,
    q: filters.q || undefined,
    page: p,
    page_size: PAGE_SIZE,
  });
  total.value = res.data?.total ?? 0;
  return res.data?.items ?? [];
}

/** 首屏 / 筛选变化：回到第 1 页，多选状态一并清掉 */
async function reload() {
  loading.value = true;
  try {
    items.value = await loadPage(1);
    page.value = 1;
    selectedIds.value = [];
  } finally {
    loading.value = false;
  }
}

/** 触底 / 按钮加载下一页 */
async function loadMore() {
  if (loadingMore.value || loading.value || !hasMore.value) return;
  loadingMore.value = true;
  try {
    const next = page.value + 1;
    items.value.push(...(await loadPage(next)));
    page.value = next;
  } finally {
    loadingMore.value = false;
  }
}

/**
 * 静默刷新已加载的全部分页（变更后的同步）：各页并发拉取后原样拼接，
 * 不打乱用户已看到的顺序，也不动筛选与多选。
 */
async function silentRefresh() {
  if (!page.value) return;
  const pages = await Promise.all(Array.from({ length: page.value }, (_, i) => loadPage(i + 1)));
  items.value = pages.flat();
}

// 筛选变化：分类条计数随 source / media 变，列表重查
watch(
  () => [filters.source, filters.media, filters.favorite_only, filters.tag],
  () => {
    void loadCategories();
    void reload();
  },
);
watch(activeKind, () => {
  void reload();
});
useDebounce({ data: () => filters.q, callback: () => void reload() });

onMounted(() => {
  void loadCategories();
  void reload();
});

// 触底加载：滚动容器距底 240px 内预取下一页
const scroller = ref<HTMLElement | null>(null);
function onScroll() {
  const el = scroller.value;
  if (!el || loading.value || loadingMore.value || !hasMore.value) return;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) void loadMore();
}

// ---------------- 收藏（即点即存，静默成功） ----------------

async function toggleFavorite(asset: IAssetLibAsset) {
  const next = !asset.favorite;
  try {
    await assetLibUpdate(asset.id, { favorite: next });
  } catch {
    return; // 失败 toast 已由请求层弹出
  }
  asset.favorite = next;
  // 只看收藏时，取消收藏的卡就地移出，计数跟着走
  if (!next && filters.favorite_only) {
    items.value = items.value.filter((i) => i.id !== asset.id);
    total.value = Math.max(0, total.value - 1);
  }
}

// ---------------- 多选与批量打标签 ----------------

const selectedIds = ref<number[]>([]);

function toggleSelect(id: number) {
  const i = selectedIds.value.indexOf(id);
  if (i >= 0) selectedIds.value.splice(i, 1);
  else selectedIds.value.push(id);
}

const showBatchTag = ref(false);

function openBatchTag() {
  if (!selectedIds.value.length) return;
  if (selectedIds.value.length > 100) {
    message.warning("一次最多给 100 个资产打标签");
    return;
  }
  showBatchTag.value = true;
}

function onBatchTagged() {
  selectedIds.value = [];
  void silentRefresh();
}

// ---------------- 标签管理 / 详情 ----------------

const showTagManager = ref(false);

/** 标签重命名/删除会影响卡片上的标签名；若删掉的正被用作筛选，清掉筛选 */
function onTagsChanged(deletedName?: string) {
  if (deletedName && filters.tag === deletedName) {
    filters.tag = ""; // watch 会触发整页重查
    return;
  }
  void silentRefresh();
}

const detailId = ref<number | null>(null);

function openDetail(asset: IAssetLibAsset) {
  detailId.value = asset.id;
}
</script>

<template>
  <n-config-provider :theme-overrides="llTheme" abstract>
    <div ref="scroller" class="h-full overflow-auto px-32px py-24px bg-page" @scroll="onScroll">
      <div class="flex items-center justify-between mb-16px">
        <div>
          <h1 class="text-20px text-ink m-0 mb-4px font-bold">资产库增强</h1>
          <p class="text-12px text-muted m-0">
            在素材库之上做分类编目：分类、标签、收藏、版本与相关资产；素材的新增删除仍在「素材库」维护
          </p>
        </div>
        <n-button @click="showTagManager = true">标签管理</n-button>
      </div>

      <div class="flex flex-wrap gap-8px mb-12px">
        <span
          v-for="c in categories"
          :key="c.key"
          class="ll-pill"
          :class="{ 'll-pill-active': activeKind === c.key }"
          @click="activeKind = c.key"
        >
          {{ kindLabel(c.key) }}
          <i
            class="not-italic ml-6px"
            :class="activeKind === c.key ? 'text-violet-ink' : 'text-placeholder'"
            >{{ c.count }}</i
          >
        </span>
      </div>

      <div class="flex items-center gap-10px mb-12px">
        <n-select
          v-model:value="filters.source"
          :options="SOURCE_OPTIONS"
          size="small"
          class="w-130px"
        />
        <n-select
          v-model:value="filters.media"
          :options="MEDIA_OPTIONS"
          size="small"
          class="w-110px"
        />
        <div class="flex items-center gap-6px text-12px text-ink-2 whitespace-nowrap">
          <n-switch v-model:value="filters.favorite_only" size="small" />
          <span>仅看收藏</span>
        </div>
        <n-input
          v-model:value="filters.q"
          size="small"
          placeholder="搜标题 / 提示词"
          clearable
          class="w-220px"
        />
        <span
          v-if="filters.tag"
          class="ll-chip ll-chip-running cursor-pointer"
          title="点击清除"
          @click="filters.tag = ''"
        >
          标签：{{ filters.tag }} ×
        </span>
        <span class="ml-auto text-12px text-muted whitespace-nowrap">共 {{ total }} 项</span>
      </div>

      <div
        v-if="selectedIds.length"
        class="flex items-center gap-12px px-14px py-8px mb-12px border border-solid border-violet-line rounded-8px bg-violet-soft text-13px text-violet-ink"
      >
        <span>已选 {{ selectedIds.length }} 项</span>
        <n-button size="small" type="primary" @click="openBatchTag">批量打标签</n-button>
        <n-button size="small" quaternary @click="selectedIds = []">取消选择</n-button>
      </div>

      <div
        v-loading="loading"
        class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-14px min-h-240px"
      >
        <AssetCard
          v-for="item in items"
          :key="item.id"
          :asset="item"
          :checked="selectedIds.includes(item.id)"
          @toggle-select="toggleSelect"
          @toggle-favorite="toggleFavorite"
          @open="openDetail"
          @filter-tag="(name: string) => (filters.tag = name)"
        />
        <div
          v-if="!loading && !items.length"
          class="col-span-full bg-white border border-solid border-line rounded-10px py-60px"
        >
          <p class="ll-empty">
            {{
              filters.q || filters.tag || filters.favorite_only
                ? "没有符合条件的资产"
                : "还没有资产"
            }}
          </p>
        </div>
      </div>

      <div
        v-if="hasMore || loadingMore"
        class="text-center pt-16px pb-4px text-13px text-violet-ink cursor-pointer hover:text-violet-press"
        @click="loadMore"
      >
        {{ loadingMore ? "加载中…" : "加载更多" }}
      </div>
      <div
        v-else-if="!loading && items.length"
        class="text-center pt-16px pb-4px text-13px text-placeholder"
      >
        已加载全部 {{ total }} 项
      </div>
    </div>

    <DetailModal v-model="detailId" @changed="silentRefresh" />
    <TagManagerModal v-model:show="showTagManager" @changed="onTagsChanged" />
    <BatchTagModal v-model:show="showBatchTag" :asset-ids="selectedIds" @success="onBatchTagged" />
  </n-config-provider>
</template>
