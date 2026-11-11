import './assets/base.css'
import './assets/motion.css'
import './assets/iconfont/iconfont.css'
import './assets/dropdown.less'
import 'virtual:uno.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'

import { registerDirectives } from '@/directives'
import { syncTextPrefsWithAccount } from '@/utils/textPrefs.ts'
import { syncThemePrefsWithAccount } from '@/utils/themePrefs.ts'

// 「字体显示」偏好在挂载前套上：#app 挂载前是空白，这里写好 <html> 的 CSS 变量，首屏就是用户的字号 / 字体，不会闪
syncTextPrefsWithAccount()
// 「外观」同理：index.html 内联脚本已先写好 data-theme，这里按同一规则接管（定时切换、跟随系统、Naive 主题）
syncThemePrefsWithAccount()

const app = createApp(App)

registerDirectives(app)

app.use(createPinia())
app.use(router)
// 登录 / 宿主换号后 token 变了：路由切换时按新账号重新读偏好（同账号时直接返回，开销只是一次 localStorage 读）
router.afterEach(() => {
  syncTextPrefsWithAccount()
  syncThemePrefsWithAccount()
})

app.mount('#app')
