// lib/cookie-collectors.js
//
// ═══════════════════════════════════════════════════════════════════════
// Cookie 采集模块 — 四种方式
// ═══════════════════════════════════════════════════════════════════════
//
// ★ 当前使用：方法1（M1 chrome.cookies API）
//   - 在「绑定插件」时自动调用（COOKIE_AUTO_COLLECT_ON_INIT）
//   - 无需用户手动操作
//
// ★ 备用方法：M2/M3/M4 代码已保留，UI 默认折叠隐藏
//   - 需要时展开弹窗底部「高级 Cookie 采集方式」即可使用
//   - 标记: COOKIE_ADVANCED_METHODS
//
// 四种方式按能力排列：
//   M1 — chrome.cookies API（官方推荐，当前使用）
//   M2 — webRequest 拦截请求头（能拿 HttpOnly）
//   M3 — CDP 远程调试协议（Network.getAllCookies，本地最强）
//   M4 — Native Messaging 读 SQLite（终极，需本地客户端）
// ═══════════════════════════════════════════════════════════════════════

// ─── 方法1：chrome.cookies API ────────────────────────────────────────
// 标记: COOKIE_COLLECT_M1
// 当前默认使用。需要 "cookies" 权限。
// 只能拿同源非 HttpOnly cookie。

export async function collectCookiesMethod1(domain = 'douyin.com') {
  // ★ 用 url 参数获取完整 cookie（包括 .douyin.com 父域的 HttpOnly cookie）
  // domain 参数只匹配精确域，url 参数匹配所有相关域
  const allCookies = []
  const seen = new Set()

  // 用多个 url 确保覆盖所有 cookie 域
  const urls = [
    `https://www.${domain}/`,
    `https://${domain}/`,
    `https://m.${domain}/`,
  ]

  for (const url of urls) {
    try {
      const cookies = await chrome.cookies.getAll({ url })
      for (const c of cookies) {
        const key = `${c.name}=${c.domain}=${c.path}`
        if (!seen.has(key)) {
          allCookies.push(c)
          seen.add(key)
        }
      }
    } catch (e) {
      console.warn('[DoLike] collectCookiesMethod1 url failed:', url, e)
    }
  }

  return {
    method: 'chrome.cookies API',
    cookies: allCookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      expirationDate: c.expirationDate
    })),
    count: allCookies.length
  }
}

// ─── 方法2：webRequest 拦截请求头 ─────────────────────────────────────
// 标记: COOKIE_COLLECT_M2
// 备用。需要 "webRequest" 权限。
// 能拿到 HttpOnly cookie（从请求头里读）。
// 需要先访问 douyin.com 产生请求，否则缓存为空。

let method2Cookies = []
let method2ListenerRegistered = false

function registerMethod2Listener() {
  if (method2ListenerRegistered) return
  method2ListenerRegistered = true

  chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      if (details.type !== 'main_frame' && details.type !== 'xmlhttprequest') return
      const cookieHeader = details.requestHeaders?.find(
        h => h.name.toLowerCase() === 'cookie'
      )
      if (cookieHeader?.value) {
        const pairs = cookieHeader.value.split(';').map(s => s.trim())
        const parsed = {}
        for (const pair of pairs) {
          const eqIdx = pair.indexOf('=')
          if (eqIdx > 0) {
            parsed[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim()
          }
        }
        method2Cookies.push({
          url: details.url,
          tabId: details.tabId,
          timestamp: Date.now(),
          cookies: parsed
        })
        if (method2Cookies.length > 50) method2Cookies = method2Cookies.slice(-50)
      }
    },
    { urls: ['*://*.douyin.com/*'] },
    ['requestHeaders', 'extraHeaders']
  )
}

registerMethod2Listener()

export function collectCookiesMethod2() {
  const allCookies = {}
  const sources = []
  for (const record of method2Cookies) {
    for (const [name, value] of Object.entries(record.cookies)) {
      if (!(name in allCookies)) {
        allCookies[name] = value
        sources.push({ name, url: record.url, ts: record.timestamp })
      }
    }
  }
  return {
    method: 'webRequest 拦截请求头',
    cookies: Object.entries(allCookies).map(([name, value]) => ({
      name, value,
      httpOnly: true,
      source: sources.find(s => s.name === name)?.url || ''
    })),
    count: Object.keys(allCookies).length,
    requestCount: method2Cookies.length
  }
}

// ─── 方法3：CDP 远程调试协议 ──────────────────────────────────────────
// 标记: COOKIE_COLLECT_M3
// 备用。需要 Chrome 以 --remote-debugging-port=9222 启动。
// 通过 WebSocket 调用 Network.getAllCookies，拿浏览器完整 Cookie 库。

export async function collectCookiesMethod3(port = 9222) {
  let targets
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/json`)
    targets = await resp.json()
  } catch (e) {
    throw new Error(
      `无法连接到 Chrome 远程调试端口 ${port}。\n` +
      `请用以下命令重新启动 Chrome：\n` +
      `/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=${port}\n` +
      `原始错误：${e.message}`
    )
  }

  const target = targets.find(t => t.webSocketDebuggerUrl)
  if (!target) throw new Error('未找到可用的 Chrome 调试目标')

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error('CDP WebSocket 连接超时（5s）'))
    }, 5000)

    ws.onopen = () => {
      clearTimeout(timeout)
      ws.send(JSON.stringify({ id: 1, method: 'Network.getAllCookies' }))
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.id === 1) {
          ws.close()
          if (msg.error) {
            reject(new Error(`CDP 错误：${msg.error.message}`))
            return
          }
          const cookies = msg.result?.cookies || []
          resolve({
            method: 'CDP 远程调试协议 (Network.getAllCookies)',
            cookies: cookies.map(c => ({
              name: c.name, value: c.value, domain: c.domain,
              path: c.path, secure: c.secure, httpOnly: c.httpOnly,
              sameSite: c.sameSite, partitionKey: c.partitionKey,
              expirationDate: c.expires
            })),
            count: cookies.length,
            sourceTarget: target.url || target.title || '(未知目标)'
          })
        }
      } catch (e) {
        reject(new Error(`CDP 响应解析失败：${e.message}`))
      }
    }

    ws.onerror = (e) => {
      clearTimeout(timeout)
      reject(new Error(`CDP WebSocket 连接失败：${e.message || '未知错误'}`))
    }
  })
}

// ─── 方法4：Native Messaging ──────────────────────────────────────────
// 标记: COOKIE_COLLECT_M4
// 备用。需要安装本地 Python 客户端 + 注册清单文件。
// 直接读取 Chrome Cookies SQLite 数据库并解密。

export async function collectCookiesMethod4() {
  const HOST_NAME = 'com.dolike.cookie_reader'

  return new Promise((resolve, reject) => {
    let port
    try {
      port = chrome.runtime.connectNative(HOST_NAME)
    } catch (e) {
      reject(new Error(
        `无法连接到 Native Messaging 主机 "${HOST_NAME}"。\n` +
        `请先安装本地 Cookie 读取客户端（见 native-host/install.sh）。\n` +
        `原始错误：${e.message}`
      ))
      return
    }

    const timeout = setTimeout(() => {
      port.disconnect()
      reject(new Error('Native Messaging 连接超时（10s）'))
    }, 10000)

    port.onMessage.addListener((msg) => {
      clearTimeout(timeout)
      port.disconnect()
      if (msg?.error) {
        reject(new Error(`本地程序错误：${msg.error}`))
        return
      }
      resolve({
        method: 'Native Messaging（本地 SQLite 读取）',
        cookies: (msg?.cookies || []).map(c => ({
          name: c.name, value: c.value, domain: c.domain,
          path: c.path, secure: c.secure, httpOnly: c.httpOnly,
          sameSite: c.sameSite, expirationDate: c.expirationDate,
          encrypted: c.encrypted || false
        })),
        count: msg?.cookies?.length || 0,
        source: msg?.source || 'Chrome Cookies SQLite 数据库',
        browserProfile: msg?.profilePath || ''
      })
    })

    port.onDisconnect.addListener(() => {
      clearTimeout(timeout)
      if (chrome.runtime.lastError) {
        reject(new Error(
          `Native Messaging 断开：${chrome.runtime.lastError.message}\n` +
          `请确认本地客户端已安装且清单文件已注册。`
        ))
      }
    })

    port.postMessage({ action: 'getAllCookies' })
  })
}

// ─── 统一采集入口 ────────────────────────────────────────────────────

export async function collectAllCookies(options = {}) {
  const {
    methods = [1, 2, 3],
    cdpPort = 9222,
    domain = 'douyin.com'
  } = options

  const results = []
  const errors = []

  for (const method of methods) {
    try {
      let result
      switch (method) {
        case 1: result = await collectCookiesMethod1(domain); break
        case 2: result = collectCookiesMethod2(); break
        case 3: result = await collectCookiesMethod3(cdpPort); break
        case 4: result = await collectCookiesMethod4(); break
        default: errors.push({ method, error: '未知方法' }); continue
      }
      results.push(result)
    } catch (e) {
      errors.push({ method, error: e.message })
    }
  }

  return { results, errors }
}

// ─── 工具 ────────────────────────────────────────────────────────────

export function cookiesToString(cookies) {
  return cookies.map(c => `${c.name}=${c.value}`).join('; ')
}
