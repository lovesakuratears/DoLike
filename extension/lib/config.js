// 扩展配置读写 —— 通过 chrome.storage.local 持久化

const KEYS = {
  backendUrl: 'backendUrl',
  pushToken: 'pushToken',
  cookie: 'cookie'
}

const DEFAULTS = {
  backendUrl: 'http://127.0.0.1:7777',
  pushToken: ''
}

export async function loadConfig() {
  const got = await chrome.storage.local.get([KEYS.backendUrl, KEYS.pushToken, KEYS.cookie])
  return {
    backendUrl: (got[KEYS.backendUrl] || DEFAULTS.backendUrl).replace(/\/$/, ''),
    pushToken: got[KEYS.pushToken] || DEFAULTS.pushToken,
    cookie: got[KEYS.cookie] || ''
  }
}

export async function saveConfig(cfg) {
  const payload = {}
  if (typeof cfg.backendUrl === 'string') payload[KEYS.backendUrl] = cfg.backendUrl.trim().replace(/\/$/, '')
  if (typeof cfg.pushToken === 'string') payload[KEYS.pushToken] = cfg.pushToken.trim()
  if (typeof cfg.cookie === 'string') payload[KEYS.cookie] = cfg.cookie.trim()
  await chrome.storage.local.set(payload)
}

export function isTokenLikelyValid(token) {
  return typeof token === 'string' && /^pt_/.test(token) && token.length >= 8
}
