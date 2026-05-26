import { getLogger } from '../core/logger.js'
import { getParserEndpoint, markParserState, type DownloadMode } from './mode.service.js'

interface ParserResp {
  data?: {
    video_url?: string
    url?: string
    strategy?: string
  }
  video_url?: string
  url?: string
  strategy?: string
}

function pickParsedUrl(payload: ParserResp): string | null {
  const url = payload?.data?.video_url || payload?.data?.url || payload?.video_url || payload?.url || ''
  return typeof url === 'string' && url.startsWith('http') ? url : null
}

export async function resolveVideoSource(
  inputUrl: string,
  mode: DownloadMode,
  awemeId?: string
): Promise<{ url: string; resolvedBy: 'compatible' | 'enhanced' | 'fallback'; strategy?: string }> {
  if (mode === 'compatible') return { url: inputUrl, resolvedBy: 'compatible' }
  const endpoint = getParserEndpoint()
  if (!endpoint) {
    markParserState('unknown')
    getLogger().child({ mod: 'download' }).warn('enhanced mode enabled but MEDIA_PARSER_ENDPOINT is empty; fallback to compatible')
    return { url: inputUrl, resolvedBy: 'fallback' }
  }
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 8_000)
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: inputUrl, awemeId: awemeId || null }),
      signal: ctl.signal
    })
    clearTimeout(timer)
    if (!resp.ok) {
      markParserState('unreachable')
      return { url: inputUrl, resolvedBy: 'fallback' }
    }
    const json = await resp.json() as ParserResp
    const parsed = pickParsedUrl(json)
    if (!parsed) {
      markParserState('unreachable')
      return { url: inputUrl, resolvedBy: 'fallback' }
    }
    markParserState('available')
    return { url: parsed, resolvedBy: 'enhanced', strategy: json?.data?.strategy || json?.strategy }
  } catch {
    markParserState('unreachable')
    return { url: inputUrl, resolvedBy: 'fallback' }
  }
}
