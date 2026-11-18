<script setup lang="ts">
/**
 * 第一步：放入原视频 + 放上你的人物 / 商品图（都可以先不放，下一步再补）。文案取自 EXPERIENCE §4.1 / 4.2 / 4.4。
 * 上方「先看看示例」（EXPERIENCE §2.2 / §3.0a）：按当前行业取示例，点一条即时看示例原片与成片并排 + 看懂了什么，不花点数；
 * 「换成我的素材做同款」用示例出你自己的方案。从「我的方案」来但原片已不在时，顶部提示重新上传原片（方案设置保留）。
 */
import { computed, ref, watch } from 'vue'
import AssetPickerModal from '@/views/studio/components/AssetPickerModal/index.vue'
import AssetArea from './parts/AssetArea.vue'
import AgentLink from './parts/AgentLink.vue'
import { MAX_ASSETS, WISH_MAX, mm } from './constants.ts'
import type { useReplicate } from './useReplicate.ts'

const props = defineProps<{ rep: ReturnType<typeof useReplicate> }>()
const rep = props.rep
const FOCUS = 'focus-visible:(outline outline-2 outline-violet outline-offset-2)'

const fileEl = ref<HTMLInputElement | null>(null)
const dragging = ref(false)

function onFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) void rep.pickVideo(f)
  ;(e.target as HTMLInputElement).value = ''
}
function onDrop(e: DragEvent) {
  dragging.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) void rep.pickVideo(f)
}
/** 资产库选图 / 选视频：与上传同一套校验，地址直接用资产的 */
const assetVideoOpen = ref(false)
function onAssetVideo(urls: string[]) {
  const u = urls[0]
  if (u) void rep.pickSourceAsset(u, '资产库视频')
}

const maxSec = () => rep.limits.value?.maxDurationSec ?? 80

const tryView = computed(() => rep.sampleTry.value)
const tryResult = computed(() => tryView.value?.analysis ?? null)
/** 示例视频都是静音循环；暂停 / 播放两个一起 */
const srcVideo = ref<HTMLVideoElement | null>(null)
const resVideo = ref<HTMLVideoElement | null>(null)
const paused = ref(false)
function togglePlay() {
  const vs = [srcVideo.value, resVideo.value].filter((v): v is HTMLVideoElement => !!v)
  if (paused.value) {
    for (const v of vs) void v.play().catch(() => undefined)
    paused.value = false
  } else {
    for (const v of vs) v.pause()
    paused.value = true
  }
}
function openSample(id: number) {
  paused.value = false
  void rep.trySample(id)
}
/** 原片缩略图：上传中用本地预览，传完用本站地址；换了源就重置状态 */
const thumbSrc = computed(() => {
  const u = rep.source.preview || rep.source.url
  return u ? (u.includes('#') ? u : `${u}#t=0.1`) : ''
})
const thumbOk = ref(false)
const thumbFail = ref(false)
watch(thumbSrc, () => {
  thumbOk.value = false
  thumbFail.value = false
})
const maxMb = () => 300 // Go 的 limits 没有大小上限，沿用体验文档口径
</script>

<template>
  <div class="flex flex-col gap-16px">
    <!-- 从「我的方案」来、原片已不在：重新上传原片，分析好后自动按保存的方案出新方案 -->
    <section v-if="rep.pendingReuse.value" class="vr-panel !border-violet-line" role="status">
      <h3 class="vr-h3">用「{{ rep.pendingReuse.value.name }}」再做一条</h3>
      <p class="vr-sub !mb-8px">这个方案的原片已经不在了。需要重新上传原片（方案设置会保留），分析好后直接按这个方案出新方案</p>
      <button type="button" class="sx-soft-btn" @click="rep.cancelPendingReuse()">不用这个方案了</button>
    </section>

    <!-- 示例预览：示例原片与示例成片并排（静音循环，可暂停）+ 看懂了什么 -->
    <section v-if="tryView" class="vr-panel" aria-label="示例效果">
      <p class="m-0 mb-10px rounded-10px bg-surface2 px-12px py-8px text-12px leading-18px text-ink-2">{{ tryView.freeText }}</p>
      <div class="flex items-center gap-8px">
        <h3 class="vr-h3 !m-0 min-w-0 flex-1 truncate">{{ tryView.sample.title }}</h3>
        <button type="button" class="sx-soft-btn" :aria-pressed="paused" @click="togglePlay">{{ paused ? '播放' : '暂停' }}</button>
        <button type="button" class="sx-soft-btn" @click="rep.closeSample()">看看别的</button>
      </div>
      <div class="mt-10px grid grid-cols-2 gap-10px">
        <figure class="m-0 flex flex-col gap-4px">
          <video
            v-if="tryView.sourceUrl"
            ref="srcVideo"
            :src="tryView.sourceUrl"
            :poster="tryView.sample.coverUrl"
            class="aspect-[9/16] w-full rounded-12px bg-surface3 object-cover"
            muted
            loop
            autoplay
            playsinline
            aria-label="示例原片"
          />
          <span v-else class="grid aspect-[9/16] w-full place-items-center rounded-12px bg-surface3 text-12px text-placeholder">原片暂时打不开</span>
          <figcaption class="text-12px text-muted">原片</figcaption>
        </figure>
        <figure class="m-0 flex flex-col gap-4px">
          <video
            v-if="tryView.resultUrl"
            ref="resVideo"
            :src="tryView.resultUrl"
            :poster="tryView.sample.coverUrl"
            class="aspect-[9/16] w-full rounded-12px bg-surface3 object-cover"
            muted
            loop
            autoplay
            playsinline
            aria-label="示例成片"
          />
          <span v-else class="grid aspect-[9/16] w-full place-items-center rounded-12px bg-surface3 text-12px text-placeholder">这条示例还没有成片</span>
          <figcaption class="text-12px text-muted">做同款之后</figcaption>
        </figure>
      </div>
      <div v-if="tryResult" class="mt-12px">
        <h3 class="vr-h3">
          <svg class="mr-6px inline h-14px w-14px text-violet" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>
          看懂了<template v-if="tryResult.sections?.length">：{{ tryResult.sections.length }} 个镜头</template>
        </h3>
        <p class="vr-sub">{{ tryResult.summary }}</p>
        <ol v-if="tryResult.sections?.length" class="m-0 flex list-none flex-col gap-4px p-0">
          <li v-for="x in tryResult.sections" :key="x.index" class="flex gap-8px text-12px leading-18px text-ink-2">
            <span class="flex-none tabular-nums text-placeholder">{{ mm(x.t0) }}–{{ mm(x.t1) }}</span>
            <span class="min-w-0">{{ x.desc }}</span>
          </li>
        </ol>
      </div>
      <div class="mt-14px flex flex-wrap items-center justify-end gap-12px">
        <span class="text-12px text-muted">{{ tryView.nextText }}</span>
        <button type="button" class="sx-btn-primary !h-40px !px-20px !text-14px" :disabled="rep.notReady.value" @click="rep.useSample()">换成我的素材做同款</button>
      </div>
    </section>

    <!-- 先看看示例：按当前行业；没有示例就不显示 -->
    <section v-else-if="!rep.pendingReuse.value && (rep.samplesLoading.value || rep.samples.value.length)" class="vr-panel" aria-label="先看看示例">
      <h3 class="vr-h3">先看看示例</h3>
      <p class="vr-sub">点一条，看原片和做同款之后的效果，不花点数</p>
      <div v-if="rep.samplesLoading.value && !rep.samples.value.length" class="flex gap-10px" aria-busy="true">
        <span v-for="i in 3" :key="i" class="vr-pulse block aspect-[3/4] w-120px flex-none rounded-12px bg-surface3" />
      </div>
      <ul v-else class="m-0 flex list-none gap-10px overflow-x-auto p-0 pb-4px">
        <li v-for="x in rep.samples.value" :key="x.id" class="w-120px flex-none">
          <button
            type="button"
            :class="['flex w-full flex-col gap-4px border-0 bg-transparent p-0 text-left cursor-pointer', FOCUS]"
            :aria-label="`看示例：${x.title}`"
            :disabled="rep.sampleTryBusy.value != null"
            @click="openSample(x.id)"
          >
            <span class="relative block aspect-[3/4] w-full overflow-hidden rounded-12px bg-surface3">
              <img v-if="x.coverUrl" :src="x.coverUrl" alt="" loading="lazy" class="h-full w-full object-cover" aria-hidden="true" />
              <span class="absolute bottom-4px right-4px rounded-4px bg-black/55 px-4px text-10px tabular-nums text-white">{{ Math.round(x.durationS) }} 秒</span>
              <span v-if="rep.sampleTryBusy.value === x.id" class="absolute inset-0 grid place-items-center bg-black/30"><n-spin size="small" /></span>
            </span>
            <b class="line-clamp-2 text-12px font-600 leading-16px text-ink">{{ x.title }}</b>
          </button>
        </li>
      </ul>
      <p v-if="rep.sampleError.value" class="m-0 mt-8px text-12px text-danger" role="alert">{{ rep.sampleError.value }}</p>
    </section>

    <section class="vr-panel">
      <h3 class="vr-h3">1. 放入原视频</h3>
      <p class="vr-sub">MP4 / MOV，最长 {{ maxSec() }} 秒，{{ maxMb() }}MB 以内</p>

      <template v-if="!rep.source.url && !rep.source.uploading">
        <button
          type="button"
          :class="[
            'sx-squircle flex w-full flex-col items-center gap-6px rounded-16px border border-dashed border-control bg-surface2 px-16px py-32px text-center cursor-pointer',
            dragging ? 'sx-drop' : 'hover:border-violet-line',
            FOCUS,
          ]"
          aria-label="上传视频"
          @click="fileEl?.click()"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="onDrop"
        >
          <svg class="h-28px w-28px text-violet" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
          </svg>
          <b class="text-15px font-600 text-ink">上传一条想做同款的视频</b>
          <span class="text-12px text-muted">点击选择，或拖到这里 · 松开就上传</span>
          <span class="max-w-420px text-11px text-placeholder">
            视频由 AI 分段生成再拼接，时间越长，人物和商品越容易前后不一致，费用也越高，所以先限制在 {{ maxSec() }} 秒
          </span>
        </button>
        <input ref="fileEl" type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" class="hidden" @change="onFile" />
        <button type="button" class="sx-soft-btn mt-8px self-start" @click="assetVideoOpen = true">从资产库添加</button>
      </template>

      <div v-else class="flex items-center gap-12px rounded-14px bg-surface2 p-10px">
        <!-- 缩略图：<video preload=metadata> + #t=0.1 直接显示首帧（不读 canvas，无需 CORS）；加载中 / 出错保持灰底 + 播放图标 -->
        <span class="relative grid h-72px w-48px flex-none place-items-center overflow-hidden rounded-8px bg-surface3 text-placeholder">
          <svg v-if="!thumbOk" class="h-18px w-18px" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>
          <video
            v-if="thumbSrc && !thumbFail"
            :key="thumbSrc"
            :src="thumbSrc"
            preload="metadata"
            muted
            playsinline
            tabindex="-1"
            aria-hidden="true"
            :class="['absolute inset-0 h-full w-full object-cover', thumbOk ? '' : 'opacity-0']"
            @loadeddata="thumbOk = true"
            @error="thumbFail = true"
          />
        </span>
        <div class="min-w-0 flex-1">
          <b class="block truncate text-13px font-600 text-ink">{{ rep.source.name }}</b>
          <p v-if="rep.source.uploading" class="m-0 mt-2px text-12px text-muted" role="status">
            正在上传 {{ rep.source.sizeMb }}MB<template v-if="rep.source.progress > 0 && rep.source.progress < 1"> · {{ Math.round(rep.source.progress * 100) }}%</template> · 上传的同时可以先放商品图
          </p>
          <p v-else class="m-0 mt-2px text-12px text-muted">
            {{ rep.source.durationSec ? `${Math.round(rep.source.durationSec)} 秒` : '' }} · 上传好了，可以开始分析
          </p>
          <div v-if="rep.source.uploading" class="mt-6px h-4px overflow-hidden rounded-2px bg-surface3" role="progressbar" aria-label="上传中">
            <i
              v-if="rep.source.progress > 0"
              class="block h-full rounded-2px bg-violet transition-[width]"
              :style="{ width: `${Math.round(rep.source.progress * 100)}%` }"
            />
            <i v-else class="vr-indeterminate block h-full w-1/3 rounded-2px bg-violet" />
          </div>
        </div>
        <button type="button" class="sx-btn" :disabled="rep.source.uploading" @click="rep.clearSource()">换一条</button>
      </div>
      <p v-if="rep.source.error" class="m-0 mt-8px text-12px leading-18px text-danger" role="alert">{{ rep.source.error }}</p>
      <p v-else-if="rep.source.notice" class="m-0 mt-8px text-12px leading-18px text-warning" role="status">{{ rep.source.notice }}</p>
    </section>

    <section class="vr-panel">
      <h3 class="vr-h3">2. 放上你的素材图</h3>
      <p class="vr-sub">人物、商品、服装、门店照片都可以放，最多 {{ MAX_ASSETS }} 张，我会判断每张是什么。都可以先不放，下一步再补</p>
      <AssetArea :rep="rep" />
    </section>

    <section class="vr-panel">
      <h3 class="vr-h3">3. 想怎么改（可以不填）</h3>
      <p class="vr-sub !mb-8px">一句话说就行，我会帮你变成改法，下一步能逐条看、逐条撤销</p>
      <textarea
        v-model="rep.wishText.value"
        :maxlength="WISH_MAX"
        rows="3"
        aria-label="想怎么改"
        placeholder="比如：台词里的价格改成 99；换成冬天的感觉；店名改成小王理发，电话 138xxxx"
        class="vr-input !h-auto min-h-72px resize-y py-8px leading-20px"
      />
      <div class="mt-4px flex items-start gap-8px">
        <p class="m-0 min-w-0 flex-1 text-11px leading-16px text-placeholder">视频里的文字不是 AI 画的，会在做好之后清晰地加上去，也可以随时再改。</p>
        <span class="flex-none text-11px tabular-nums text-placeholder">{{ rep.wishText.value.length }} / {{ WISH_MAX }}</span>
      </div>
    </section>
    <AssetPickerModal v-model:show="assetVideoOpen" :limit="1" media="video" @select="onAssetVideo" />

    <div class="flex flex-wrap items-center justify-end gap-12px">
      <span class="text-12px text-muted">分析免费，不扣点数；只分析一次，之后改方案不用再等</span>
      <button type="button" class="sx-btn-primary !h-40px !px-20px !text-14px" :disabled="!rep.canAnalyze.value" @click="rep.startAnalysis()">
        开始分析
      </button>
    </div>
    <AgentLink :rep="rep" />
  </div>
</template>
