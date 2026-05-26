import { loadConfig, saveConfig, isTokenLikelyValid } from './lib/config.js'
import { handshakeBackend } from './lib/push.js'

const LOG_KEY = 'popupLogs'
const MAX_LOGS = 12

const $ = id => document.getElementById(id)

const elBackend = $('backendUrl')
const elToken = $('pushToken')
const elStatus = $('status')
const elLogs = $('logs')
const elConnLamp = $('connLamp')
const elConnText = $('connText')

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
    at: nowText(),
    level,
    title,
    detail: detail || ''
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
  renderLogs(await loadLogs())
  if (!cfg.pushToken) {
    setLamp('', '未配置')
    setStatus('请先填写 API Key 和项目 URL。')
  } else if (!isTokenLikelyValid(cfg.pushToken)) {
    setLamp('err', 'Key 异常')
    setStatus('API Key 格式异常，应以 pt_ 开头。', 'err')
  } else {
    setLamp('', '待测试')
    setStatus('配置已加载，点击“测试握手”验证。')
  }
}

async function persistConfig() {
  await saveConfig({
    backendUrl: elBackend.value,
    pushToken: elToken.value
  })
  setStatus('配置已保存。')
  await appendLog('info', '保存配置', `URL=${elBackend.value || '(空)'}，API Key 已更新`)
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

function sendAction(payload, label) {
  setStatus(`${label} 进行中…`)
  chrome.runtime.sendMessage(payload, async resp => {
    if (chrome.runtime.lastError) {
      const msg = `扩展通信失败：${chrome.runtime.lastError.message}`
      setStatus(msg, 'err')
      await appendLog('err', label, msg)
      return
    }
    if (resp?.ok) {
      let msg = payload.type === 'ping'
        ? '抖音页面可用'
        : `${label}成功`
      if (payload.type === 'init') {
        const nickname = resp?.data?.profile?.nickname || resp?.data?.dto?.nickname || '抖音用户'
        msg = `绑定成功：${nickname}`
      } else if (payload.type === 'push') {
        const pushed = Number(resp?.data?.pushed || 0)
        const nickname = resp?.data?.profile?.nickname || '抖音用户'
        msg = pushed > 0
          ? `${label}成功：${nickname}，采集 ${pushed} 条`
          : `${label}成功：${nickname}，采集 0 条（请确认当前页面已加载对应列表）`
      }
      setStatus(msg, 'ok')
      await appendLog('ok', label, msg)
    } else {
      const msg = `${label}失败：${resp?.error || '未知错误'}`
      setStatus(msg, 'err')
      await appendLog('err', label, msg)
    }
  })
}

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
    else if (act === 'push-post') sendAction({ type: 'push', linkKind: 'POST' }, '推送作品')
    else if (act === 'push-like') sendAction({ type: 'push', linkKind: 'LIKE' }, '推送喜欢')
    else if (act === 'push-favorite') sendAction({ type: 'push', linkKind: 'FAVORITE' }, '推送收藏')
    else if (act === 'push-watch-later') sendAction({ type: 'push', linkKind: 'WATCH_LATER' }, '推送稍后再看')
    else if (act === 'push-collect-folder') sendAction({ type: 'push', linkKind: 'COLLECT_FOLDER' }, '推送收藏夹视频')
  })
})

init()
