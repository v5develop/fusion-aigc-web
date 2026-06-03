import type { App } from 'vue'
import observerBottom from './observerScrollToBottom.ts'
import loading from './loading.tsx'

export function registerDirectives(app: App) {
  app.directive('observer-scroll-to-bottom', observerBottom)
  app.directive('loading', loading)
}
