import { defineStore } from 'pinia'
import { localApi, type AuthStatus, type AuthUser } from '@/api/local'

interface State {
  hasUser: boolean
  loggedIn: boolean
  user: AuthUser | null
  ready: boolean
}

export const useLocalAuthStore = defineStore('local-auth', {
  state: (): State => ({
    hasUser: false,
    loggedIn: false,
    user: null,
    ready: false
  }),
  getters: {
    needSetup: (s) => s.ready && !s.hasUser,
    needLogin: (s) => s.ready && s.hasUser && !s.loggedIn
  },
  actions: {
    apply(status: AuthStatus) {
      this.hasUser = status.hasUser
      this.loggedIn = status.loggedIn
      this.user = status.user
      this.ready = true
    },
    async refresh() {
      const r = await localApi.authStatus()
      if (r.code === 0) this.apply(r.data)
      return r
    },
    async setup(username: string, password: string) {
      const r = await localApi.setup(username, password)
      if (r.code === 0) {
        this.hasUser = true
        this.loggedIn = true
        this.user = r.data
        this.ready = true
      }
      return r
    },
    async login(username: string, password: string, remember: boolean) {
      const r = await localApi.login(username, password, remember)
      if (r.code === 0) {
        this.hasUser = true
        this.loggedIn = true
        this.user = r.data
        this.ready = true
      }
      return r
    },
    async logout() {
      const r = await localApi.logout()
      this.loggedIn = false
      this.user = null
      return r
    }
  }
})
