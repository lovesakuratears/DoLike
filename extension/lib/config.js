// 扩展配置读写 —— 通过 chrome.storage.local 持久化

const KEYS = {
  backendUrl: 'backendUrl',
  pushToken: 'pushToken'
}

const DEFAULTS = {
  backendUrl: 'http://127.0.0.1:7777',
  pushToken: ''
}

export async function loadConfig() {
  const got = await chrome.storage.local.get([KEYS.backendUrl, KEYS.pushToken])
  return {
    backendUrl: (got[KEYS.backendUrl] || DEFAULTS.backendUrl).replace(/\/$/, ''),
    pushToken: got[KEYS.pushToken] || DEFAULTS.pushToken
  }
}

export async function saveConfig(cfg) {
  const payload = {}
  if (typeof cfg.backendUrl === 'string') payload[KEYS.backendUrl] = cfg.backendUrl.trim().replace(/\/$/, '')
  if (typeof cfg.pushToken === 'string') payload[KEYS.pushToken] = cfg.pushToken.trim()
  await chrome.storage.local.set(payload)
}

export function isTokenLikelyValid(token) {
  return typeof token === 'string' && /^pt_/.test(token) && token.length >= 8
}
