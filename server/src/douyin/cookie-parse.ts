// 解析 / 序列化 Douyin web cookie 字符串
// 输入示例： "sessionid=xxx; ttwid=yyy; msToken=zzz"

const REQUIRED = ['sessionid'] as const

export interface ParsedCookies {
  map: Record<string, string>
  raw: string
  missing: string[]
}

export function parseCookieString(raw: string): ParsedCookies {
  const map: Record<string, string> = {}
  const text = (raw || '').trim()
  if (text) {
    for (const seg of text.split(/;\s*/)) {
      if (!seg) continue
      const eq = seg.indexOf('=')
      if (eq <= 0) continue
      const k = seg.slice(0, eq).trim()
      const v = seg.slice(eq + 1).trim()
      if (k) map[k] = v
    }
  }
  const missing = REQUIRED.filter((k) => !map[k])
  return { map, raw: text, missing }
}

export function serializeCookies(map: Record<string, string>): string {
  return Object.entries(map)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

export function mergeCookies(base: string, patch: string): string {
  const a = parseCookieString(base).map
  const b = parseCookieString(patch).map
  return serializeCookies({ ...a, ...b })
}
