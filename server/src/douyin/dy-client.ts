// 与 douyin.com web 接口通信。
//
// 两种路径：
//   1) dyGet —— 直接 undici 请求。只用于 /user/profile/self/ 这类对签名宽松的端点
//   2) dyGetSigned —— 走 BrowserSession.page.evaluate(fetch(...))，让浏览器内的 douyin.com JS
//      自己附加 a_bogus / X-Bogus / msToken 等签名参数，规避手写签名

import { request } from 'undici'
import type { DouyinAccount } from '@prisma/client'
import { AppError, ERR } from '../core/errors.js'
import { acquireBrowserSession } from './browser.session.js'
import { decryptCookieFor } from './cookie-codec.js'
import { getLogger } from '../core/logger.js'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// 抖音 web 接口期望一整套环境识别参数；缺一个就可能 status_code=5 或返回空 200。
// 参考 jiji262/douyin-downloader core/api_client.py `_default_query()`。
// 这些值与上面的 UA（mac/Chrome 124）保持一致；page.evaluate 内部的 fetch 通常会被
// douyin.com 自己的拦截器再补 a_bogus / X-Bogus / msToken，所以这里只补结构性参数。
function defaultWebParams(): Record<string, string> {
  return {
    device_platform: 'webapp',
    aid: '6383',
    channel: 'channel_pc_web',
    pc_client_type: '1',
    version_code: '290100',
    version_name: '29.1.0',
    update_version_code: '170400',
    cookie_enabled: 'true',
    screen_width: '1920',
    screen_height: '1080',
    browser_language: 'zh-CN',
    browser_platform: 'MacIntel',
    browser_name: 'Chrome',
    browser_version: '124.0.0.0',
    browser_online: 'true',
    engine_name: 'Blink',
    engine_version: '124.0.0.0',
    os_name: 'Mac OS',
    os_version: '10.15.7',
    cpu_core_num: '8',
    device_memory: '8',
    platform: 'PC',
    downlink: '10',
    effective_type: '4g',
    round_trip_time: '50'
  }
}

export interface DyResponse<T> {
  ok: boolean
  status: number
  data: T | null
  raw: string
}

async function dyGet(path: string, cookie: string, query: Record<string, string> = {}): Promise<DyResponse<any>> {
  const url = new URL('https://www.douyin.com' + path)
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  const res = await request(url.toString(), {
    method: 'GET',
    headers: {
      'user-agent': UA,
      cookie,
      referer: 'https://www.douyin.com/',
      accept: 'application/json, text/plain, */*'
    },
    headersTimeout: 10_000,
    bodyTimeout: 10_000
  })
  const raw = await res.body.text()
  let data: any = null
  try {
    data = JSON.parse(raw)
  } catch {
    /* 抖音偶尔返回非 JSON（风控页），保持 null */
  }
  return { ok: res.statusCode >= 200 && res.statusCode < 300 && data !== null, status: res.statusCode, data, raw }
}

export interface ProfileSelfRaw {
  user?: {
    sec_uid?: string
    nickname?: string
    avatar_300x300?: { url_list?: string[] }
    avatar_thumb?: { url_list?: string[] }
  }
  status_code?: number
}

export async function getProfileSelf(cookie: string): Promise<DyResponse<ProfileSelfRaw>> {
  return dyGet('/aweme/v1/web/user/profile/self/', cookie, {
    publish_video_strategy_type: '2',
    source: 'channel_pc_web'
  })
}

// ============================ 浏览器签名路径 ============================

export interface SignedListResp<T> {
  status_code?: number
  has_more?: boolean | number
  max_cursor?: number | string
  min_cursor?: number | string
  aweme_list?: T[]
  [key: string]: unknown
}

export async function dyGetSigned<T = unknown>(
  localUserId: number,
  account: DouyinAccount,
  path: string,
  query: Record<string, string | number | undefined> = {}
): Promise<DyResponse<T>> {
  const log = getLogger().child({ mod: 'dy-client', accountId: account.id, path })
  if (!account.cookieEnc) {
    throw new AppError(
      ERR.DOUYIN_BROWSER_UNAVAILABLE,
      `账号「${account.nickname}」无可用 cookie（cookieSource=${account.cookieSource}），无法走浏览器签名通道`,
      400
    )
  }
  const cookie = decryptCookieFor(localUserId, account.cookieEnc)
  log.info('acquiring browser session')
  const t0 = Date.now()
  const session = await acquireBrowserSession(account.id, account.secUid, cookie)
  log.info({ ms: Date.now() - t0 }, 'browser session acquired')
  const t1 = Date.now()
  // 合并 web 缺省参数；caller 提供的同名 key 覆盖默认值
  const mergedQuery = { ...defaultWebParams(), ...query }
  const r = await session.request<T>({ path, query: mergedQuery })
  log.info({ ms: Date.now() - t1, status: r.status, bytes: r.raw.length }, 'signed request done')
  // 极短响应：要么风控吞掉，要么参数被识别为机器人。打印前 300 字便于诊断。
  if (r.raw.length < 200) {
    log.warn({ bytes: r.raw.length, sample: r.raw.slice(0, 300) }, 'signed request returned suspiciously short body')
  }
  const data = r.data
  // 风控页：抖音通常以 status_code !== 0 表达，HTTP 200
  if (data && typeof data === 'object' && 'status_code' in data) {
    const sc = (data as { status_code?: number }).status_code
    if (sc !== 0 && sc != null) {
      log.warn({ statusCode: sc, sample: r.raw.slice(0, 200) }, 'signed request returned non-zero status_code')
      throw new AppError(ERR.DOUYIN_RISK_CONTROL, `抖音返回 status_code=${sc}`, 502)
    }
  }
  return {
    ok: r.status >= 200 && r.status < 300 && data !== null,
    status: r.status,
    data,
    raw: r.raw
  }
}

// ---------------------- 列表端点 ----------------------

export interface AwemeListItem {
  aweme_id?: string
  [key: string]: unknown
}

export interface CollectedMusicItem {
  id?: number | string
  id_str?: string
  [key: string]: unknown
}

export interface MixInfoItem {
  mix_id?: string
  mix_name?: string
  create_time?: number | string
  author?: {
    sec_uid?: string
    nickname?: string
  }
  cover_url?: { url_list?: string[] }
  statis?: {
    updated_to_episode?: number
  }
  [key: string]: unknown
}

const POST_PATH = '/aweme/v1/web/aweme/post/'
const LIKE_PATH = '/aweme/v1/web/aweme/favorite/'
const COLLECTS_LIST_PATH = '/aweme/v1/web/collects/list/'
const COLLECTS_VIDEO_LIST_PATH = '/aweme/v1/web/collects/video/list/'
const COLLECT_MUSIC_PATH = '/aweme/v1/web/music/listcollection/'
const USER_MIX_PATH = '/aweme/v1/web/mix/list/'
const USER_MIX_DETAIL_PATH = '/aweme/v1/web/mix/aweme/'
const COLLECT_MIX_PATH = '/aweme/v1/web/mix/listcollection/'

export async function fetchUserPostPage(
  localUserId: number,
  account: DouyinAccount,
  params: { sec_user_id: string; max_cursor: number | string; count: number }
): Promise<DyResponse<SignedListResp<AwemeListItem>>> {
  return dyGetSigned<SignedListResp<AwemeListItem>>(localUserId, account, POST_PATH, {
    sec_user_id: params.sec_user_id,
    max_cursor: params.max_cursor,
    count: params.count,
    publish_video_strategy_type: 2,
    locate_query: 'false',
    show_live_replay_strategy: 1
  })
}

export async function fetchUserLikePage(
  localUserId: number,
  account: DouyinAccount,
  params: { sec_user_id: string; max_cursor: number; min_cursor?: number; count: number }
): Promise<DyResponse<SignedListResp<AwemeListItem>>> {
  return dyGetSigned<SignedListResp<AwemeListItem>>(localUserId, account, LIKE_PATH, {
    sec_user_id: params.sec_user_id,
    max_cursor: params.max_cursor,
    min_cursor: params.min_cursor ?? 0,
    count: params.count
  })
}

// 收藏体系：早期版抖音的 /aweme/listcollection/ 已被 Janus 网关拒（"Unsupported path"）。
// 现役链路是「收藏夹列表 + 收藏夹详情」两步走，且需要把 version_code 降回 17.4.0
// （新版本号在 collects/* 路径上同样被拒）。参考 jiji262/douyin-downloader core/api_client.py。
export interface CollectsListItem {
  collects_id?: number | string
  collects_id_str?: string
  collects_name?: string
  [key: string]: unknown
}

export interface CollectsListResp {
  status_code?: number
  has_more?: boolean | number
  cursor?: number | string
  collects_list?: CollectsListItem[]
  [key: string]: unknown
}

export async function fetchUserCollectsList(
  localUserId: number,
  account: DouyinAccount,
  params: { cursor: number; count: number }
): Promise<DyResponse<CollectsListResp>> {
  return dyGetSigned<CollectsListResp>(localUserId, account, COLLECTS_LIST_PATH, {
    cursor: params.cursor,
    count: params.count,
    version_code: '170400',
    version_name: '17.4.0'
  })
}

export async function fetchCollectsVideoList(
  localUserId: number,
  account: DouyinAccount,
  params: { collects_id: string; cursor: number; count: number }
): Promise<DyResponse<SignedListResp<AwemeListItem>>> {
  return dyGetSigned<SignedListResp<AwemeListItem>>(localUserId, account, COLLECTS_VIDEO_LIST_PATH, {
    collects_id: params.collects_id,
    cursor: params.cursor,
    count: params.count,
    version_code: '170400',
    version_name: '17.4.0'
  })
}

export async function fetchUserCollectMusic(
  localUserId: number,
  account: DouyinAccount,
  params: { cursor: number; count: number }
): Promise<DyResponse<{ status_code?: number; has_more?: boolean | number; cursor?: number; mc_list?: CollectedMusicItem[] }>> {
  return dyGetSigned(localUserId, account, COLLECT_MUSIC_PATH, {
    cursor: params.cursor,
    count: params.count
  })
}

export async function fetchUserMixList(
  localUserId: number,
  account: DouyinAccount,
  params: { sec_user_id: string; cursor: string; count: number; list_scene?: number }
): Promise<DyResponse<{ status_code?: number; has_more?: boolean | number; cursor?: string; mix_infos?: MixInfoItem[] }>> {
  return dyGetSigned(localUserId, account, USER_MIX_PATH, {
    sec_user_id: params.sec_user_id,
    cursor: params.cursor,
    count: params.count,
    list_scene: params.list_scene ?? 1
  })
}

export async function fetchUserMixDetail(
  localUserId: number,
  account: DouyinAccount,
  params: { mix_id: string; cursor: number; count: number }
): Promise<DyResponse<SignedListResp<AwemeListItem> & { mix_info?: MixInfoItem }>> {
  return dyGetSigned(localUserId, account, USER_MIX_DETAIL_PATH, {
    mix_id: params.mix_id,
    cursor: params.cursor,
    count: params.count
  })
}

export async function fetchUserCollectMix(
  localUserId: number,
  account: DouyinAccount,
  params: { cursor: string; count: number }
): Promise<DyResponse<{ status_code?: number; has_more?: boolean | number; cursor?: string; mix_infos?: MixInfoItem[] }>> {
  return dyGetSigned(localUserId, account, COLLECT_MIX_PATH, {
    cursor: params.cursor,
    count: params.count
  })
}

// 视频详情：URL 过期时回头取一份新的 play_addr
export async function fetchAwemeDetail(
  localUserId: number,
  account: DouyinAccount,
  awemeId: string
): Promise<DyResponse<{ aweme_detail?: AwemeListItem; status_code?: number }>> {
  return dyGetSigned(localUserId, account, '/aweme/v1/web/aweme/detail/', {
    aweme_id: awemeId
  })
}
