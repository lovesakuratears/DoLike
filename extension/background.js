// DoLike 扩展 service worker
//
// 职责：
//   1) 接收 popup / content-script 的消息，调度 chrome.scripting 把 collectors.js
//      注入到 douyin.com 页面的 MAIN world（让请求由页面发出，自动签名）
//   2) 把采集到的 items 透传给 lib/push.js → POST /api/bridge/push
//   3) 提供 Cookie 采集（M1 自动，M2/M3/M4 备用）
//
// 关键约束：service worker 没有 DOM，也无法直接做有签名的 douyin 请求。所有抓取
// 必须经由 chrome.scripting.executeScript({world:'MAIN', ...}) 在抖音页面里跑。

import { pushToBackend } from './lib/push.js'
import { loadConfig, isTokenLikelyValid } from './lib/config.js'
import {
  collectCookiesMethod1,
  collectCookiesMethod2,
  collectCookiesMethod3,
  collectCookiesMethod4,
  collectAllCookies,
  cookiesToString
} from './lib/cookie-collectors.js'

const DOUYIN_HOST_RE = /^https:\/\/www\.douyin\.com\//

// ─── Tab 工具 ────────────────────────────────────────────────────────

async function findDouyinTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.douyin.com/*' })
  if (tabs.length === 0) return null
  return tabs.find(t => t.active) || tabs[0]
}

async function ensureDouyinTab() {
  const tab = await findDouyinTab()
  if (!tab) {
    throw new Error('未找到打开的抖音标签页 —— 请先打开 https://www.douyin.com/ 并登录')
  }
  if (!tab.id || !DOUYIN_HOST_RE.test(tab.url || '')) {
    throw new Error('当前抖音标签未就绪，请刷新后重试')
  }
  return tab
}

async function injectCollectors(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN', files: ['lib/collectors.page.js']
  })
}

async function runInPage(tabId, func, args = []) {
  const [{ result, error }] = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN', func, args
  })
  if (error) throw new Error(error.message || String(error))
  return result
}

async function callCollector(tabId, name, args) {
  await injectCollectors(tabId)
  const wrapped = async (fnName, fnArgs) => {
    try {
      const api = window.__DOLIKE__
      if (!api || typeof api[fnName] !== 'function') {
        return { ok: false, error: `collector ${fnName} 未注入` }
      }
      const data = await api[fnName](...fnArgs)
      return { ok: true, data }
    } catch (e) {
      return { ok: false, error: e?.message || String(e) }
    }
  }
  const res = await runInPage(tabId, wrapped, [name, args || []])
  if (!res?.ok) throw new Error(res?.error || '采集失败')
  return res.data
}

// ─── 原有业务：init / push ───────────────────────────────────────────

async function actionInit() {
  const tab = await ensureDouyinTab()
  const profile = await callCollector(tab.id, 'collectSelfProfile', [])
  const initPayload = {
    type: 'init',
    secUid: profile.secUid,
    nickname: profile.nickname,
    avatarUrl: profile.avatarUrl || undefined
  }
  // 注意：不再传 cookie，因为 chrome.cookies API 拿不到 HttpOnly 的 sessionid
  // Cookie 需要在 portal 页面手动粘贴
  const dto = await pushToBackend(initPayload)
  return { profile, dto }
}

async function actionPushList(linkKind) {
  const tab = await ensureDouyinTab()
  const profile = await callCollector(tab.id, 'collectSelfProfile', [])

  let items = []
  if (linkKind === 'POST') {
    items = await callCollector(tab.id, 'collectPostList', [profile.secUid, { maxPages: 200 }])
  } else if (linkKind === 'LIKE') {
    items = await callCollector(tab.id, 'collectLikeList', [profile.secUid, { maxPages: 200 }])
  } else if (linkKind === 'FAVORITE') {
    items = await callCollector(tab.id, 'collectCollectVideoList', [{ maxPages: 200 }])
  } else if (linkKind === 'WATCH_LATER') {
    items = await callCollector(tab.id, 'collectWatchLaterList', [{ maxPages: 200 }])
  } else if (linkKind === 'COLLECT_MUSIC') {
    items = await callCollector(tab.id, 'collectCollectMusicList', [{ maxPages: 200 }])
  } else if (linkKind === 'COLLECT_FOLDER') {
    items = await callCollector(tab.id, 'collectCollectFolderVideoList', [{ maxPages: 200 }])
  } else {
    throw new Error(`不支持的 linkKind: ${linkKind}`)
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { profile, pushed: 0, dto: null, empty: true }
  }
  const dto = await pushToBackend({ type: 'increment', linkKind, items })
  return { profile, pushed: items.length, dto }
}

async function handleSignedProxy(path, query) {
  const { backendUrl, pushToken } = await loadConfig()
  if (!isTokenLikelyValid(pushToken)) return { error: '未配置 API Key' }
  const resp = await fetch(`${backendUrl}/api/bridge/proxy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-push-token': pushToken },
    body: JSON.stringify({ path, query })
  })
  const json = await resp.json()
  if (json?.code === 0 && json?.data) return json.data.data
  return { error: json?.message || `HTTP ${resp.status}`, status: resp.status }
}

// ─── Cookie 采集消息处理 ─────────────────────────────────────────────
// 标记: COOKIE_COLLECT_HANDLER
// M1 由 popup 在绑定插件时自动调用（COOKIE_AUTO_COLLECT_ON_INIT）
// M2/M3/M4 通过高级折叠区手动触发（COOKIE_ADVANCED_METHODS）

async function handleCollectCookies(msg) {
  const { method, cdpPort } = msg

  if (method === 'all') {
    const methods = msg.includeNative ? [1, 2, 3, 4] : [1, 2, 3]
    const { results, errors } = await collectAllCookies({
      methods, cdpPort: cdpPort || 9222, domain: 'douyin.com'
    })
    return { results, errors }
  }

  let result
  switch (method) {
    case 1: result = await collectCookiesMethod1('douyin.com'); break
    case 2: result = collectCookiesMethod2(); break
    case 3: result = await collectCookiesMethod3(cdpPort || 9222); break
    case 4: result = await collectCookiesMethod4(); break
    default: throw new Error(`未知采集方法: ${method}`)
  }
  return { results: [result], errors: [] }
}

// ─── 消息路由 ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  ;(async () => {
    try {
      if (msg?.type === 'init') {
        const r = await actionInit()
        sendResponse({ ok: true, data: r })
      } else if (msg?.type === 'push') {
        const r = await actionPushList(msg.linkKind)
        sendResponse({ ok: true, data: r })
      } else if (msg?.type === 'ping') {
        sendResponse({ ok: true, data: { ts: Date.now() } })
      } else if (msg?.type === 'signedProxy') {
        const data = await handleSignedProxy(msg.path, msg.query)
        sendResponse(data)
      } else if (msg?.type === 'collectCookies') {
        // 标记: COOKIE_COLLECT_HANDLER_ENTRY
        const data = await handleCollectCookies(msg)
        sendResponse({ ok: true, data })
      } else {
        sendResponse({ ok: false, error: 'unknown message type' })
      }
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || String(e) })
    }
  })()
  return true
})
