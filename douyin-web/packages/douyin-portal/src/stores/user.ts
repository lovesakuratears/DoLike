import { defineStore } from 'pinia'

// 旧版 user store —— 用来兼容尚未删除的老组件（layout/HeaderNav 等）。
// 抖音账号相关状态在 M1.3 / M2 会迁到 stores/douyin-accounts.ts，
// 这里先保留一个最小空壳，不再触碰任何抖音 web 接口。
export const userStore = defineStore('user', {
  state: () => ({
    token: '',
    routerKey: 'updated',
    userInfo: {} as any,
    isLogin: false,
    isLoading: false
  }),
  actions: {
    async getUserInfo() {
      // no-op：后端 /aweme/v1/web/... 已无效，等 M1.3 接入真实抖音账号
    },
    logout() {
      this.userInfo = {}
      this.token = ''
      this.isLogin = false
      this.routerKey = ''
    },
    async postCode(_email: string) {},
    async codeLogin(_email: string, _code: string) {}
  }
})
