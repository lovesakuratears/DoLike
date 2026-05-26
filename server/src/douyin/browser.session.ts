// 浏览器内会话 —— 抖音 web API 的「签名外包」执行器
//
// 思路：
//   抖音 web 接口需要 a_bogus / X-Bogus / msToken 等签名参数，且签名脚本（webmssdk）每周漂移。
//   直接逆向风险高，且对 arm/x86 不友好（v8/quickjs 嵌入式 vm 都有 prebuild 问题）。
//   做法：在 douyin.com 域名下的 Chromium page 里直接 `fetch(path)` —— 由页面自己的 JS 算签名、
//   附带 cookie，无需我们手写。
//
// 周期：
//   每账号 1 个常驻 BrowserContext + 1 个 page（驻留在 https://www.douyin.com/）；
//   idle TTL 5min 后自动关闭。
//
// 安全：
//   - cookie 只在内存里注入到 BrowserContext，不写盘
//   - 不复用持久化 profile

import { AppError, ERR } from '../core/errors.js'
import { getLogger } from '../core/logger.js'
import {
  closeContext,
  launchEphemeralContext,
  parseCookieToEntries,
  type RuntimeBrowserContext,
  type RuntimePage
} from './browser.runtime.js'

interface AccountSession {
  accountId: number
  secUid: string
  ctx: RuntimeBrowserContext
  page: RuntimePage
  lastUsedAt: number
  closing: boolean
}

const sessions = new Map<number, AccountSession>()
const IDLE_TTL_MS = 5 * 60 * 1000
const IDLE_CHECK_MS = 60 * 1000

let idleTimer: NodeJS.Timeout | null = null

function ensureIdleSweeper(): void {
  if (idleTimer) return
  idleTimer = setInterval(() => {
    const now = Date.now()
    for (const [id, s] of sessions) {
      if (now - s.lastUsedAt > IDLE_TTL_MS) {
        sessions.delete(id)
        void closeContext(s.ctx)
      }
    }
    if (sessions.size === 0 && idleTimer) {
      clearInterval(idleTimer)
      idleTimer = null
    }
  }, IDLE_CHECK_MS)
  idleTimer.unref?.()
}

async function bootSession(accountId: number, secUid: string, cookie: string): Promise<AccountSession> {
  const log = getLogger().child({ mod: 'browser.session', accountId })
  log.info('booting persistent browser session')
  const t0 = Date.now()
  const ctx = await launchEphemeralContext({ headless: true })
  log.info({ ms: Date.now() - t0 }, 'ephemeral context launched')
  try {
    await ctx.addCookies(parseCookieToEntries(cookie))
    const page = await ctx.newPage()
    log.info('navigating to douyin.com (cookie injected)')
    const tGoto = Date.now()
    await page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    log.info({ ms: Date.now() - tGoto, total: Date.now() - t0 }, 'browser session ready')
    const sess: AccountSession = {
      accountId,
      secUid,
      ctx,
      page,
      lastUsedAt: Date.now(),
      closing: false
    }
    sessions.set(accountId, sess)
    ensureIdleSweeper()
    return sess
  } catch (e) {
    log.error({ err: e }, 'bootSession failed; closing context')
    await closeContext(ctx)
    throw e
  }
}

export interface SignedRequestOpts {
  /** 抖音 URL path，含 query 也可（fetch 时按字符串拼接） */
  path: string
  /** 额外 query 参数 */
  query?: Record<string, string | number | undefined>
}

export interface SignedRequestResult<T = unknown> {
  status: number
  data: T | null
  raw: string
}

export class BrowserSession {
  constructor(private inner: AccountSession) {}

  touch(): void {
    this.inner.lastUsedAt = Date.now()
  }

  async request<T = unknown>(opts: SignedRequestOpts): Promise<SignedRequestResult<T>> {
    this.touch()
    const qs = opts.query
      ? Object.entries(opts.query)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : ''
    const fullPath = qs ? `${opts.path}${opts.path.includes('?') ? '&' : '?'}${qs}` : opts.path

    let res: { status: number; raw: string }
    try {
      res = await this.inner.page.evaluate(async (p: string) => {
        const r = await fetch(p, {
          credentials: 'include',
          headers: { accept: 'application/json, text/plain, */*' }
        })
        const text = await r.text()
        return { status: r.status, raw: text }
      }, fullPath)
    } catch (e) {
      throw new AppError(
        ERR.DOUYIN_BROWSER_UNAVAILABLE,
        `浏览器内请求失败：${(e as Error).message}`,
        503
      )
    }

    let data: T | null = null
    try {
      data = JSON.parse(res.raw) as T
    } catch {
      /* 风控页可能返回 HTML */
    }
    return { status: res.status, data, raw: res.raw }
  }
}

export async function acquireBrowserSession(
  accountId: number,
  secUid: string,
  cookie: string
): Promise<BrowserSession> {
  const cached = sessions.get(accountId)
  if (cached && !cached.closing) {
    cached.lastUsedAt = Date.now()
    return new BrowserSession(cached)
  }
  const sess = await bootSession(accountId, secUid, cookie)
  return new BrowserSession(sess)
}

export async function releaseBrowserSession(accountId: number): Promise<void> {
  const s = sessions.get(accountId)
  if (!s) return
  s.closing = true
  sessions.delete(accountId)
  await closeContext(s.ctx)
}

export async function disposeAllBrowserSessions(): Promise<void> {
  const all = Array.from(sessions.values())
  sessions.clear()
  for (const s of all) await closeContext(s.ctx)
  if (idleTimer) {
    clearInterval(idleTimer)
    idleTimer = null
  }
}
