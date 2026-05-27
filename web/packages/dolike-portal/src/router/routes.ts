import type { RouteRecordRaw } from 'vue-router'

export interface MenuMeta {
  title: string
  icon: string
  group?: number
  hidden?: boolean
}

export type MenuRoute = RouteRecordRaw & {
  meta?: MenuMeta
}

// 在主布局（layout/index.vue）内显示的菜单路由
export const menuRoutes: MenuRoute[] = [
  {
    path: '/',
    redirect: '/my'
  },
  {
    path: '/my',
    name: 'my',
    component: () => import('@/views/my/index.vue'),
    meta: { title: '我的归档', icon: '-816', group: 1 }
  },
  {
    path: '/my/queue',
    name: 'my-queue',
    component: () => import('@/views/my/index.vue'),
    meta: { title: '下载任务', icon: '-816', group: 1, hidden: true }
  },
  {
    path: '/my/accounts',
    name: 'my-accounts',
    component: () => import('@/views/my/index.vue'),
    meta: { title: '抖音账号', icon: '-816', group: 1, hidden: true }
  },
  {
    path: '/my/settings',
    name: 'my-settings',
    component: () => import('@/views/my/index.vue'),
    meta: { title: '设置', icon: '-816', group: 1, hidden: true }
  }
]

// 主布局内但不出现在菜单中的辅助路由
export const otherRoutes: RouteRecordRaw[] = [
  {
    path: '/video/:id',
    name: 'video',
    component: () => import('@/views/video/index.vue')
  },
  {
    path: '/note/:id',
    name: 'note',
    component: () => import('@/views/note/index.vue')
  },
  {
    path: '/local-video/:id',
    name: 'local-video',
    component: () => import('@/views/local-video/index.vue')
  },
  {
    path: '/mix/:id',
    name: 'mix',
    component: () => import('@/views/mix/index.vue')
  }
]

// 独立全屏路由（不套用主布局）：登录 / 初始化
export const standaloneRoutes: RouteRecordRaw[] = [
  {
    path: '/auth/setup',
    name: 'auth-setup',
    component: () => import('@/views/auth/setup.vue'),
    meta: { requiresGuest: true }
  },
  {
    path: '/auth/login',
    name: 'auth-login',
    component: () => import('@/views/auth/login.vue'),
    meta: { requiresGuest: true }
  }
]
