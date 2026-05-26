import { request } from 'undici'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const SHARE_HOSTS = new Set([
  'v.douyin.com',
  'v.iesdouyin.com',
  'www.iesdouyin.com',
  'iesdouyin.com'
])

export interface NoWatermarkResolveResult {
  videoUrl: string
  strategy:
    | 'replace-playwm'
    | 'resolve-redirect-and-replace'
    | 'share-link-iteminfo'
    | 'aweme-iteminfo'
    | 'passthrough-no-id'
    | 'passthrough-fetch-failed'
}

interface ItemInfoVideo {
  play_addr?: { url_list?: string[]; uri?: string }
  play_addr_h264?: { url_list?: string[]; uri?: string }
  play_addr_lowbr?: { url_list?: string[]; uri?: string }
  download_addr?: { url_list?: string[]; uri?: string }
  bit_rate?: Array<{ play_addr?: { url_list?: string[]; uri?: string }; bit_rate?: number }>
}

function replacePlaywm(url: string): string {
  return url.replace('/playwm/', '/play/').replace('playwm?', 'play?')
}

function buildUriPlayUrl(uri?: string): string | null {
  if (!uri) return null
  return `https://aweme.snssdk.com/aweme/v1/play/?video_id=${encodeURIComponent(uri)}&ratio=1080p&line=0`
}

function firstUrl(...lists: Array<string[] | undefined>): string | null {
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    const hit = list.find((item) => typeof item === 'string' && item)
    if (hit) return hit
  }
  return null
}

function extractAwemeIdFromUrl(url: URL): string | null {
  const pathHit = /\/video\/(\d{8,22})/.exec(url.pathname)?.[1]
  if (pathHit) return pathHit
  const noteHit = /\/note\/(\d{8,22})/.exec(url.pathname)?.[1]
  if (noteHit) return noteHit
  const modalId = url.searchParams.get('modal_id')
  if (modalId && /^\d{8,22}$/.test(modalId)) return modalId
  return null
}

async function resolveFinalUrl(url: string): Promise<string> {
  const resp = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: { 'user-agent': UA }
  })
  return resp.url || url
}

async function expandShareLink(url: string): Promise<string> {
  const parsed = new URL(url)
  if (!SHARE_HOSTS.has(parsed.hostname)) return url

  const bodyResp = await request(url, {
    method: 'GET',
    maxRedirections: 5,
    headers: { 'user-agent': UA }
  })
  const body = await bodyResp.body.text()
  const bodyMatch = body.match(/https?:\/\/www\.douyin\.com\/(?:video|note)\/\d+[^\s"'<>]*/i)?.[0]
  if (bodyMatch) return bodyMatch

  return resolveFinalUrl(url)
}

function pickBestVideoUrl(video: ItemInfoVideo | undefined): string | null {
  if (!video) return null

  const bitRates = Array.isArray(video.bit_rate) ? [...video.bit_rate] : []
  bitRates.sort((a, b) => Number(b?.bit_rate || 0) - Number(a?.bit_rate || 0))
  for (const item of bitRates) {
    const uriUrl = buildUriPlayUrl(item?.play_addr?.uri)
    if (uriUrl) return uriUrl
    const direct = firstUrl(item?.play_addr?.url_list)
    if (direct) return replacePlaywm(direct)
  }

  const uriDirect = [
    buildUriPlayUrl(video.play_addr_h264?.uri),
    buildUriPlayUrl(video.play_addr?.uri),
    buildUriPlayUrl(video.play_addr_lowbr?.uri),
    buildUriPlayUrl(video.download_addr?.uri)
  ].find(Boolean)
  if (uriDirect) return uriDirect

  const direct = firstUrl(
    video.play_addr_h264?.url_list,
    video.play_addr?.url_list,
    video.play_addr_lowbr?.url_list,
    video.download_addr?.url_list
  )
  return direct ? replacePlaywm(direct) : null
}

async function fetchByAwemeId(awemeId: string): Promise<string | null> {
  const api = `https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=${encodeURIComponent(awemeId)}`
  const resp = await fetch(api, {
    headers: { 'user-agent': UA }
  })
  if (!resp.ok) return null
  const json = await resp.json() as { item_list?: Array<{ video?: ItemInfoVideo }> }
  return pickBestVideoUrl(json?.item_list?.[0]?.video)
}

export async function resolveNoWatermarkVideo(
  inputUrl: string,
  rawAwemeId?: string | null
): Promise<NoWatermarkResolveResult> {
  if (inputUrl.includes('/playwm/') || inputUrl.includes('playwm?')) {
    return { videoUrl: replacePlaywm(inputUrl), strategy: 'replace-playwm' }
  }

  const expandedUrl = await expandShareLink(inputUrl)
  const finalUrl = await resolveFinalUrl(expandedUrl)
  if (finalUrl.includes('/playwm/') || finalUrl.includes('playwm?')) {
    return { videoUrl: replacePlaywm(finalUrl), strategy: 'resolve-redirect-and-replace' }
  }

  let awemeId = rawAwemeId || null
  if (!awemeId) {
    try {
      awemeId = extractAwemeIdFromUrl(new URL(finalUrl))
    } catch {
      awemeId = null
    }
  }
  if (!awemeId) {
    return { videoUrl: finalUrl, strategy: 'passthrough-no-id' }
  }

  const parsed = await fetchByAwemeId(awemeId)
  if (!parsed) {
    return { videoUrl: finalUrl, strategy: 'passthrough-fetch-failed' }
  }

  return {
    videoUrl: parsed,
    strategy: expandedUrl !== inputUrl ? 'share-link-iteminfo' : 'aweme-iteminfo'
  }
}
