// 方案 A —— CloakBrowser 真实扫码登录
//
// 流程：
//   1) 启动无头 Chromium → 打开 https://www.douyin.com/
//   2) 点击页面右上 "登录" 触发弹窗（多 selector 兜底）
//   3) 截取二维码 canvas → base64 PNG → emit('waiting_qr')
//   4) 每 2s 轮询 ctx.cookies()，命中 sessionid 即认为登录成功
//   5) 拼装 cookie 字符串 → bindFromCookie({source:'cloak'}) → emit('success', {accountId})
//   6) 关闭 ctx
//
// 状态机事件（与前端 WS 约定）：starting → waiting_qr → (scanning) → confirmed → success | failed | timeout

import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppError, ERR } from '../core/errors.js'
import { getLogger } from '../core/logger.js'
import { bindFromCookie, getDecryptedCookie } from './session.service.js'
import { upsertAccount } from './account.store.js'
import {
  closeContext,
  launchEphemeralContext,
  type RuntimeBrowserContext,
  type RuntimeCookie,
  type RuntimePage
} from './browser.runtime.js'
import { parseCookieString } from './cookie-parse.js'
import type { ProfileSelfRaw } from './dy-client.js'
import type { CloakEvent, CloakStage } from './types.js'

interface CloakSession {
  id: string
  localUserId: number
  stage: CloakStage
  emitter: EventEmitter
  abort: AbortController
  createdAt: number
  lastEvent: CloakEvent | null
  cleanupTimer: NodeJS.Timeout | null
  /** 导入 Cookie 模式：启动前注入该账号的 cookie */
  importAccountId?: number
}

const sessions = new Map<string, CloakSession>()

const SESSION_TTL_MS = 5 * 60 * 1000
const TERMINAL_GRACE_MS = 30_000 // 终态后保留 30s，等晚到的 WS 拿到完整 lastEvent
const QR_WAIT_MS = 150_000   // 二维码有效时长（抖音侧约 2-3 分钟）
const POLL_INTERVAL_MS = 2_000
const PAGE_GOTO_TIMEOUT = 30_000

const LOGIN_BUTTON_SELECTORS = [
  '[data-e2e="login-button"]',
  '[data-e2e="header-login-button"]',
  '[data-e2e="login"]',
  '[id*="login" i]',
  'header button:has-text("登录")',
  'button:has-text("登录")',
  'a:has-text("登录")',
  'div[role="button"]:has-text("登录")',
  'span:has-text("登录")',
  'text=/^登录$/'
] as const

const QR_SELECTORS = [
  // 抖音登录弹窗里几乎只有 QR 一个 canvas；先尝试，命中后省下后面 8 次轮询
  'canvas',
  '[data-e2e="qrcode-img"]',
  '[class*="qrcode"] canvas',
  '[class*="qrcode"] img',
  '[class*="qrCode"] canvas',
  '[class*="qrCode"] img',
  '.account-qr-code canvas',
  'canvas[class*="qr" i]',
  'img[alt*="二维码"]',
  'img[src^="data:image"][class*="qr" i]'
] as const

export function startCloakSession(localUserId: number): CloakSession {
  return startCloakSessionWithCookie(localUserId, undefined)
}

// ★ 带 Cookie 启动 CloakBrowser —— 导入插件 Cookie 后走扫码确认流程
// 标记: CLOAK_WITH_COOKIE
export function startCloakSessionWithCookie(localUserId: number, accountId?: number): CloakSession {
  const id = randomUUID()
  const sess: CloakSession = {
    id,
    localUserId,
    stage: 'starting',
    emitter: new EventEmitter(),
    abort: new AbortController(),
    createdAt: Date.now(),
    lastEvent: null,
    cleanupTimer: null,
    importAccountId: accountId
  }
  sessions.set(id, sess)
  void runReal(sess)
  return sess
}

// WS 用：纯查表，不做 TTL 扫描，保留终态宽限期内的会话
export function peekSession(id: string): CloakSession | undefined {
  return sessions.get(id)
}

export function getSession(id: string): CloakSession | undefined {
  const now = Date.now()
  for (const [k, v] of sessions) {
    if (now - v.createdAt > SESSION_TTL_MS) {
      v.abort.abort()
      if (v.cleanupTimer) clearTimeout(v.cleanupTimer)
      sessions.delete(k)
    }
  }
  return sessions.get(id)
}

export function cancelSession(id: string): boolean {
  const s = sessions.get(id)
  if (!s) return false
  s.abort.abort()
  emit(s, 'failed', { message: '已取消' })
  scheduleCleanup(s)
  return true
}

function emit(sess: CloakSession, stage: CloakStage, extra: Partial<CloakEvent> = {}): void {
  sess.stage = stage
  const ev: CloakEvent = { sessionId: sess.id, stage, ...extra }
  sess.lastEvent = ev
  sess.emitter.emit('event', ev)
}

function scheduleCleanup(sess: CloakSession): void {
  if (sess.cleanupTimer) return
  sess.cleanupTimer = setTimeout(() => {
    sessions.delete(sess.id)
  }, TERMINAL_GRACE_MS)
  sess.cleanupTimer.unref()
}

async function runReal(sess: CloakSession): Promise<void> {
  const signal = sess.abort.signal
  const log = getLogger().child({ mod: 'cloak', sid: sess.id })
  let ctx: RuntimeBrowserContext | null = null
  try {
    emit(sess, 'starting', { message: '正在启动无头浏览器…' })
    log.info('launching ephemeral browser context')

    ctx = await launchEphemeralContext({ headless: true })
    throwIfAborted(signal)
    log.info('browser context launched, opening douyin.com')

    const page = await ctx.newPage()

    // ★ 导入 Cookie 模式：先注入插件 cookie，再打开抖音
    // 标记: CLOAK_IMPORT_COOKIE_INJECT
    if (sess.importAccountId) {
      const { getPrisma } = await import('../core/db.js')
      const prisma = getPrisma()
      const acc = await prisma.douyinAccount.findUnique({ where: { id: sess.importAccountId } })
      if (acc?.cookieEnc) {
        const cookieStr = getDecryptedCookie(sess.localUserId, acc)
        if (cookieStr) {
          const { parseCookieToEntries } = await import('./browser.runtime.js')
          await ctx.addCookies(parseCookieToEntries(cookieStr))
          log.info({ accountId: sess.importAccountId }, 'imported plugin cookie into CloakBrowser')
          emit(sess, 'starting', { message: '已注入 Cookie，正在打开抖音…' })
        }
      }
    }

    await page.goto('https://www.douyin.com/', {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_GOTO_TIMEOUT
    })
    throwIfAborted(signal)
    log.info('douyin.com loaded, hydrating in background')

    // 不显式等 header；clickLoginButton 用 Playwright auto-wait 自带元素就绪检测，
    // 真到了 hydration 慢，那也是它在那 5s 内等，少一次串行等待。
    throwIfAborted(signal)

    // 如果已经登录（极少见，但有可能 cookies 残留），直接走 success 路径
    const earlyCookies = await ctx.cookies('https://www.douyin.com/')
    if (earlyCookies.some((c: RuntimeCookie) => c.name === 'sessionid' && c.value)) {
      log.info('early cookies hit, skipping QR')
      await finishWithCookies(sess, ctx, page)
      return
    }

    // 触发登录弹窗
    log.info('clicking login button')
    await clickLoginButton(page)
    throwIfAborted(signal)

    // 等二维码渲染并截图
    log.info('waiting for QR canvas')
    const qrShot = await captureQrImage(page, sess.id)
    throwIfAborted(signal)
    log.info({ bytes: qrShot.length }, 'QR captured')
    emit(sess, 'waiting_qr', {
      qrImage: `data:image/png;base64,${qrShot.toString('base64')}`,
      message: '请用抖音 App 扫码登录'
    })

    // 轮询 cookie
    const start = Date.now()
    while (Date.now() - start < QR_WAIT_MS) {
      throwIfAborted(signal)
      await wait(POLL_INTERVAL_MS, signal)
      const cookies = await ctx.cookies('https://www.douyin.com/')
      if (cookies.some((c: RuntimeCookie) => c.name === 'sessionid' && c.value)) {
        log.info('sessionid cookie detected; awaiting full cookie set')
        emit(sess, 'confirmed', { message: '扫码成功，正在保存账号…' })
        // 抖音 post-login 会一次性下发 sessionid + sid_guard + uid_tt + passport_csrf_token 等
        // 一整套；只等 sessionid 一项就走，抖音侧常会返回 status_code:8 用户未登录。
        await waitForFullCookieSet(ctx, signal, sess.id)
        await finishWithCookies(sess, ctx, page)
        return
      }
    }

    log.warn('QR timed out')
    emit(sess, 'timeout', { message: '二维码已过期，请重试或改用手动粘贴' })
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      log.info('cloak session aborted')
      return
    }
    const msg = e instanceof AppError ? e.message : `扫码失败：${(e as Error).message}`
    log.error({ err: e }, 'cloak session failed')
    emit(sess, 'failed', { message: msg })
  } finally {
    scheduleCleanup(sess)
    if (ctx) await closeContext(ctx)
  }
}

async function clickLoginButton(page: RuntimePage): Promise<void> {
  // text 引擎走 Playwright auto-wait——元素一就绪就 click，5s 是上限不是常态
  for (const text of ['扫码登录', '登录'] as const) {
    try {
      await page.getByText(text, { exact: true }).first().click({ timeout: 5_000 })
      getLogger().info({ text }, 'cloak: login clicked via text engine')
      return
    } catch { /* 尝试下一个 */ }
  }
  // 备选：DOM selectors
  for (const sel of LOGIN_BUTTON_SELECTORS) {
    try {
      await page.locator(sel).first().click({ timeout: 1_500 })
      getLogger().info({ sel }, 'cloak: login button clicked')
      return
    } catch { /* 尝试下一个 */ }
  }
  // 真的全 miss → 落一张全页截图供事后排查
  const shotPath = await dumpDebugScreenshot(page, 'login-miss').catch(() => null)
  throw new AppError(
    ERR.DOUYIN_BROWSER_UNAVAILABLE,
    `页面没有可点击的登录按钮（DOM 可能已变更）${shotPath ? `，调试截图：${shotPath}` : ''}`,
    503
  )
}

async function dumpDebugScreenshot(page: RuntimePage, tag: string): Promise<string> {
  const dir = join(process.env.ARCHIVE_ROOT || tmpdir(), 'debug', 'cloak')
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${tag}-${Date.now()}.png`)
  const buf = await page.screenshot({ type: 'png', fullPage: true })
  await writeFile(file, buf)
  // 同步把 HTML 也存一份，对比 selector 用
  try {
    const html = await page.content()
    await writeFile(file.replace(/\.png$/, '.html'), html, 'utf8')
  } catch { /* ignore */ }
  getLogger().warn({ shot: file, tag }, 'cloak: dumped debug screenshot')
  return file
}

async function saveQrPreview(buf: Buffer, sid: string): Promise<string | null> {
  try {
    const dir = join(process.env.ARCHIVE_ROOT || tmpdir(), 'debug', 'cloak')
    await mkdir(dir, { recursive: true })
    const file = join(dir, `qr-${sid}.png`)
    await writeFile(file, buf)
    return file
  } catch {
    return null
  }
}

async function captureQrImage(page: RuntimePage, sid: string): Promise<Buffer> {
  const log = getLogger().child({ mod: 'cloak', sid })

  // 1) 先等 modal 出现 —— 它几乎一定能匹配，作为「登录弹窗已弹出」的锚点
  const modal = page.locator('[class*="login" i], [class*="modal" i]').first()
  try {
    await modal.waitFor({ state: 'visible', timeout: 4_000 })
  } catch {
    const shotPath = await dumpDebugScreenshot(page, 'qr-miss').catch(() => null)
    throw new AppError(
      ERR.DOUYIN_BROWSER_UNAVAILABLE,
      `登录弹窗未弹出${shotPath ? `，调试截图：${shotPath}` : ''}`,
      503
    )
  }
  log.info('modal visible, scanning for QR inside')

  // 2) 在 modal 内快速扫具体 QR 元素，每个 300ms 即放弃；最优先试通用 canvas
  let buf: Buffer | null = null
  let matched = ''
  for (const sel of QR_SELECTORS) {
    try {
      const loc = modal.locator(sel).first()
      await loc.waitFor({ state: 'visible', timeout: 300 })
      buf = await loc.screenshot({ type: 'png' })
      matched = sel
      break
    } catch { /* 尝试下一个 */ }
  }

  // 3) 全 miss：截 modal 的左半边（抖音登录弹窗 QR 在左侧）
  if (!buf) {
    const box = await modal.boundingBox()
    if (box && box.width > 0 && box.height > 0) {
      const halfWidth = Math.max(1, Math.floor(box.width / 2))
      buf = await page.screenshot({
        type: 'png',
        clip: { x: box.x, y: box.y, width: halfWidth, height: box.height }
      })
      matched = 'modal-left-half'
      log.warn({ box, clipWidth: halfWidth }, 'QR fallback: modal left half')
    } else {
      buf = await modal.screenshot({ type: 'png' })
      matched = 'modal-full'
      log.warn('QR fallback: modal full (boundingBox unavailable)')
    }
  }

  // 4) 校验 PNG 头 + 落盘 + 日志路径，便于眼见为实
  const isPng = buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  const file = await saveQrPreview(buf, sid)
  log.info({ matched, bytes: buf.length, isPng, file }, 'QR captured')
  return buf
}

async function finishWithCookies(
  sess: CloakSession,
  ctx: RuntimeBrowserContext,
  page: RuntimePage
): Promise<void> {
  const log = getLogger().child({ mod: 'cloak', sid: sess.id })
  const cookies = await ctx.cookies('https://www.douyin.com/')
  const cookieNames = cookies.filter((c: RuntimeCookie) => c.value).map((c: RuntimeCookie) => c.name)
  log.info({ cookieNames, count: cookieNames.length }, 'cookies collected for binding')
  const cookieStr = cookies
    .filter((c: RuntimeCookie) => c.name && c.value)
    .map((c: RuntimeCookie) => `${c.name}=${c.value}`)
    .join('; ')
  if (!cookieStr) {
    throw new AppError(ERR.DOUYIN_COOKIE_INVALID, '浏览器未返回任何 cookie', 401)
  }
  const parsed = parseCookieString(cookieStr)
  if (parsed.missing.length > 0) {
    throw new AppError(
      ERR.DOUYIN_COOKIE_INCOMPLETE,
      `cookie 缺少字段：${parsed.missing.join(', ')}`,
      400
    )
  }

  // 解析身份。优先级：
  //   1) API /user/profile/self/ 走 page.evaluate(fetch) —— cookie 直接决定身份，唯一可信源。
  //   2) navigate /user/self → URL 重定向抠 secUid。
  //   3) DOM/HTML 扫描 —— 不可信，页面 DOM 里有大量推荐流别人的 sec_uid，本次只在兜底里用且打 warn。
  // 之前先 navigate 后 API：navigate 的 DOM fallback 会撞到推荐流里别人的 user link，导致绑到别人的账号。
  let secUid: string
  let nickname: string
  let avatarUrl: string | null = null
  try {
    const profile = await fetchProfileInPage(page, sess.id)
    const u = profile.user
    if (!u?.sec_uid) {
      throw new AppError(
        ERR.DOUYIN_COOKIE_INVALID,
        'cookie 校验失败：profile/self 未返回 sec_uid',
        401
      )
    }
    secUid = u.sec_uid
    nickname = u.nickname || '抖音用户'
    avatarUrl = u.avatar_300x300?.url_list?.[0] ?? u.avatar_thumb?.url_list?.[0] ?? null
    log.info({ secUid, nickname, source: 'api' }, 'profile resolved via API')
  } catch (apiErr) {
    log.warn({ err: apiErr }, 'API profile failed, falling back to navigation')
    const info = await extractProfileViaNavigation(page, sess.id)
    secUid = info.secUid
    nickname = info.nickname
    avatarUrl = info.avatarUrl
    log.info({ secUid, nickname, source: 'navigation' }, 'profile resolved via navigation')
  }

  let account
  if (sess.importAccountId) {
    account = await bindFromCookie({
      localUserId: sess.localUserId,
      accountId: sess.importAccountId,
      cookie: cookieStr,
      source: 'cloak',
      preserveProfile: true
    })
    log.info({ accountId: account.id, secUid, nickname }, 'import-cookie: account updated with new cookie')
  } else {
    account = await upsertAccount({
      localUserId: sess.localUserId,
      secUid,
      nickname,
      avatarUrl,
      cookieEnc: await import('./cookie-codec.js').then(({ encryptCookieFor }) =>
        encryptCookieFor(sess.localUserId, cookieStr.trim())
      ),
      cookieSource: 'cloak',
      isValid: true
    })
  }
  emit(sess, 'success', { accountId: account.id, message: '账号已保存' })
}

async function extractProfileViaNavigation(
  page: RuntimePage,
  sid: string
): Promise<{ secUid: string; nickname: string; avatarUrl: string | null }> {
  const log = getLogger().child({ mod: 'cloak', sid })
  // 抖音「我的主页」入口；已登录有两种行为：
  //   1) URL 重定向 /user/self → /user/<secUid>
  //   2) URL 不变（React 客户端路由），但页面里会有 <a href="/user/MS4w...">、
  //      window.__INITIAL_STATE__、或 meta link 之类的载体
  // 我们两边都试。
  await page.goto('https://www.douyin.com/user/self', {
    waitUntil: 'domcontentloaded',
    timeout: 20_000
  })
  await page
    .waitForURL(/\/user\/[A-Za-z0-9_-]{30,}/, { timeout: 8_000 })
    .catch(() => { /* 客户端路由不变 URL；走 DOM 兜底 */ })
  await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => { /* ignore */ })

  let secUid: string | null = null
  let source = ''

  // 1) URL 直读
  const url = page.url()
  const m = url.match(/\/user\/([A-Za-z0-9_-]{30,})/)
  if (m?.[1]) {
    secUid = m[1]
    source = 'url'
  }

  // 2) DOM / window 兜底：在页面里找一切看起来像 sec_uid 的字符串
  if (!secUid) {
    const found = await page.evaluate(() => {
      const SEC_UID_RE = /[A-Za-z0-9_-]{40,}/
      const doc = (globalThis as unknown as {
        document: {
          querySelectorAll(selector: string): Iterable<unknown>
          querySelector(selector: string): { href?: string } | null
          getElementById(id: string): { textContent: string | null } | null
          documentElement: { outerHTML: string }
        }
      }).document
      // a) <a href="/user/<secUid>">
      for (const a of Array.from(doc.querySelectorAll('a[href*="/user/"]')) as Array<{
        getAttribute(name: string): string | null
      }>) {
        const href = a.getAttribute('href') || ''
        const mm = href.match(/\/user\/([A-Za-z0-9_-]{30,})/)
        if (mm?.[1] && mm[1] !== 'self') return { secUid: mm[1], source: 'dom-anchor' }
      }
      // b) <link rel="canonical" href=".../user/<secUid>">
      const canon = doc.querySelector('link[rel="canonical"]')
      if (canon?.href) {
        const mm = canon.href.match(/\/user\/([A-Za-z0-9_-]{30,})/)
        if (mm?.[1] && mm[1] !== 'self') return { secUid: mm[1], source: 'canonical' }
      }
      // c) window.__INIT_PROPS__ / __INITIAL_STATE__ / RENDER_DATA
      const wins = globalThis as unknown as Record<string, unknown>
      const candidates = ['__INIT_PROPS__', '__INITIAL_STATE__', '__RENDER_DATA__', '__pace_f']
      for (const key of candidates) {
        const v = wins[key]
        if (v) {
          try {
            const s = JSON.stringify(v)
            const mm = s.match(/"sec_uid"\s*:\s*"([A-Za-z0-9_-]{40,})"/)
            if (mm?.[1] && SEC_UID_RE.test(mm[1])) {
              return { secUid: mm[1], source: `window.${key}` }
            }
          } catch { /* circular */ }
        }
      }
      // d) <script id="RENDER_DATA"> 整段扒
      const renderScript = doc.getElementById('RENDER_DATA')
      if (renderScript?.textContent) {
        try {
          const decoded = decodeURIComponent(renderScript.textContent)
          const mm = decoded.match(/"sec_uid"\s*:\s*"([A-Za-z0-9_-]{40,})"/)
          if (mm?.[1]) return { secUid: mm[1], source: 'RENDER_DATA' }
        } catch { /* ignore */ }
      }
      // e) 全 HTML 一刀
      const html = doc.documentElement.outerHTML
      const mm = html.match(/"sec_uid"\s*:\s*"([A-Za-z0-9_-]{40,})"/)
      if (mm?.[1]) return { secUid: mm[1], source: 'html-scan' }
      return null
    })
    if (found?.secUid) {
      secUid = found.secUid
      source = found.source
    }
  }

  if (!secUid) {
    // 全 miss → 落 HTML + 截图供事后排查（不打 cookie 值）
    const dumpPath = await dumpDebugScreenshot(page, 'user-self-no-sec-uid').catch(() => null)
    throw new AppError(
      ERR.DOUYIN_COOKIE_INVALID,
      `/user/self 未能解析出 sec_uid（停留在 ${url}）${dumpPath ? `，调试截图：${dumpPath}` : ''}`,
      401
    )
  }
  log.info({ secUid, url, source }, 'sec_uid extracted')

  const nickname = await pickText(page, [
    '[data-e2e="user-info"] h1',
    '[data-e2e="user-detail"] h1',
    'h1[data-e2e="user-name"]',
    'div[class*="UserInfo"] h1',
    'div[class*="user-info"] h1',
    'h1'
  ])
  const avatarUrl = await pickAttr(page, 'src', [
    '[data-e2e="user-avatar"] img',
    'img[class*="avatar"][src*="aweme"]',
    'img[alt*="头像"]',
    'img[class*="Avatar"]'
  ])

  return {
    secUid,
    nickname: nickname || '抖音用户',
    avatarUrl
  }
}

async function pickText(page: RuntimePage, sels: readonly string[]): Promise<string | null> {
  for (const s of sels) {
    try {
      const t = await page.locator(s).first().textContent({ timeout: 800 })
      const trimmed = t?.trim()
      if (trimmed) return trimmed
    } catch { /* try next */ }
  }
  return null
}

async function pickAttr(
  page: RuntimePage,
  attr: string,
  sels: readonly string[]
): Promise<string | null> {
  for (const s of sels) {
    try {
      const v = await page.locator(s).first().getAttribute(attr, { timeout: 800 })
      if (v) return v
    } catch { /* try next */ }
  }
  return null
}

async function fetchProfileInPage(
  page: RuntimePage,
  sid: string
): Promise<ProfileSelfRaw> {
  const log = getLogger().child({ mod: 'cloak', sid })
  const path =
    '/aweme/v1/web/user/profile/self/?publish_video_strategy_type=2&source=channel_pc_web'
  // 抖音的「我的信息」接口要求 a_bogus 签名；放在页面里 fetch，由 douyin 的 JS 自动加签。
  // 刚登录瞬间 webmssdk / 服务端 session 可能还在生效中，做递增退避重试。
  const BACKOFFS = [0, 1200, 2000, 3000] // 共 4 次，总等待 ~6.2s
  let lastErr: Error | null = null
  let lastStatusCode: number | undefined
  let lastSample = ''
  for (let attempt = 0; attempt < BACKOFFS.length; attempt++) {
    if (BACKOFFS[attempt]) {
      await new Promise((r) => setTimeout(r, BACKOFFS[attempt]))
    }
    let res: { status: number; raw: string }
    try {
      res = await page.evaluate(async (p: string) => {
        const r = await fetch(p, {
          credentials: 'include',
          headers: { accept: 'application/json, text/plain, */*' }
        })
        const text = await r.text()
        return { status: r.status, raw: text }
      }, path)
    } catch (e) {
      lastErr = e as Error
      log.warn({ attempt, err: e }, 'profile fetch threw, retrying')
      continue
    }
    if (res.status < 200 || res.status >= 300) {
      log.warn({ attempt, status: res.status, sample: res.raw.slice(0, 400) }, 'profile non-2xx')
      lastSample = res.raw.slice(0, 400)
      continue
    }
    let parsed: ProfileSelfRaw
    try {
      parsed = JSON.parse(res.raw) as ProfileSelfRaw
    } catch {
      log.warn({ attempt, sample: res.raw.slice(0, 400) }, 'profile non-JSON')
      lastSample = res.raw.slice(0, 400)
      continue
    }
    lastStatusCode = parsed.status_code
    if (parsed.user?.sec_uid) {
      log.info(
        { attempt, statusCode: parsed.status_code, nickname: parsed.user.nickname },
        'profile ok'
      )
      return parsed
    }
    lastSample = res.raw.slice(0, 400)
    log.warn(
      { attempt, statusCode: parsed.status_code, sample: lastSample },
      'profile lacks sec_uid'
    )
  }
  if (lastErr) {
    throw new AppError(
      ERR.DOUYIN_COOKIE_INVALID,
      `profile 接口连续失败：${lastErr.message}`,
      401
    )
  }
  // 终态：4 次都拿不到 sec_uid。把现场塞到 message 里方便 UI 直接看
  throw new AppError(
    ERR.DOUYIN_COOKIE_INVALID,
    `cookie 校验失败：抖音侧未识别为已登录用户（status_code=${lastStatusCode ?? '?'}, sample=${lastSample.slice(0, 120)}）`,
    401
  )
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
}

// 抖音 web 登录成功后会一次性下发 sessionid + 一系列「passport 套件」cookie。
// 仅有 sessionid 时去 fetch profile，抖音侧返回 status_code:8 用户未登录。
// 这里等到至少一个「身份/CSRF 标记」cookie 落地（最多 10s），否则带 warning 继续。
const FULL_COOKIE_MARKERS = ['passport_csrf_token', 'sid_guard', 'uid_tt'] as const
async function waitForFullCookieSet(
  ctx: RuntimeBrowserContext,
  signal: AbortSignal,
  sid: string
): Promise<void> {
  const log = getLogger().child({ mod: 'cloak', sid })
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    throwIfAborted(signal)
    const cookies = await ctx.cookies('https://www.douyin.com/')
    const names = new Set(cookies.filter((c: RuntimeCookie) => c.value).map((c: RuntimeCookie) => c.name))
    const hits = FULL_COOKIE_MARKERS.filter((n) => names.has(n))
    if (hits.length > 0) {
      log.info({ markers: hits, cookieCount: names.size }, 'full cookie set landed')
      return
    }
    await wait(500, signal)
  }
  const finalCookies = await ctx.cookies('https://www.douyin.com/')
  log.warn(
    { names: finalCookies.map((c: RuntimeCookie) => c.name) },
    'full cookie set did not appear within 10s; proceeding anyway'
  )
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const t = setTimeout(() => resolve(), ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true }
    )
  })
}
