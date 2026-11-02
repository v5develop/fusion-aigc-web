import './assets/base.css'
import './assets/iconfont/iconfont.css'
import './assets/dropdown.less'
import 'virtual:uno.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'

import { registerDirectives } from '@/directives'

const app = createApp(App)

registerDirectives(app)

app.use(createPinia())
app.use(router)

app.mount('#app')
