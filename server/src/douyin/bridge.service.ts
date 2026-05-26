// 方案 C —— 浏览器扩展桥接
// 扩展持有 push_token，向 /api/bridge/push 推送：
//   1) 初始化：上传 secUid + nickname (+ 可选 cookie) → 绑定账号
//   2) 增量：上传抓到的内容列表（M2 阶段消费）
// 服务端用 push_token 鉴权，绕开 cookie session（扩展无法访问 HttpOnly cookie）。

import { z } from 'zod'
import type { DouyinAccountDTO, BridgeInitPayload } from './types.js'
import { AppError, ERR } from '../core/errors.js'
import {
  bindFromBridgeWithoutCookie,
  bindFromCookie,
  findByPushToken
} from './session.service.js'
import { issuePushToken, revokePushToken, toDTO, upsertAccount } from './account.store.js'
import { ingestExternalItems } from '../archive/archive.service.js'
import { broadcastProgress } from '../ws/progress.gateway.js'
import type { LinkKind } from '../archive/types.js'
import { isQueuePaused, resumeQueue } from '../download/queue.service.js'

const linkKindEnum = z.enum([
  'POST',
  'LIKE',
  'FAVORITE',
  'WATCH_LATER',
  'COLLECT_FOLDER',
  'COLLECT_MUSIC',
  'COLLECT_MIX',
  'SELF_MIX'
])

export const initPayloadSchema = z.object({
  type: z.literal('init'),
  secUid: z.string().min(1),
  nickname: z.string().min(1),
  avatarUrl: z.string().url().optional(),
  cookie: z.string().optional()
})

export const incrementPayloadSchema = z.object({
  type: z.literal('increment'),
  linkKind: linkKindEnum,
  folderId: z.string().optional().nullable(),
  mixId: z.string().optional().nullable(),
  items: z.array(z.record(z.unknown())).min(1)
})

export const pushPayloadSchema = z.discriminatedUnion('type', [
  initPayloadSchema,
  incrementPayloadSchema
])

export type PushPayload = z.infer<typeof pushPayloadSchema>

// 用户已登录时：先建一个固定占位 bridge 账号，再发 token；扩展首次推送 init 时用真实昵称/头像覆盖。
export async function preIssueToken(localUserId: number): Promise<{ accountId: number; token: string }> {
  // 用一个临时 secUid 占位（必须唯一）；扩展上线 init 后会把它换成真实 sec_uid。
  const tempSec = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const acc = await upsertAccount({
    localUserId,
    secUid: tempSec,
    nickname: '等待插件绑定',
    cookieSource: 'bridge',
    isValid: false
  })
  const token = await issuePushToken(acc.id)
  return { accountId: acc.id, token }
}

export async function revokeToken(localUserId: number, accountId: number): Promise<void> {
  // 简单地清空 pushToken。账号本身保留。
  await revokePushToken(accountId)
  // 防止漏调：调用方应已校验 accountId 属于 localUserId
  void localUserId
}

export async function handlePush(token: string, payload: PushPayload): Promise<DouyinAccountDTO> {
  const acc = await findByPushToken(token)
  if (!acc) throw new AppError(ERR.DOUYIN_BRIDGE_TOKEN_INVALID, '推送 token 无效', 401)

  if (payload.type === 'init') {
    const init = payload as BridgeInitPayload & { type: 'init' }
    if (init.cookie) {
      const updated = await bindFromCookie({
        localUserId: acc.localUserId,
        cookie: init.cookie,
        source: 'bridge'
      })
      return toDTO(updated)
    }
    const updated = await bindFromBridgeWithoutCookie({
      accountId: acc.id,
      localUserId: acc.localUserId,
      profile: {
        secUid: init.secUid,
        nickname: init.nickname,
        avatarUrl: init.avatarUrl ?? null
      }
    })
    return toDTO(updated)
  }

  // increment：走与 fetcher 共用的入库管线
  const incr = payload
  if (isQueuePaused()) {
    await resumeQueue()
  }
  const summary = await ingestExternalItems({
    localUserId: acc.localUserId,
    accountId: acc.id,
    linkKind: incr.linkKind as LinkKind,
    items: incr.items as Array<Record<string, unknown>>,
    folderId: incr.folderId ?? null,
    mixId: incr.mixId ?? null,
    onProgress: ev => broadcastProgress({ topic: 'archive.event', accountId: acc.id, ...ev })
  })
  broadcastProgress({
    type: 'archive.summary',
    accountId: acc.id,
    via: 'bridge',
    linkKind: incr.linkKind,
    ...summary
  })
  return toDTO(acc)
}

export async function handshakeByToken(token: string): Promise<DouyinAccountDTO> {
  const acc = await findByPushToken(token)
  if (!acc) throw new AppError(ERR.DOUYIN_BRIDGE_TOKEN_INVALID, 'API Key 无效或已失效', 401)
  return toDTO(acc)
}
