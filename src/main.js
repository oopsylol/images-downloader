import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from '../App.vue'
import '../style.css'

// 确保在创建应用之前导入所有需要的样式和组件
const app = createApp(App)

// 使用 Element Plus
app.use(ElementPlus)

// 最后再挂载应用
app.mount('#app') 