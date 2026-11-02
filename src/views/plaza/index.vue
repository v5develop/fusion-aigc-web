<script setup lang="ts">
/** 创意广场：对齐原型 PlazaView 空态（接口未接入，仅保留入口） */
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-y-auto bg-page p-24px">
    <h1 class="m-0 mb-16px text-20px font-600 leading-[1.3] text-ink">创意广场</h1>
    <section
      class="flex min-h-360px flex-col items-center justify-center gap-8px rounded-8px border border-solid border-line bg-white px-24px py-32px text-center shadow-[0_1px_2px_rgba(31,35,41,0.04),0_8px_18px_rgba(31,35,41,0.05)]"
      aria-label="创意广场空态"
    >
      <span
        class="mb-4px grid h-64px w-64px place-items-center rounded-8px border border-solid border-line bg-violet-soft text-violet-ink"
      >
        <svg
          class="h-40px w-40px"
          viewBox="0 0 512 512"
          fill="none"
          stroke="currentColor"
          stroke-width="32"
          stroke-miterlimit="10"
          aria-hidden="true"
        >
          <path
            d="M413.48 284.46c58.87 47.24 91.61 89 80.31 108.55c-17.85 30.85-138.78-5.48-270.1-81.15S.37 149.84 18.21 119c11.16-19.28 62.58-12.32 131.64 14.09"
          />
          <circle cx="256" cy="256" r="160" />
        </svg>
      </span>
      <b class="text-14px font-600 text-ink">广场内容还未接入</b>
      <p class="m-0 max-w-420px text-11px leading-[1.7] text-muted">
        公开作品、作者与筛选会在接口接通后出现在这里；当前先保留真实入口与空态。
      </p>
      <button
        type="button"
        class="mt-8px inline-flex h-32px cursor-pointer items-center gap-6px rounded-4px border border-solid border-line-strong bg-white px-12px text-12px text-ink-2 transition-colors hover:border-violet-line hover:text-violet-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet focus-visible:outline-offset-2"
        @click="router.push('/')"
      >
        <svg
          class="h-14px w-14px"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M14.5 5.5 8 12l6.5 6.5" />
        </svg>
        回到工具箱
      </button>
    </section>
  </div>
</template>
