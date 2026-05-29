// HTTP push 客户端 —— 向 DoLike 后端 /api/bridge/push 推送 init / increment 包

import { loadConfig, isTokenLikelyValid } from './config.js'

const REQUEST_TIMEOUT_MS = 10000

async function fetchJsonWithTimeout(url, options, timeoutLabel) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS)
  try {
    const resp = await fetch(url, {
      ...options,
      signal: ctl.signal
    })
    let body = null
    try {
      body = await resp.json()
    } catch {
      // ignore
    }
    return { resp, body }
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`${timeoutLabel}超时（${REQUEST_TIMEOUT_MS / 1000}s）`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export async function handshakeBackend() {
  const { backendUrl, pushToken } = await loadConfig()
  if (!isTokenLikelyValid(pushToken)) {
    throw new Error('未配置 API Key，请在扩展弹窗中填写')
  }
  if (!backendUrl) {
    throw new Error('未配置项目 URL')
  }
  try {
    const { resp, body } = await fetchJsonWithTimeout(`${backendUrl}/api/bridge/handshake`, {
      method: 'GET',
      headers: {
        'x-push-token': pushToken
      }
    }, '握手请求')
    if (!resp.ok || body?.code !== 0) {
      throw new Error(body?.message || `HTTP ${resp.status}`)
    }
    return body.data
  } catch (err) {
    throw new Error(`无法连接到项目 URL：${backendUrl}。请确认后端已启动、地址可访问，并且扩展已放行该域名。原始错误：${err?.message || String(err)}`)
  }
}

export async function pushToBackend(payload) {
  const { backendUrl, pushToken } = await loadConfig()
  if (!isTokenLikelyValid(pushToken)) {
    throw new Error('未配置 API Key，请在扩展弹窗中填写')
  }
  if (!backendUrl) {
    throw new Error('未配置项目 URL')
  }
  const url = `${backendUrl}/api/bridge/push`
  try {
    const { resp, body } = await fetchJsonWithTimeout(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-push-token': pushToken
      },
      body: JSON.stringify(payload)
    }, '推送请求')
    if (!resp.ok) {
      const msg = body?.message || `HTTP ${resp.status}`
      throw new Error(msg)
    }
    if (body?.code !== 0) {
      throw new Error(body?.message || '推送失败')
    }
    return body.data
  } catch (err) {
    throw new Error(`推送失败：无法连接到 ${backendUrl}。请确认后端正在运行，且扩展配置的 URL 与权限一致。原始错误：${err?.message || String(err)}`)
  }
}
