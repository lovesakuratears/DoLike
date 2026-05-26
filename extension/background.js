// DoLike 扩展 service worker
//
// 职责：
//   1) 接收 popup / content-script 的消息，调度 chrome.scripting 把 collectors.js
//      注入到 douyin.com 页面的 MAIN world（让请求由页面发出，自动签名）
//   2) 把采集到的 items 透传给 lib/push.js → POST /api/bridge/push
//
// 关键约束：service worker 没有 DOM，也无法直接做有签名的 douyin 请求。所有抓取
// 必须经由 chrome.scripting.executeScript({world:'MAIN', ...}) 在抖音页面里跑。

import { pushToBackend } from './lib/push.js'

const DOUYIN_HOST_RE = /^https:\/\/www\.douyin\.com\//

async function findDouyinTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.douyin.com/*' })
  if (tabs.length === 0) return null
  // 优先取 active 且 highlighted 的
  const active = tabs.find(t => t.active) || tabs[0]
  return active
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
    target: { tabId },
    world: 'MAIN',
    files: ['lib/collectors.page.js']
  })
}

async function runInPage(tabId, func, args = []) {
  const [{ result, error }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func,
    args
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

async function actionInit() {
  const tab = await ensureDouyinTab()
  const profile = await callCollector(tab.id, 'collectSelfProfile', [])
  const dto = await pushToBackend({
    type: 'init',
    secUid: profile.secUid,
    nickname: profile.nickname,
    avatarUrl: profile.avatarUrl || undefined
  })
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
  } else if (linkKind === 'COLLECT_FOLDER') {
    items = await callCollector(tab.id, 'collectCollectFolderVideoList', [{ maxPages: 200 }])
  } else {
    throw new Error(`不支持的 linkKind: ${linkKind}`)
  }

  if (!Array.isArray(items) || items.length === 0) {
    return { profile, pushed: 0, dto: null, empty: true }
  }
  const dto = await pushToBackend({
    type: 'increment',
    linkKind,
    items
  })
  return { profile, pushed: items.length, dto }
}

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
      } else {
        sendResponse({ ok: false, error: 'unknown message type' })
      }
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || String(e) })
    }
  })()
  return true
})
