import type { App } from 'vue'
import observerBottom from './observerScrollToBottom.ts'

export function registerDirectives(app: App) {
  app.directive('observer-scroll-to-bottom', observerBottom)
}
