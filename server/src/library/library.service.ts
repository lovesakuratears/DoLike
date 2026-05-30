// Library —— 离线内容查询
//
// M2 范围：
//   listVideos({localUserId, contentKind?, linkKind?, length?, q?, sort?, page, size})
//   getContent(localUserId, id)
//
// 设计：
//   - 始终按 localUserId 过滤 → DouyinAccount → Content 链
//   - linkKind 走 ContentLink 子查询
//   - shortVideoSec 从 UserSetting 读，默认 60
//   - q 走 SQLite FTS5（title / desc / authorName）

import { getPrisma } from '../core/db.js'
import { promises as fs } from 'node:fs'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import { join } from 'node:path'
import { loadConfig } from '../config.js'
import { getLogger } from '../core/logger.js'
import type { ContentKind } from '../archive/types.js'

export interface ListVideosParams {
  localUserId: number
  contentKind?: ContentKind | 'all'
  linkKind?: 'POST' | 'LIKE' | 'FAVORITE' | 'WATCH_LATER' | 'all'
  length?: 'long' | 'short' | 'all'
  q?: string
  sort?: 'publish' | 'archived' | 'duration'
  page?: number
  size?: number
  accountId?: number  // 指定单个抖音账号
}

export interface VideoListItem {
  id: number
  awemeId: string
  title: string
  authorName: string
  durationSec: number
  publishAt: string
  archivedAt: string
  coverPath: string | null
  mediaPath: string | null
  status: string
  douyinAccountId: number
  linkKinds: string[]
}

export interface FolderListItem {
  id: number
  name: string
  itemCount: number
  updatedAt: string
  coverPath: string | null
}

export interface MixListItem {
  id: number
  mixId: string
  kind: string
  name: string
  authorName: string
  itemCount: number
  publishAt: string | null
  archivedAt: string
  coverPath: string | null
  douyinAccountId: number
}

export interface MixDetailResult {
  mix: MixListItem
  videos: ListVideosResult
}

export interface ListVideosResult {
  total: number
  page: number
  size: number
  items: VideoListItem[]
}

async function shortVideoThreshold(localUserId: number): Promise<number> {
  const prisma = getPrisma()
  const s = await prisma.userSetting.findUnique({ where: { userId: localUserId } })
  return s?.shortVideoSec ?? 60
}

function mapContentRow(r: {
  id: number
  awemeId: string
  title: string
  authorName: string
  durationSec: number
  publishAt: Date
  archivedAt: Date
  coverPath: string | null
  mediaPath: string | null
  status: string
  douyinAccountId: number
  links: Array<{ linkKind: string }>
}): VideoListItem {
  return {
    id: r.id,
    awemeId: r.awemeId,
    title: r.title,
    authorName: r.authorName,
    durationSec: r.durationSec,
    publishAt: r.publishAt.toISOString(),
    archivedAt: r.archivedAt.toISOString(),
    coverPath: r.coverPath,
    mediaPath: r.mediaPath,
    status: r.status,
    douyinAccountId: r.douyinAccountId,
    linkKinds: Array.from(new Set(r.links.map((l) => l.linkKind)))
  }
}

function buildFtsQuery(raw: string): string {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/["*]/g, '').trim())
    .filter(Boolean)
  if (tokens.length === 0) return ''
  return tokens.map((token) => `"${token}"*`).join(' AND ')
}

export async function listVideos(params: ListVideosParams): Promise<ListVideosResult> {
  const prisma = getPrisma()
  const page = Math.max(1, params.page ?? 1)
  const size = Math.min(100, Math.max(1, params.size ?? 20))
  const skip = (page - 1) * size

  const threshold = await shortVideoThreshold(params.localUserId)

  // douyinAccountId 过滤：取当前 user 的所有账号
  const accounts = await prisma.douyinAccount.findMany({
    where: { localUserId: params.localUserId, ...(params.accountId ? { id: params.accountId } : {}) },
    select: { id: true }
  })
  const accountIds = accounts.map((a: { id: number }) => a.id)
  if (accountIds.length === 0) {
    return { total: 0, page, size, items: [] }
  }

  // 构造 where
  const contentKind = params.contentKind && params.contentKind !== 'all' ? params.contentKind : 'VIDEO'
  const linkKind = params.linkKind && params.linkKind !== 'all' ? params.linkKind : undefined
  const where: any = {
    kind: contentKind,
    douyinAccountId: { in: accountIds },
    hidden: false
  }
  if (linkKind) {
    where.links = { some: { linkKind } }
  }
  if (params.length === 'long') where.durationSec = { gte: threshold }
  if (params.length === 'short') where.durationSec = { lt: threshold }
  if (params.q?.trim()) {
    const q = params.q.trim()
    // 用 contains 子串匹配替代 FTS5 前缀匹配，实现「标题含任意字符即返回」
    where.OR = [
      { title: { contains: q } },
      { authorName: { contains: q } },
    ]
  }

  // 排序
  let orderBy: any = { publishAt: 'desc' }
  if (params.sort === 'archived') orderBy = { archivedAt: 'desc' }
  if (params.sort === 'duration') orderBy = { durationSec: 'desc' }

  const [total, rows] = await Promise.all([
    prisma.content.count({ where }),
    prisma.content.findMany({
      where,
      orderBy,
      skip,
      take: size,
      include: { links: { select: { linkKind: true } } }
    })
  ])

  return {
    total,
    page,
    size,
    items: rows.map(mapContentRow)
  }
}

export async function getContent(localUserId: number, id: number): Promise<VideoListItem | null> {
  const prisma = getPrisma()
  const r = await prisma.content.findFirst({
    where: { id, hidden: false, douyinAccount: { localUserId } },
    include: { links: { select: { linkKind: true } } }
  })
  if (!r) return null
  return mapContentRow(r)
}

export async function listFolders(localUserId: number): Promise<FolderListItem[]> {
  const prisma = getPrisma()
  const rows = await prisma.localFolder.findMany({
    where: { localUserId },
    orderBy: { updatedAt: 'desc' },
    include: {
      _count: { select: { items: true } },
      items: {
        take: 1,
        orderBy: { createdAt: 'desc' },
        include: {
          content: {
            select: { coverPath: true }
          }
        }
      }
    }
  })
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    itemCount: row._count.items,
    updatedAt: row.updatedAt.toISOString(),
    coverPath: row.items[0]?.content.coverPath ?? null
  }))
}

export async function createFolder(localUserId: number, name: string): Promise<FolderListItem> {
  const prisma = getPrisma()
  const row = await prisma.localFolder.create({
    data: { localUserId, name: name.trim() },
    include: { _count: { select: { items: true } } }
  })
  return {
    id: row.id,
    name: row.name,
    itemCount: row._count.items,
    updatedAt: row.updatedAt.toISOString(),
    coverPath: null
  }
}

export async function listMixes(localUserId: number, accountId?: number): Promise<MixListItem[]> {
  const prisma = getPrisma()
  const rows = await prisma.mix.findMany({
    where: {
      douyinAccount: {
        localUserId,
        ...(accountId ? { id: accountId } : {})
      }
    },
    orderBy: [
      { archivedAt: 'desc' },
      { id: 'desc' }
    ]
  })

  return rows.map((row) => ({
    id: row.id,
    mixId: row.mixId,
    kind: row.kind,
    name: row.name,
    authorName: row.authorName,
    itemCount: row.itemCount,
    publishAt: row.publishAt ? row.publishAt.toISOString() : null,
    archivedAt: row.archivedAt.toISOString(),
    coverPath: row.coverPath,
    douyinAccountId: row.douyinAccountId
  }))
}

export async function listMixVideos(
  localUserId: number,
  mixDbId: number,
  page = 1,
  size = 20
): Promise<MixDetailResult | null> {
  const prisma = getPrisma()
  const safePage = Math.max(1, page)
  const safeSize = Math.min(100, Math.max(1, size))
  const skip = (safePage - 1) * safeSize

  const mix = await prisma.mix.findFirst({
    where: {
      id: mixDbId,
      douyinAccount: { localUserId }
    }
  })
  if (!mix) return null

  const where = {
    hidden: false,
    kind: 'VIDEO',
    douyinAccountId: mix.douyinAccountId,
    links: {
      some: {
        mixId: mix.mixId
      }
    }
  } as const

  const [total, rows] = await Promise.all([
    prisma.content.count({ where }),
    prisma.content.findMany({
      where,
      orderBy: { publishAt: 'desc' },
      skip,
      take: safeSize,
      include: { links: { select: { linkKind: true } } }
    })
  ])

  const fallbackCover = rows.find((row) => row.coverPath)?.coverPath ?? null
  const mixItem: MixListItem = {
    id: mix.id,
    mixId: mix.mixId,
    kind: mix.kind,
    name: mix.name,
    authorName: mix.authorName,
    itemCount: mix.itemCount,
    publishAt: mix.publishAt ? mix.publishAt.toISOString() : null,
    archivedAt: mix.archivedAt.toISOString(),
    coverPath: mix.coverPath ?? fallbackCover,
    douyinAccountId: mix.douyinAccountId
  }

  return {
    mix: mixItem,
    videos: {
      total,
      page: safePage,
      size: safeSize,
      items: rows.map(mapContentRow)
    }
  }
}

export async function renameFolder(localUserId: number, folderId: number, name: string): Promise<void> {
  const prisma = getPrisma()
  await prisma.localFolder.updateMany({
    where: { id: folderId, localUserId },
    data: { name: name.trim() }
  })
}

export async function deleteFolders(localUserId: number, folderIds: number[]): Promise<{ deleted: number }> {
  const prisma = getPrisma()
  const res = await prisma.localFolder.deleteMany({
    where: { id: { in: folderIds }, localUserId }
  })
  return { deleted: res.count }
}

export async function listFolderVideos(
  localUserId: number,
  folderId: number,
  page = 1,
  size = 20
): Promise<ListVideosResult> {
  const prisma = getPrisma()
  const safePage = Math.max(1, page)
  const safeSize = Math.min(100, Math.max(1, size))
  const skip = (safePage - 1) * safeSize
  const folder = await prisma.localFolder.findFirst({
    where: { id: folderId, localUserId },
    select: { id: true }
  })
  if (!folder) return { total: 0, page: safePage, size: safeSize, items: [] }

  const [total, rows] = await Promise.all([
    prisma.folderItem.count({
      where: {
        folderId,
        content: { hidden: false, kind: 'VIDEO' }
      }
    }),
    prisma.folderItem.findMany({
      where: {
        folderId,
        content: { hidden: false, kind: 'VIDEO' }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: safeSize,
      include: {
        content: {
          include: {
            links: { select: { linkKind: true } }
          }
        }
      }
    })
  ])

  return {
    total,
    page: safePage,
    size: safeSize,
    items: rows.map((row) => ({
      id: row.content.id,
      awemeId: row.content.awemeId,
      title: row.content.title,
      authorName: row.content.authorName,
      durationSec: row.content.durationSec,
      publishAt: row.content.publishAt.toISOString(),
      archivedAt: row.content.archivedAt.toISOString(),
      coverPath: row.content.coverPath,
      mediaPath: row.content.mediaPath,
      status: row.content.status,
      douyinAccountId: row.content.douyinAccountId,
      linkKinds: Array.from(new Set(row.content.links.map((l) => l.linkKind)))
    }))
  }
}

export async function addFolderItems(localUserId: number, folderId: number, contentIds: number[]): Promise<{ added: number }> {
  const prisma = getPrisma()
  const folder = await prisma.localFolder.findFirst({
    where: { id: folderId, localUserId },
    select: { id: true }
  })
  if (!folder) return { added: 0 }

  const contents = await prisma.content.findMany({
    where: {
      id: { in: contentIds },
      hidden: false,
      kind: 'VIDEO',
      douyinAccount: { localUserId }
    },
    select: { id: true }
  })
  const existing = await prisma.folderItem.findMany({
    where: {
      folderId,
      contentId: { in: contents.map((item) => item.id) }
    },
    select: { contentId: true }
  })
  const existingIds = new Set(existing.map((item) => item.contentId))
  const rows = contents
    .filter((item) => !existingIds.has(item.id))
    .map((item) => ({ folderId, contentId: item.id }))
  if (rows.length === 0) return { added: 0 }
  const res = await prisma.folderItem.createMany({
    data: rows
  })
  await prisma.localFolder.update({
    where: { id: folderId },
    data: { updatedAt: new Date() }
  })
  return { added: res.count }
}

export async function removeFolderItems(localUserId: number, folderId: number, contentIds: number[]): Promise<{ removed: number }> {
  const prisma = getPrisma()
  const folder = await prisma.localFolder.findFirst({
    where: { id: folderId, localUserId },
    select: { id: true }
  })
  if (!folder) return { removed: 0 }
  const res = await prisma.folderItem.deleteMany({
    where: { folderId, contentId: { in: contentIds } }
  })
  await prisma.localFolder.update({
    where: { id: folderId },
    data: { updatedAt: new Date() }
  })
  return { removed: res.count }
}

// 批量隐藏 —— 从「视频」Tab 移除，但保留 Content 行作为去重 tombstone
//
// 设计：
//   - 物理删本地文件（mp4 / jpg / 进行中的 .part）—— 释放磁盘
//   - 清掉与之挂钩的 DownloadTask（pump 不再选）
//   - Content 行保留并置 hidden=true / hiddenAt=now / mediaPath=null / coverPath=null / mediaSize=null
//   - ContentLink 行保留 —— 增量归档 loadKnownIds 仍会包含这个 awemeId，所以不会被重抓
//
// 安全：
//   - ownership 校验（按 localUserId 收窄 Content.douyinAccount）
//   - 路径必须落在 archiveRoot/accounts 下，防 ../ 越级
export async function hideContents(
  localUserId: number,
  ids: number[]
): Promise<{ hidden: number; skipped: number; freedBytes: number }> {
  const log = getLogger().child({ mod: 'library' })
  if (ids.length === 0) return { hidden: 0, skipped: 0, freedBytes: 0 }
  const prisma = getPrisma()
  const cfg = loadConfig()
  const accountsRoot = join(cfg.archiveRoot, 'accounts')

  const rows = await prisma.content.findMany({
    where: { id: { in: ids }, hidden: false, douyinAccount: { localUserId } },
    select: { id: true, mediaPath: true, coverPath: true }
  })
  const okIds = rows.map((r: { id: number }) => r.id)
  const skipped = ids.length - okIds.length

  // 收集待删文件
  const filesToDelete: string[] = []
  for (const r of rows) {
    if (r.mediaPath) {
      filesToDelete.push(join(accountsRoot, r.mediaPath))
      filesToDelete.push(join(accountsRoot, r.mediaPath + '.part'))
    }
    if (r.coverPath) {
      filesToDelete.push(join(accountsRoot, r.coverPath))
      filesToDelete.push(join(accountsRoot, r.coverPath + '.part'))
    }
  }

  let freedBytes = 0
  for (const p of filesToDelete) {
    if (!p.startsWith(accountsRoot + '/') && p !== accountsRoot) {
      log.warn({ p }, 'skipping file outside archiveRoot/accounts')
      continue
    }
    try {
      const st = await fs.stat(p)
      freedBytes += Number(st.size)
      await fs.unlink(p)
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'ENOENT') continue
      log.warn({ err: e, p }, 'unlink failed')
    }
  }

  if (okIds.length === 0) {
    return { hidden: 0, skipped, freedBytes }
  }

  // 软删 Content：保留 awemeId 用作去重 tombstone；同时清掉关联的 DownloadTask 防 pump 再选。
  await prisma.$transaction([
    prisma.downloadTask.deleteMany({ where: { contentId: { in: okIds } } }),
    prisma.content.updateMany({
      where: { id: { in: okIds } },
      data: {
        hidden: true,
        hiddenAt: new Date(),
        mediaPath: null,
        coverPath: null,
        mediaSize: null,
        status: 'hidden'
      }
    })
  ])
  log.info({ ids: okIds.length, freedBytes, skipped }, 'contents hidden')
  return { hidden: okIds.length, skipped, freedBytes }

}

// 从视频中提取音频（原声/BGM）保存为 MP3
//
// 完全解耦：不关联任何抖音账号，使用本地 ffmpeg 处理。
//
// 流程：
//   1. 接受 awemeId + 视频下载地址（由前端传入，前端从 video.bit_rate / play_addr 获取）
//   2. 用 ffmpeg 从视频流提取音频 → mp3
//      - 优先使用本地已下载的视频文件（通过 accountId 查找）
//      - 若无本地文件，通过在线 URL 直接提取（ffmpeg 支持 HTTP 输入）
//   3. 写入 archiveRoot/extracted-audio/ 目录（独立于账号体系）
//   4. 创建 ExtractedAudio 记录（无 douyinAccountId 外键）
//
// 返回：新创建的 ExtractedAudio id
export async function extractAudioFromVideo(
  localUserId: number,
  awemeId: string,
  videoUrl: string,
  title: string,
  authorName: string,
  durationSec: number,
  accountId?: number,
  sourceCoverPath?: string | null
): Promise<{ musicContentId: number; title: string; mediaPath: string; coverPath: string | null }> {
  const log = getLogger().child({ mod: 'library', fn: 'extractAudio' })
  const prisma = getPrisma()
  const cfg = loadConfig()
  const accountsRoot = join(cfg.archiveRoot, 'accounts')
  const extractedAudioRoot = join(cfg.archiveRoot, 'extracted-audio')

  // 0. 检查是否已经提取过（直接按 localUserId + sourceAwemeId 查询，不依赖账号）
  const existing = await prisma.extractedAudio.findFirst({
    where: { localUserId, sourceAwemeId: awemeId, hidden: false },
    select: { id: true, mediaPath: true, coverPath: true, title: true }
  })
  if (existing) {
    if (existing.mediaPath) {
      try {
        await fs.stat(join(extractedAudioRoot, existing.mediaPath))
        log.info({ awemeId, musicContentId: existing.id }, 'audio already extracted, returning existing')
        return { musicContentId: existing.id, title: existing.title, mediaPath: existing.mediaPath, coverPath: existing.coverPath }
      } catch {
        // 文件不存在，删除旧记录后重新提取
        log.info({ awemeId, musicContentId: existing.id }, 'audio file missing, removing stale record')
      }
    } else {
      log.info({ awemeId, musicContentId: existing.id }, 'audio record has no mediaPath, removing stale record')
    }
    await prisma.extractedAudio.delete({ where: { id: existing.id } })
  }

  // 1. 尝试查找本地已下载的视频文件（遍历该用户所有账号下的内容）
  let inputUrl = videoUrl
  if (accountId) {
    const localVideo = await prisma.content.findFirst({
      where: { douyinAccountId: accountId, kind: 'VIDEO', awemeId, hidden: false },
      select: { id: true, mediaPath: true }
    })
    if (localVideo?.mediaPath) {
      const localPath = join(accountsRoot, localVideo.mediaPath)
      try {
        await fs.stat(localPath)
        inputUrl = localPath
        log.info({ awemeId, localPath: localVideo.mediaPath }, 'using local video file for extraction')
      } catch {
        // 本地文件不存在，继续使用在线 URL
      }
    }
  }

  // 1b. 如果 inputUrl 是 /media/ 开头的相对路径，尝试解析为本地文件
  if (inputUrl.startsWith('/media/')) {
    const mediaRelPath = inputUrl.replace(/^\/media\//, '')
    const mediaFullPath = join(accountsRoot, mediaRelPath)
    try {
      await fs.stat(mediaFullPath)
      inputUrl = mediaFullPath
      log.info({ awemeId, mediaRelPath }, 'resolved /media/ path to local file')
    } catch {
      // 本地文件不存在，继续使用原 URL
    }
  }

  // 2. 生成输出路径 —— 完全解耦，存放到 extracted-audio 目录
  await fs.mkdir(extractedAudioRoot, { recursive: true })
  const safeName = (title || awemeId).replace(/[\\/:*?"<>|#]/g, '_').slice(0, 80)
  const audioFileName = safeName + '.mp3'
  const audioRelPath = audioFileName
  const audioFullPath = join(extractedAudioRoot, audioRelPath)

  // 3. ffmpeg 提取音频（支持 HTTP URL 或本地文件作为输入）
  log.info({ awemeId, inputUrl: inputUrl.startsWith('http') ? 'online' : 'local', audioRelPath }, 'extracting audio with ffmpeg')

  // 设置 ffmpeg 路径为 ffmpeg-static 提供的静态二进制
  ffmpeg.setFfmpegPath(ffmpegStatic as string)

  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputUrl)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate('192k')
      .audioFrequency(44100)
      .output(audioFullPath)
      .on('start', (cmd: string) => log.info({ awemeId, cmd }, 'ffmpeg started'))
      .on('progress', (p: { percent?: number }) => {
        if (p.percent !== undefined) {
          log.info({ awemeId, percent: Math.round(p.percent) }, 'ffmpeg progress')
        }
      })
      .on('error', (err: Error) => reject(new Error('ffmpeg 处理失败: ' + err.message)))
      .on('end', () => {
        log.info({ awemeId, audioRelPath }, 'ffmpeg extraction done')
        resolve()
      })
      .run()
  })

  // 4. 获取文件大小
  const stat = await fs.stat(audioFullPath)
  const mediaSize = stat.size

  // 5. 保存到 ExtractedAudio 表（不关联任何抖音账号）
  const savedCoverPath = sourceCoverPath || null
  const musicContent = await prisma.extractedAudio.create({
    data: {
      localUserId,
      sourceAwemeId: awemeId,
      title: title,
      authorName: authorName,
      durationSec: durationSec,
      mediaPath: audioRelPath,
      coverPath: savedCoverPath,
      mediaSize: BigInt(mediaSize),
    },
    select: { id: true }
  })

  log.info({ awemeId, musicContentId: musicContent.id, mediaSize }, 'audio extracted successfully')
  return { musicContentId: musicContent.id, title, mediaPath: audioRelPath, coverPath: savedCoverPath }
}

// 列出用户提取的音频（原声/BGM）
//
// 从 ExtractedAudio 表直接按 localUserId 查询，不关联抖音账号
export async function listExtractedAudio(
  localUserId: number,
  page: number = 1,
  size: number = 20
): Promise<ListVideosResult> {
  const prisma = getPrisma()

  const skip = (page - 1) * size

  const where = {
    localUserId,
    hidden: false,
  }

  const [total, rows] = await Promise.all([
    prisma.extractedAudio.count({ where }),
    prisma.extractedAudio.findMany({
      where,
      skip,
      take: size,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        sourceAwemeId: true,
        title: true,
        authorName: true,
        durationSec: true,
        createdAt: true,
        coverPath: true,
        mediaPath: true,
      }
    })
  ])

  return {
    total,
    page,
    size,
    items: rows.map((row: any) => ({
      id: row.id,
      awemeId: row.sourceAwemeId,
      title: row.title,
      authorName: row.authorName,
      durationSec: row.durationSec,
      publishAt: row.createdAt.toISOString(),
      archivedAt: row.createdAt.toISOString(),
      coverPath: row.coverPath,
      mediaPath: row.mediaPath,
      status: 'done',
      douyinAccountId: 0,
      linkKinds: ['EXTRACTED_AUDIO'],
    }))
  }
}

// 删除提取的音频
export async function deleteExtractedAudio(
  localUserId: number,
  musicContentId: number
): Promise<{ deleted: boolean }> {
  const log = getLogger().child({ mod: 'library', fn: 'deleteExtractedAudio' })
  const prisma = getPrisma()
  const cfg = loadConfig()
  const extractedAudioRoot = join(cfg.archiveRoot, 'extracted-audio')

  const music = await prisma.extractedAudio.findFirst({
    where: {
      id: musicContentId,
      localUserId,
      hidden: false,
    },
    select: { id: true, mediaPath: true }
  })

  if (!music) {
    return { deleted: false }
  }

  // 删除本地文件
  if (music.mediaPath) {
    const filePath = join(extractedAudioRoot, music.mediaPath)
    try {
      await fs.unlink(filePath)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        log.warn({ err: e, path: filePath }, 'failed to delete audio file')
      }
    }
  }

  // 硬删 ExtractedAudio 记录
  await prisma.extractedAudio.delete({ where: { id: musicContentId } })

  log.info({ musicContentId }, 'extracted audio deleted')
  return { deleted: true }
}
