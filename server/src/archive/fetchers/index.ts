// 三个 fetcher 共用的分页迭代器
//
// 每个 fetcher 暴露 async generator `paginate(opts)`，按 抖音 has_more 翻页直到完成或命中已知 awemeId。
// fetcher 不入库，只负责把 RawAwemeLike 一条条吐出来给 archive.service 处理。

import type { DouyinAccount } from '@prisma/client'
import {
  fetchCollectsVideoList,
  fetchUserCollectMix,
  fetchUserCollectsList,
  fetchUserLikePage,
  fetchUserMixDetail,
  fetchUserMixList,
  fetchUserPostPage,
  type AwemeListItem
} from '../../douyin/dy-client.js'
import { getLogger } from '../../core/logger.js'

const PAGE_SIZE = 20

export interface FetcherOpts {
  localUserId: number
  account: DouyinAccount
  /** 已知 awemeId 集合（增量模式：命中即停翻页） */
  knownIds?: Set<string>
  /** 全量模式忽略 knownIds */
  full?: boolean
  /** 每页 sleep（ms），避免抖音限流 */
  pageDelayMs?: number
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return
  return new Promise(r => setTimeout(r, ms))
}

export async function* paginateUserPost(opts: FetcherOpts): AsyncGenerator<AwemeListItem> {
  let cursor: number | string = 0
  for (let safety = 0; safety < 200; safety++) {
    const r = await fetchUserPostPage(opts.localUserId, opts.account, {
      sec_user_id: opts.account.secUid,
      max_cursor: cursor,
      count: PAGE_SIZE
    })
    if (!r.data) return
    const list = r.data.aweme_list ?? []
    for (const it of list) {
      if (!opts.full && opts.knownIds && it.aweme_id && opts.knownIds.has(it.aweme_id)) return
      if (it.aweme_id) yield it
    }
    if (!r.data.has_more) return
    cursor = (r.data.max_cursor ?? cursor) as number | string
    await sleep(opts.pageDelayMs ?? 800)
  }
}

export async function* paginateUserLike(opts: FetcherOpts): AsyncGenerator<AwemeListItem> {
  let cursor = 0
  for (let safety = 0; safety < 200; safety++) {
    const r = await fetchUserLikePage(opts.localUserId, opts.account, {
      sec_user_id: opts.account.secUid,
      max_cursor: cursor,
      count: PAGE_SIZE
    })
    if (!r.data) return
    const list = r.data.aweme_list ?? []
    for (const it of list) {
      if (!opts.full && opts.knownIds && it.aweme_id && opts.knownIds.has(it.aweme_id)) return
      if (it.aweme_id) yield it
    }
    if (!r.data.has_more) return
    const nx = Number(r.data.max_cursor ?? 0)
    if (!Number.isFinite(nx) || nx === cursor || nx === 0) return
    cursor = nx
    await sleep(opts.pageDelayMs ?? 800)
  }
}

export async function* paginateUserCollectVideo(opts: FetcherOpts): AsyncGenerator<AwemeListItem> {
  const log = getLogger().child({ mod: 'fetcher.collect', accountId: opts.account.id })
  // 1) 列出全部收藏夹
  const folders: Array<{ collects_id: string; collects_name?: string }> = []
  let folderCursor = 0
  for (let safety = 0; safety < 20; safety++) {
    const r = await fetchUserCollectsList(opts.localUserId, opts.account, {
      cursor: folderCursor,
      count: 50
    })
    if (!r.data) break
    const list = r.data.collects_list ?? []
    for (const f of list) {
      const id = f.collects_id_str ?? (f.collects_id != null ? String(f.collects_id) : '')
      if (id) folders.push({ collects_id: id, collects_name: f.collects_name })
    }
    if (!r.data.has_more) break
    const nx = Number(r.data.cursor ?? 0)
    if (!Number.isFinite(nx) || nx === folderCursor) break
    folderCursor = nx
    await sleep(opts.pageDelayMs ?? 800)
  }
  log.info({ count: folders.length }, 'collects folders listed')
  // 2) 每个收藏夹翻页
  for (const f of folders) {
    let cursor = 0
    for (let safety = 0; safety < 200; safety++) {
      const r = await fetchCollectsVideoList(opts.localUserId, opts.account, {
        collects_id: f.collects_id,
        cursor,
        count: PAGE_SIZE
      })
      if (!r.data) break
      const list = r.data.aweme_list ?? []
      for (const it of list) {
        if (!opts.full && opts.knownIds && it.aweme_id && opts.knownIds.has(it.aweme_id)) return
        if (it.aweme_id) {
          // 把所属收藏夹 id 挂在 item 上；runFetcher 读取后传给 ingestOne，
          // 最终落进 ContentLink.folderId 用于"按收藏夹分类浏览"。
          ;(it as { __folderId?: string }).__folderId = f.collects_id
          yield it
        }
      }
      if (!r.data.has_more) break
      const nx = Number(r.data.max_cursor ?? 0)
      if (!Number.isFinite(nx) || nx === cursor || nx === 0) break
      cursor = nx
      await sleep(opts.pageDelayMs ?? 800)
    }
  }
}

async function* paginateMixVideos(
  opts: FetcherOpts,
  mixes: Array<{ mixId: string }>
): AsyncGenerator<AwemeListItem> {
  for (const mix of mixes) {
    let cursor = 0
    for (let safety = 0; safety < 200; safety++) {
      const r = await fetchUserMixDetail(opts.localUserId, opts.account, {
        mix_id: mix.mixId,
        cursor,
        count: PAGE_SIZE
      })
      if (!r.data) break
      const list = r.data.aweme_list ?? []
      for (const it of list) {
        if (it.aweme_id) {
          ;(it as { __mixId?: string }).__mixId = mix.mixId
          yield it
        }
      }
      if (!r.data.has_more) break
      const nx = Number(r.data.cursor ?? 0)
      if (!Number.isFinite(nx) || nx === cursor) break
      cursor = nx
      await sleep(opts.pageDelayMs ?? 800)
    }
  }
}

export async function listUserMixes(
  opts: FetcherOpts
): Promise<Array<{ mixId: string; raw: Record<string, unknown> }>> {
  const mixes: Array<{ mixId: string; raw: Record<string, unknown> }> = []
  let cursor = '0'
  for (let safety = 0; safety < 100; safety++) {
    const r = await fetchUserMixList(opts.localUserId, opts.account, {
      sec_user_id: opts.account.secUid,
      cursor,
      count: PAGE_SIZE,
      list_scene: 1
    })
    if (!r.data) break
    for (const mix of r.data.mix_infos ?? []) {
      const mixId = String(mix.mix_id ?? '')
      if (mixId) mixes.push({ mixId, raw: mix as Record<string, unknown> })
    }
    if (!r.data.has_more) break
    const next = String(r.data.cursor ?? '')
    if (!next || next === cursor) break
    cursor = next
    await sleep(opts.pageDelayMs ?? 800)
  }
  return mixes
}

export async function listCollectedMixes(
  opts: FetcherOpts
): Promise<Array<{ mixId: string; raw: Record<string, unknown> }>> {
  const mixes: Array<{ mixId: string; raw: Record<string, unknown> }> = []
  let cursor = '0'
  for (let safety = 0; safety < 100; safety++) {
    const r = await fetchUserCollectMix(opts.localUserId, opts.account, {
      cursor,
      count: PAGE_SIZE
    })
    if (!r.data) break
    for (const mix of r.data.mix_infos ?? []) {
      const mixId = String(mix.mix_id ?? '')
      if (mixId) mixes.push({ mixId, raw: mix as Record<string, unknown> })
    }
    if (!r.data.has_more) break
    const next = String(r.data.cursor ?? '')
    if (!next || next === cursor) break
    cursor = next
    await sleep(opts.pageDelayMs ?? 800)
  }
  return mixes
}

export async function* paginateUserSelfMixVideos(opts: FetcherOpts): AsyncGenerator<AwemeListItem> {
  const mixes = await listUserMixes(opts)
  yield* paginateMixVideos(opts, mixes)
}

export async function* paginateUserCollectMixVideos(opts: FetcherOpts): AsyncGenerator<AwemeListItem> {
  const mixes = await listCollectedMixes(opts)
  yield* paginateMixVideos(opts, mixes)
}
