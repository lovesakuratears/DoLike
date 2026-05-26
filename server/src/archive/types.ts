// 公共类型 —— 与 Prisma schema 中的字符串枚举对齐
// 注意：Prisma SQLite 不支持原生 enum，schema 里都是 String。这里集中维护字面量。

export type ContentKind = 'VIDEO' | 'MUSIC' | 'MIX_VIDEO'

export type LinkKind =
  | 'POST'
  | 'LIKE'
  | 'FAVORITE'
  | 'WATCH_LATER'
  | 'COLLECT_FOLDER'
  | 'COLLECT_MUSIC'
  | 'COLLECT_MIX'
  | 'SELF_MIX'

export type DownloadKind = 'video' | 'cover' | 'audio'

export type ContentStatus = 'pending' | 'downloading' | 'done' | 'failed'

export type TaskStatus = 'queued' | 'running' | 'done' | 'failed'
