import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import layout from '@/layout/index.vue'
import { menuRoutes, otherRoutes, standaloneRoutes } from './routes'
import { useLocalAuthStore } from '@/stores/local-auth'

const routes: RouteRecordRaw[] = [
  ...standaloneRoutes,
  {
    path: '/',
    component: layout,
    children: [...menuRoutes, ...otherRoutes]
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/404.vue')
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach(async (to) => {
  const auth = useLocalAuthStore()
  if (!auth.ready) {
    try {
      await auth.refresh()
    } catch {
      // 后端不可达时放行，让页面自己处理错误状态
      auth.ready = true
    }
  }

  // 未初始化本地账号：强制进入 setup
  if (!auth.hasUser && to.path !== '/auth/setup') {
    return { path: '/auth/setup' }
  }
  // 已初始化但未登录：强制进入 login
  if (auth.hasUser && !auth.loggedIn && to.path !== '/auth/login') {
    return { path: '/auth/login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} }
  }
  // 已登录还想访问 auth 页：跳回主页
  if (auth.loggedIn && (to.path === '/auth/setup' || to.path === '/auth/login')) {
    return { path: '/my' }
  }
})

export default router
