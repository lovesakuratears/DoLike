// 归档主流程
//
// 入口：
//   - startFull(accountId)           全量抓取当前已支持的 linkKind
//   - startIncremental(accountId)    增量：fetcher 命中已存在 contentId 即停翻页（音乐/合集列表目前仍偏保守）
//   - ingestExternalItems(...)       方案 C / bridge 推送场景下，外部 caller 把 items 喂给同样的 normalize+dedup+enqueue 管线
//
// 进度回调：可选 onProgress(stage, payload)，用于 WS 推送

import type { DouyinAccount } from '@prisma/client'
import { getPrisma } from '../core/db.js'
import { AppError, ERR } from '../core/errors.js'
import { getLogger } from '../core/logger.js'
import { hasUserKey } from '../core/keystore.js'
import {
  paginateUserCollectVideo,
  paginateUserCollectMixVideos,
  paginateUserLike,
  paginateUserPost,
  paginateUserSelfMixVideos,
  listCollectedMixes,
  listUserMixes,
  type FetcherOpts
} from './fetchers/index.js'
import { upsertContentWithLink } from './dedup.js'
import { normalizeMusicItem, normalizeVideoAweme, type RawAwemeLike } from './normalize.js'
import { enqueueDownloadsForContent } from '../download/queue.service.js'
import type { LinkKind } from './types.js'

export interface ArchiveProgress {
  type: 'fetch.page' | 'ingest.new' | 'ingest.skip' | 'fetch.done' | 'fetch.failed' | 'archive.paused' | 'archive.resumed' | 'archive.stopped'
  linkKind?: LinkKind
  awemeId?: string
  count?: number
  message?: string
}

export type ProgressHook = (ev: ArchiveProgress) => void

interface RunCtx {
  localUserId: number
  account: DouyinAccount
  full: boolean
  onProgress?: ProgressHook
  handle: ArchiveRunHandle
}

// ---------------- 运行态控制 ----------------
//
// 一个 accountId 同时最多 1 个 run。pause 不杀掉 fetcher，而是让 for-await 循环
// 在下次迭代前 await 一个 promise gate（resolve 触发恢复）。
// stop 把 status 拨到 'stopping'，gate 释放 + 循环检测到立刻 return。

type RunStatus = 'running' | 'paused' | 'stopping' | 'finished'

interface ArchiveRunHandle {
  accountId: number
  full: boolean
  status: RunStatus
  startedAt: number
  // pauseGate 在 status='paused' 时存在；resume / stop 调用其 resolve 即可。
  pauseGate: { resolve: () => void; promise: Promise<void> } | null
}

const runs = new Map<number, ArchiveRunHandle>()

function makeGate(): { resolve: () => void; promise: Promise<void> } {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { resolve, promise }
}

// 返回 false 表示应中止当前 fetcher。
async function gateWait(handle: ArchiveRunHandle): Promise<boolean> {
  while (handle.status === 'paused' && handle.pauseGate) {
    await handle.pauseGate.promise
  }
  return handle.status !== 'stopping'
}

export function pauseArchive(accountId: number): boolean {
  const h = runs.get(accountId)
  if (!h || h.status !== 'running') return false
  h.status = 'paused'
  h.pauseGate = makeGate()
  getLogger().child({ mod: 'archive', accountId }).info('archive paused')
  return true
}

export function resumeArchive(accountId: number): boolean {
  const h = runs.get(accountId)
  if (!h || h.status !== 'paused') return false
  h.status = 'running'
  h.pauseGate?.resolve()
  h.pauseGate = null
  getLogger().child({ mod: 'archive', accountId }).info('archive resumed')
  return true
}

export function stopArchive(accountId: number): boolean {
  const h = runs.get(accountId)
  if (!h || h.status === 'finished') return false
  h.status = 'stopping'
  h.pauseGate?.resolve()
  h.pauseGate = null
  getLogger().child({ mod: 'archive', accountId }).info('archive stopping')
  return true
}

export function getArchiveStatus(accountId: number): RunStatus | 'idle' {
  return runs.get(accountId)?.status ?? 'idle'
}

async function loadKnownIds(douyinAccountId: number): Promise<Set<string>> {
  const prisma = getPrisma()
  const rows = await prisma.content.findMany({
    where: { douyinAccountId },
    select: { awemeId: true }
  })
  return new Set(rows.map((r: { awemeId: string }) => r.awemeId))
}

async function loadAccount(localUserId: number, accountId: number): Promise<DouyinAccount> {
  const prisma = getPrisma()
  const acc = await prisma.douyinAccount.findUnique({ where: { id: accountId } })
  if (!acc || acc.localUserId !== localUserId) {
    throw new AppError(ERR.DOUYIN_ACCOUNT_NOT_FOUND, '抖音账号不存在或无权限', 404)
  }
  return acc
}

async function ingestOne(
  ctx: RunCtx,
  raw: RawAwemeLike,
  linkKind: LinkKind,
  opts: { folderId?: string | null; mixId?: string | null; mode?: 'video' | 'music' } = {}
): Promise<void> {
  const content = opts.mode === 'music' ? normalizeMusicItem(raw) : normalizeVideoAweme(raw)
  if (!content.awemeId) return
  const prisma = getPrisma()
  const r = await upsertContentWithLink(
    prisma,
    ctx.account.id,
    content,
    { linkKind, folderId: opts.folderId ?? null, mixId: opts.mixId ?? null }
  )
  ctx.onProgress?.({
    type: r.isNewContent ? 'ingest.new' : 'ingest.skip',
    linkKind,
    awemeId: content.awemeId
  })
  if (r.isNewContent) {
    await enqueueDownloadsForContent({
      localUserId: ctx.localUserId,
      contentId: r.contentId,
      archiveRoot: process.env.ARCHIVE_ROOT!,
      secUid: ctx.account.secUid,
      linkKind,
      folderId: opts.folderId ?? null,
      mixId: opts.mixId ?? null,
      awemeId: content.awemeId,
      publishAt: content.publishAt,
      mediaKind: content.kind === 'MUSIC' ? 'audio' : 'video',
      videoUrl: content.mediaUrl,
      coverUrl: content.coverUrl
    })
  }
}

async function runFetcher(
  ctx: RunCtx,
  linkKind: LinkKind,
  gen: AsyncGenerator<RawAwemeLike>
): Promise<{ total: number; failed: number }> {
  const log = getLogger().child({ mod: 'archive', accountId: ctx.account.id, linkKind })
  let total = 0
  let failed = 0
  let newCount = 0
  log.info('fetcher started')
  try {
    for await (const item of gen) {
      // 暂停门：paused 时挂在 promise 上；stopping 直接退出。
      if (!(await gateWait(ctx.handle))) {
        log.info({ total, failed }, 'fetcher stop requested, exiting loop')
        // 主动关闭 generator，让上游 fetch loop 立刻 break（CloakBrowser/HTTP 不再发新请求）
        try { await gen.return(undefined) } catch { /* ignore */ }
        break
      }
      total++
      try {
        const beforeNew = newCount
        const meta = item as { __folderId?: string; __mixId?: string }
        await ingestOne(ctx, item, linkKind, {
          folderId: meta.__folderId ?? null,
          mixId: meta.__mixId ?? null,
          mode: 'video'
        })
        if (total % 20 === 0) log.info({ total, failed }, 'fetcher progress')
        void beforeNew
      } catch (e) {
        failed++
        log.warn({ awemeId: item.aweme_id, err: e }, 'fetcher item ingest failed')
        ctx.onProgress?.({ type: 'fetch.failed', linkKind, awemeId: item.aweme_id, message: (e as Error).message })
      }
    }
    if (ctx.handle.status === 'stopping') {
      log.info({ total, failed }, 'fetcher stopped by user')
      ctx.onProgress?.({ type: 'archive.stopped', linkKind, count: total })
    } else {
      log.info({ total, failed }, 'fetcher done')
      ctx.onProgress?.({ type: 'fetch.done', linkKind, count: total })
    }
  } catch (e) {
    log.error({ total, failed, err: e }, 'fetcher aborted')
    ctx.onProgress?.({ type: 'fetch.failed', linkKind, message: (e as Error).message })
  }
  return { total, failed }
}

async function upsertMix(
  ctx: RunCtx,
  kind: 'self' | 'collected',
  raw: Record<string, unknown>
): Promise<void> {
  const prisma = getPrisma()
  const mix = raw as {
    mix_id?: string
    mix_name?: string
    create_time?: number | string
    author?: { sec_uid?: string; nickname?: string }
    cover_url?: { url_list?: string[] }
    statis?: { updated_to_episode?: number }
  }
  const mixId = String(mix.mix_id ?? '')
  if (!mixId) return
  const createTime = mix.create_time
  const publishAt = createTime != null && Number.isFinite(Number(createTime))
    ? new Date(Number(createTime) * 1000)
    : null
  await prisma.mix.upsert({
    where: {
      douyinAccountId_mixId: {
        douyinAccountId: ctx.account.id,
        mixId
      }
    },
    create: {
      douyinAccountId: ctx.account.id,
      mixId,
      kind,
      name: String(mix.mix_name ?? mixId),
      authorSecUid: mix.author?.sec_uid ?? ctx.account.secUid,
      authorName: mix.author?.nickname ?? ctx.account.nickname,
      coverPath: null,
      itemCount: Number(mix.statis?.updated_to_episode ?? 0),
      publishAt,
      rawMeta: JSON.stringify(raw)
    },
    update: {
      kind,
      name: String(mix.mix_name ?? mixId),
      authorSecUid: mix.author?.sec_uid ?? ctx.account.secUid,
      authorName: mix.author?.nickname ?? ctx.account.nickname,
      itemCount: Number(mix.statis?.updated_to_episode ?? 0),
      publishAt,
      rawMeta: JSON.stringify(raw),
      archivedAt: new Date()
    }
  })
}

export async function runArchive(
  localUserId: number,
  accountId: number,
  opts: { full: boolean; onProgress?: ProgressHook }
): Promise<{ post: number; like: number; collectVideo: number; selfMix: number; collectMix: number }> {
  const log = getLogger().child({ mod: 'archive', accountId, full: opts.full })
  // 同一账号同时只允许一个 run；如果已有 running/paused 直接拒。
  const existing = runs.get(accountId)
  if (existing && (existing.status === 'running' || existing.status === 'paused')) {
    throw new AppError(ERR.VALIDATION_FAILED, '该账号已有归档任务在跑，请先终止或等待完成', 409)
  }
  if (!hasUserKey(localUserId)) {
    log.warn('cookie key missing in keystore; aborting archive run')
    throw new AppError(
      ERR.AUTH_NOT_LOGGED_IN,
      'server 重启后本地密钥已清空，请先退出本地账号并重新登录，再点归档',
      401
    )
  }
  const account = await loadAccount(localUserId, accountId)
  log.info({ secUid: account.secUid, nickname: account.nickname }, 'archive: account loaded')
  const handle: ArchiveRunHandle = {
    accountId,
    full: opts.full,
    status: 'running',
    startedAt: Date.now(),
    pauseGate: null
  }
  runs.set(accountId, handle)
  const ctx: RunCtx = { localUserId, account, full: opts.full, onProgress: opts.onProgress, handle }
  try {
    const knownIds = opts.full ? new Set<string>() : await loadKnownIds(account.id)
    log.info({ knownIds: knownIds.size }, 'archive: known ids loaded')
    const fetcherOpts: FetcherOpts = {
      localUserId,
      account,
      knownIds,
      full: opts.full
    }
    const [selfMixes, collectedMixes] = await Promise.all([
      listUserMixes(fetcherOpts),
      listCollectedMixes(fetcherOpts)
    ])
    await Promise.all([
      ...selfMixes.map((mix) => upsertMix(ctx, 'self', mix.raw)),
      ...collectedMixes.map((mix) => upsertMix(ctx, 'collected', mix.raw))
    ])
    log.info('archive: launching 5 fetchers (POST/LIKE/FAVORITE/SELF_MIX/COLLECT_MIX)')
    const [post, like, collectVideo, selfMix, collectMix] = await Promise.allSettled([
      runFetcher(ctx, 'POST', paginateUserPost(fetcherOpts)),
      runFetcher(ctx, 'LIKE', paginateUserLike(fetcherOpts)),
      runFetcher(ctx, 'FAVORITE', paginateUserCollectVideo(fetcherOpts)),
      runFetcher(ctx, 'SELF_MIX', paginateUserSelfMixVideos(fetcherOpts)),
      runFetcher(ctx, 'COLLECT_MIX', paginateUserCollectMixVideos(fetcherOpts))
    ])
    for (const [kind, r] of [['POST', post], ['LIKE', like], ['FAVORITE', collectVideo], ['SELF_MIX', selfMix], ['COLLECT_MIX', collectMix]] as const) {
      if (r.status === 'rejected') log.error({ kind, err: r.reason }, 'fetcher promise rejected')
    }
    const summary = {
      post: post.status === 'fulfilled' ? post.value.total : 0,
      like: like.status === 'fulfilled' ? like.value.total : 0,
      collectVideo: collectVideo.status === 'fulfilled' ? collectVideo.value.total : 0,
      selfMix: selfMix.status === 'fulfilled' ? selfMix.value.total : 0,
      collectMix: collectMix.status === 'fulfilled' ? collectMix.value.total : 0
    }
    log.info({ summary, status: handle.status }, 'archive: all fetchers settled')
    return summary
  } finally {
    handle.status = 'finished'
    // 留 30s 让前端最后一次拉状态能看到 finished；之后再清。
    setTimeout(() => {
      if (runs.get(accountId) === handle) runs.delete(accountId)
    }, 30_000).unref?.()
  }
}

export async function startFull(localUserId: number, accountId: number, onProgress?: ProgressHook) {
  return runArchive(localUserId, accountId, { full: true, onProgress })
}

export async function startIncremental(localUserId: number, accountId: number, onProgress?: ProgressHook) {
  return runArchive(localUserId, accountId, { full: false, onProgress })
}

// 方案 C / bridge 走的入口 —— 外部已经收集好 items，绕过 fetcher
export async function ingestExternalItems(opts: {
  localUserId: number
  accountId: number
  linkKind: LinkKind
  items: RawAwemeLike[]
  folderId?: string | null
  mixId?: string | null
  onProgress?: ProgressHook
}): Promise<{ total: number; added: number; failed: number }> {
  const account = await loadAccount(opts.localUserId, opts.accountId)
  // 桥接外部入仓不走 fetcher 循环，不需要真的 pause/stop —— 给一个 status=running 的 dummy handle 满足类型。
  const handle: ArchiveRunHandle = {
    accountId: opts.accountId,
    full: false,
    status: 'running',
    startedAt: Date.now(),
    pauseGate: null
  }
  const ctx: RunCtx = {
    localUserId: opts.localUserId,
    account,
    full: false,
    onProgress: opts.onProgress,
    handle
  }
  let added = 0
  let failed = 0
  const prisma = getPrisma()
  const log = getLogger().child({ mod: 'archive', linkKind: opts.linkKind })
  log.info({ totalItems: opts.items.length, sampleKeys: opts.items[0] ? Object.keys(opts.items[0]) : [], sampleItem: opts.items[0] ? JSON.stringify(opts.items[0]).slice(0, 500) : '' }, 'ingestExternalItems: start')
  let skippedNoId = 0
  for (const raw of opts.items) {
    const meta = raw as RawAwemeLike & { __folderId?: string; __mixId?: string }
    const isMusic = opts.linkKind === 'COLLECT_MUSIC'
    const rawAwemeId = isMusic
      ? String((raw as Record<string, unknown>).aweme_id ?? (raw as Record<string, unknown>).id_str ?? (raw as Record<string, unknown>).id ?? (raw as Record<string, unknown>).music_id ?? (raw as Record<string, unknown>).sec_item_id ?? '')
      : String(raw.aweme_id ?? '')
    if (!rawAwemeId) {
      skippedNoId++
      continue
    }
    const before = await prisma.content.findUnique({
      where: {
        douyinAccountId_awemeId_kind: {
          douyinAccountId: account.id,
          awemeId: rawAwemeId,
          kind: isMusic ? 'MUSIC' : 'VIDEO'
        }
      },
      select: { id: true }
    })
    try {
      await ingestOne(ctx, raw, opts.linkKind, {
        folderId: meta.__folderId ?? opts.folderId ?? null,
        mixId: meta.__mixId ?? opts.mixId ?? null,
        mode: isMusic ? 'music' : 'video'
      })
      if (!before) added++
    } catch (e) {
      failed++
      opts.onProgress?.({
        type: 'fetch.failed',
        linkKind: opts.linkKind,
        awemeId: rawAwemeId,
        message: (e as Error).message
      })
    }
  }
  log.info({ total: opts.items.length, added, failed, skippedNoId }, 'ingestExternalItems: done')
  return { total: opts.items.length, added, failed }
}
