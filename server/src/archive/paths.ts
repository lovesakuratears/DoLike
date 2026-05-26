// 归档路径推导（纯函数，不接触 fs）
//
// 物理树（见 docs/PRD.md §3.6）：
//   <archiveRoot>/accounts/<secUid>/<bucket>/<YYYY>/<YYYY-MM>/<awemeId>/{video.mp4,cover.jpg,meta.json}
//
// linkKind → bucket 映射（M2 范围：POST/LIKE/FAVORITE/WATCH_LATER）。
// 其余 linkKind（COLLECT_*）M4 再补 —— 当前不抛错只返回 'unknown'，调用方先用兜底。

import { join } from 'node:path'
import type { LinkKind } from './types.js'

export type Bucket =
  | 'posts'
  | 'likes'
  | 'favorites'
  | 'watch_later'
  | 'music'
  | 'mixes_created'
  | 'mixes_collected'
  | 'unknown'

export function bucketOf(linkKind: LinkKind, opts: { folderId?: string | null; mixId?: string | null } = {}): Bucket {
  switch (linkKind) {
    case 'POST':
      return 'posts'
    case 'LIKE':
      return 'likes'
    case 'FAVORITE':
    case 'COLLECT_FOLDER':
      return 'favorites'
    case 'WATCH_LATER':
      return 'watch_later'
    case 'COLLECT_MUSIC':
      return 'music'
    case 'SELF_MIX':
      return 'mixes_created'
    case 'COLLECT_MIX':
      return 'mixes_collected'
    default:
      void opts
      return 'unknown'
  }
}

export interface DirInput {
  archiveRoot: string
  secUid: string
  bucket: Bucket
  publishAt: Date
  awemeId: string
  folderId?: string | null
  mixId?: string | null
}

export function awemeDir(input: DirInput): string {
  const yyyy = String(input.publishAt.getUTCFullYear())
  const mm = String(input.publishAt.getUTCMonth() + 1).padStart(2, '0')
  const ym = `${yyyy}-${mm}`
  const parts: string[] = [input.archiveRoot, 'accounts', input.secUid, input.bucket]
  if (input.bucket === 'favorites' && input.folderId) parts.push(input.folderId)
  if ((input.bucket === 'mixes_created' || input.bucket === 'mixes_collected') && input.mixId) {
    parts.push(input.mixId)
  }
  parts.push(yyyy, ym, input.awemeId)
  return join(...parts)
}

export const FILE_NAMES = {
  video: 'video.mp4',
  audio: 'audio.mp3',
  cover: 'cover.jpg',
  meta: 'meta.json'
} as const

export function awemeFile(dir: string, name: keyof typeof FILE_NAMES): string {
  return join(dir, FILE_NAMES[name])
}

// archiveRoot 相对路径，供 /media 静态分发用
export function relToAccounts(absPath: string, archiveRoot: string): string {
  const root = join(archiveRoot, 'accounts')
  if (!absPath.startsWith(root)) return absPath
  return absPath.slice(root.length + 1)
}
