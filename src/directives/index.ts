import type { App } from 'vue'
import observerScrollDirective from './observer-scroll.ts'
import loading from './loading.tsx'

export function registerDirectives(app: App) {
  app.directive('observer-scroll', observerScrollDirective)
  app.directive('loading', loading)
}
