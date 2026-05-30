<script setup lang="ts">
import { NConfigProvider } from 'naive-ui'
import type { GlobalThemeOverrides } from 'naive-ui'

const themeOverrides: GlobalThemeOverrides = {
  common: {
    baseColor: 'red',
    primaryColorHover: '#8E66F9',
    primaryColor: '#8E66F9',
  },
  // Button: {
  //   textColor: '#8E66F9',
  // },
}
</script>

<template>
  <n-config-provider :theme-overrides="themeOverrides">
    <RouterView />
  </n-config-provider>
</template>

<style scoped></style>
