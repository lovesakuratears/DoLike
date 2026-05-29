import { loadConfig, saveConfig, isTokenLikelyValid } from './lib/config.js'
import { handshakeBackend } from './lib/push.js'

const LOG_KEY = 'popupLogs'
const MAX_LOGS = 12

const $ = id => document.getElementById(id)

const elBackend = $('backendUrl')
const elToken = $('pushToken')
const elCookie = $('cookie')
const elStatus = $('status')
const elLogs = $('logs')
const elConnLamp = $('connLamp')
const elConnText = $('connText')
const elCdpPort = $('cdpPort')
const elCookieBadge = $('cookieBadge')
const elCookieCount = $('cookieCount')
const elCookieResult = $('cookieResult')
const elCookieStatusHint = $('cookieStatusHint')

function nowText() {
  const d = new Date()
  return d.toLocaleTimeString('zh-CN', { hour12: false })
}

async function loadLogs() {
  const got = await chrome.storage.local.get([LOG_KEY])
  return Array.isArray(got[LOG_KEY]) ? got[LOG_KEY] : []
}

async function saveLogs(logs) {
  await chrome.storage.local.set({ [LOG_KEY]: logs.slice(0, MAX_LOGS) })
}

async function appendLog(level, title, detail) {
  const next = [{
    at: nowText(), level, title, detail: detail || ''
  }, ...(await loadLogs())].slice(0, MAX_LOGS)
  await saveLogs(next)
  renderLogs(next)
}

function renderLogs(logs) {
  elLogs.innerHTML = ''
  if (!logs.length) {
    const li = document.createElement('li')
    li.className = 'log-item'
    li.textContent = '暂无日志'
    elLogs.appendChild(li)
    return
  }
  for (const log of logs) {
    const li = document.createElement('li')
    li.className = 'log-item'
    li.innerHTML = `
      <div class="log-head">
        <span class="tag ${log.level === 'ok' ? 'ok' : log.level === 'err' ? 'err' : ''}">${log.title}</span>
        <span class="mono">${log.at}</span>
      </div>
      <div>${escapeHtml(log.detail || '')}</div>
    `
    elLogs.appendChild(li)
  }
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function setLamp(kind, text) {
  elConnLamp.className = `lamp${kind ? ` ${kind}` : ''}`
  elConnText.textContent = text
}

function setStatus(text, kind = '') {
  elStatus.textContent = text
  elStatus.className = `status-box${kind ? ` ${kind}` : ''}`
}

async function init() {
  const cfg = await loadConfig()
  elBackend.value = cfg.backendUrl
  elToken.value = cfg.pushToken
  elCookie.value = cfg.cookie || ''
  renderLogs(await loadLogs())
  if (!cfg.pushToken) {
    setLamp('', '未配置')
    setStatus('请先填写 API Key 和项目 URL。')
  } else if (!isTokenLikelyValid(cfg.pushToken)) {
    setLamp('err', 'Key 异常')
    setStatus('API Key 格式异常，应以 pt_开头。', 'err')
  } else {
    setLamp('', '待测试')
    setStatus('配置已加载，点击「测试握手」验证。')
  }
}

async function persistConfig() {
  await saveConfig({
    backendUrl: elBackend.value,
    pushToken: elToken.value,
    cookie: elCookie.value
  })
  setStatus('配置已保存。')
  await appendLog('info', '保存配置', `URL=${elBackend.value || '(空)'}，Cookie ${elCookie.value ? '已填写' : '未填写'}`)
}

async function doHandshake() {
  setLamp('', '检测中')
  setStatus('正在测试插件与项目握手…')
  try {
    const dto = await handshakeBackend()
    setLamp('ok', '已连通')
    setStatus(`握手成功。\n账号：${dto.nickname}\n来源：${dto.cookieSource}\nsecUid：${dto.secUid}`, 'ok')
    await appendLog('ok', '握手成功', `账号 ${dto.nickname} (${dto.secUid})`)
  } catch (e) {
    const msg = e?.message || String(e)
    setLamp('err', '未连通')
    setStatus(`握手失败：${msg}`, 'err')
    await appendLog('err', '握手失败', msg)
  }
}

// ─── Cookie 采集（M1 chrome.cookies API） ────────────────────────────
// 标记: COOKIE_COLLECT_M1 — 绑定插件时自动调用，获取 douyin.com Cookie

// ─── 发送消息到 background ──────────────────────────────────────────
function sendAction(payload, label) {
  if (!chrome?.runtime?.id || typeof chrome.runtime.sendMessage !== 'function') {
    const msg = '扩展上下文已失效，请在 chrome://extensions 里重新加载 DoLike 扩展'
    setStatus(msg, 'err')
    void appendLog('err', label, msg)
    return
  }
  console.log('[DoList] popup sendAction:', payload.type, payload.linkKind || '')
  setStatus(`${label}中…`)
  let settled = false
  const timer = setTimeout(() => {
    if (settled) return
    settled = true
    const msg = `${label}超时：后台脚本未返回结果，请先到 chrome://extensions 查看 DoLike 扩展的 Service Worker 日志`
    setStatus(msg, 'err')
    void appendLog('err', label, msg)
  }, 12000)
  chrome.runtime.sendMessage(payload, resp => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    console.log('[DoList] popup response:', resp)
    handleResponse(resp, label, payload.type)
  })
}

// Cookie 绑定已改为在 portal 页面手动粘贴

function handleResponse(resp, label, type) {
  if (chrome.runtime.lastError) {
    const msg = `扩展通信失败：${chrome.runtime.lastError.message}`
    setStatus(msg, 'err')
    appendLog('err', label, msg)
    return
  }
  if (resp?.ok) {
    let msg = type === 'ping' ? '抖音页面可用' : `${label}成功`
    if (type === 'init') {
      const nickname = resp?.data?.profile?.nickname || resp?.data?.dto?.nickname || '抖音用户'
      const cookieCollected = resp?.data?.cookieCollected
      msg = `绑定成功：${nickname}` + (cookieCollected ? '（已自动采集 Cookie）' : '（未采集到 Cookie，音乐下载可能不可用）')
    } else if (type === 'push') {
      const pushed = Number(resp?.data?.pushed || 0)
      const nickname = resp?.data?.profile?.nickname || '抖音用户'
      msg = pushed > 0
        ? `${label}成功：${nickname}，采集 ${pushed} 条`
        : `${label}成功：${nickname}，采集 0 条（请确认当前页面已加载对应列表）`
    } else if (type === 'pushCookie') {
      const nickname = resp?.data?.dto?.nickname || resp?.data?.profile?.nickname || '抖音用户'
      msg = `${label}成功：${nickname}，Cookie 已更新`
    }
    setStatus(msg, 'ok')
    appendLog('ok', label, msg)
  } else {
    const msg = `${label}失败：${resp?.error || '未知错误'}`
    setStatus(msg, 'err')
    appendLog('err', label, msg)
  }
}

// ─── 高级 Cookie 采集（M2/M3/M4，折叠区） ────────────────────────────
// 标记: COOKIE_ADVANCED_METHODS — 代码保留，UI 默认隐藏

async function collectCookiesAdvanced(method) {
  const label = `方法${method}采集`
  setStatus(`${label}中…`)
  if (!chrome?.runtime?.id || typeof chrome.runtime.sendMessage !== 'function') {
    const msg = '扩展上下文已失效，请在 chrome://extensions 里重新加载 DoLike 扩展'
    setStatus(msg, 'err')
    void appendLog('err', label, msg)
    return
  }

  const msg = {
    type: 'collectCookies',
    method: method === 'all' ? 'all' : Number(method),
    cdpPort: Number(elCdpPort?.value) || 9222
  }
  if (method === 'all') msg.includeNative = true

  chrome.runtime.sendMessage(msg, async resp => {
    if (chrome.runtime.lastError) {
      setStatus(`扩展通信失败：${chrome.runtime.lastError.message}`, 'err')
      return
    }
    if (resp?.ok) {
      const data = resp.data
      const totalCount = data.results?.reduce((sum, r) => sum + (r.count || 0), 0) || 0
      setStatus(`共拿到 ${totalCount} 个 Cookie`, totalCount > 0 ? 'ok' : 'err')
      appendLog(totalCount > 0 ? 'ok' : 'warn', label, `拿到 ${totalCount} 个 Cookie，${data.errors?.length || 0} 个方法失败`)

      // 自动填充
      for (const r of data.results || []) {
        if (r.cookies?.length > 0) {
          const cookieStr = r.cookies.map(c => `${c.name}=${c.value}`).join('; ')
          elCookie.value = cookieStr
          const cfg = await loadConfig()
          cfg.cookie = cookieStr
          await saveConfig(cfg)
          break
        }
      }
    } else {
      setStatus(`${label}失败：${resp?.error || '未知错误'}`, 'err')
      appendLog('err', label, resp?.error || '未知错误')
    }
  })
}

// ─── 事件绑定 ────────────────────────────────────────────────────────

$('save').addEventListener('click', persistConfig)
$('handshake').addEventListener('click', doHandshake)
$('clearLogs').addEventListener('click', async () => {
  await saveLogs([])
  renderLogs([])
  setStatus('日志已清空。')
})

document.querySelectorAll('button[data-act]').forEach(btn => {
  btn.addEventListener('click', () => {
    const act = btn.getAttribute('data-act')
    if (act === 'init') sendAction({ type: 'init' }, '绑定插件')
    else if (act === 'ping-page') sendAction({ type: 'ping' }, '检查抖音页')
    else if (act === 'push-cookie') sendAction({ type: 'pushCookie' }, '推送 Cookie')
    else if (act === 'push-post') sendAction({ type: 'push', linkKind: 'POST' }, '推送作品')
    else if (act === 'push-like') sendAction({ type: 'push', linkKind: 'LIKE' }, '推送喜欢')
    else if (act === 'push-favorite') sendAction({ type: 'push', linkKind: 'FAVORITE' }, '推送收藏')
    else if (act === 'push-watch-later') sendAction({ type: 'push', linkKind: 'WATCH_LATER' }, '推送稍后再看')
    else if (act === 'push-collect-folder') sendAction({ type: 'push', linkKind: 'COLLECT_FOLDER' }, '推送收藏夹视频')
  })
})

// 高级折叠区
$('advancedToggle')?.addEventListener('click', () => {
  const content = $('advancedContent')
  const toggle = $('advancedToggle')
  const arrow = toggle.querySelector('.arrow')
  const isOpen = content.classList.toggle('show')
  arrow.textContent = isOpen ? '▼' : '▶'
})

// 高级采集按钮
document.querySelectorAll('[data-cookie-method]').forEach(btn => {
  btn.addEventListener('click', () => {
    collectCookiesAdvanced(btn.getAttribute('data-cookie-method'))
  })
})
$('cookieCollectAllAdvanced')?.addEventListener('click', () => collectCookiesAdvanced('all'))

init()
