// 把抖音原始 aweme 字段映射到我们的 ContentInput / LinkInput
//
// 设计原则：
// - 不强依赖抖音字段完整存在；缺字段时给安全默认值
// - 不解释字段含义，只搬运
// - rawMeta 完整保留 JSON.stringify(item)，将来字段漂移可回头解析

import type { ContentKind, LinkKind } from './types.js'

// 抖音字段是动态的，这里只声明我们会读的部分（其余 passthrough）
export interface RawAwemeLike {
  aweme_id?: string
  desc?: string
  create_time?: number | string
  author?: {
    sec_uid?: string
    nickname?: string
    uid?: string
  }
  video?: {
    duration?: number // ms
    play_addr?: { url_list?: string[]; uri?: string }
    play_addr_h264?: { url_list?: string[]; uri?: string }
    play_addr_lowbr?: { url_list?: string[]; uri?: string }
    download_addr?: { url_list?: string[]; uri?: string }
    cover?: { url_list?: string[] }
    origin_cover?: { url_list?: string[] }
    dynamic_cover?: { url_list?: string[] }
    cdn_url_expired?: number // unix sec
    bit_rate?: Array<{ play_addr?: { url_list?: string[]; uri?: string }; bit_rate?: number; gear_name?: string }>
  }
  music?: {
    play_url?: { url_list?: string[]; uri?: string }
    duration?: number
    title?: string
    author?: string
  }
  [key: string]: unknown
}

export interface ContentInput {
  awemeId: string
  kind: ContentKind
  title: string
  desc: string | null
  authorSecUid: string
  authorName: string
  durationSec: number
  publishAt: Date
  mediaUrl: string | null
  mediaUrlExpiredAt: Date | null
  coverUrl: string | null
  rawMeta: string
}

export interface LinkInput {
  linkKind: LinkKind
  folderId?: string | null
  mixId?: string | null
}

function firstUrl(...lists: Array<string[] | undefined>): string | null {
  for (const list of lists) {
    if (list && list.length > 0 && list[0]) return list[0]
  }
  return null
}

function buildUriPlayUrl(uri?: string): string | null {
  if (!uri) return null
  return `https://aweme.snssdk.com/aweme/v1/play/?video_id=${encodeURIComponent(uri)}&ratio=1080p&line=0`
}

function pickBestVideoUrl(video: RawAwemeLike['video']): string | null {
  if (!video) return null
  if (video.bit_rate && video.bit_rate.length > 0) {
    const sorted = [...video.bit_rate].sort((a, b) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0))
    for (const item of sorted) {
      const uriUrl = buildUriPlayUrl(item.play_addr?.uri)
      if (uriUrl) return uriUrl
    }
    const bitRateUrl = firstUrl(...sorted.map((item) => item.play_addr?.url_list))
    if (bitRateUrl) return bitRateUrl
  }
  const uriDirect = [
    buildUriPlayUrl(video.play_addr_h264?.uri),
    buildUriPlayUrl(video.play_addr?.uri),
    buildUriPlayUrl(video.play_addr_lowbr?.uri),
    buildUriPlayUrl(video.download_addr?.uri)
  ].find(Boolean)
  if (uriDirect) return uriDirect
  // Douyin 场景下通常 play_addr / bit_rate 比 download_addr 更可能是干净源；
  // download_addr 留作兜底，避免默认落到带水印下载链。
  const direct = firstUrl(
    video.play_addr_h264?.url_list,
    video.play_addr?.url_list,
    video.play_addr_lowbr?.url_list,
    video.download_addr?.url_list
  )
  if (direct) return direct
  return null
}

function parseCreateTime(raw: number | string | undefined): Date {
  if (raw == null) return new Date()
  const n = typeof raw === 'string' ? Number(raw) : raw
  if (!Number.isFinite(n) || n <= 0) return new Date()
  // 抖音 create_time 是秒
  return new Date(n * 1000)
}

function safeTitle(desc: string | undefined, fallback: string): string {
  const t = (desc ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return fallback
  return t.length > 80 ? t.slice(0, 80) : t
}

export function normalizeVideoAweme(item: RawAwemeLike): ContentInput {
  const awemeId = String(item.aweme_id ?? '')
  const video = item.video
  const durationMs = typeof video?.duration === 'number' ? video.duration : 0
  const publishAt = parseCreateTime(item.create_time)
  const mediaUrl = pickBestVideoUrl(video)
  const coverUrl = firstUrl(
    video?.origin_cover?.url_list,
    video?.cover?.url_list,
    video?.dynamic_cover?.url_list
  )
  // 抖音 cdn_url_expired 不一定提供；保守 5 小时
  const expireSec = video?.cdn_url_expired
  const mediaUrlExpiredAt = expireSec && Number.isFinite(expireSec)
    ? new Date(expireSec * 1000)
    : new Date(Date.now() + 5 * 60 * 60 * 1000)

  return {
    awemeId,
    kind: 'VIDEO',
    title: safeTitle(item.desc, awemeId || 'untitled'),
    desc: item.desc ?? null,
    authorSecUid: item.author?.sec_uid ?? '',
    authorName: item.author?.nickname ?? '',
    durationSec: Math.max(0, Math.round(durationMs / 1000)),
    publishAt,
    mediaUrl,
    mediaUrlExpiredAt,
    coverUrl,
    rawMeta: JSON.stringify(item)
  }
}
