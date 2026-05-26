// 入库去重：单事务 upsert Content + ContentLink
//
// 唯一键：
//   Content       @@unique([douyinAccountId, awemeId, kind])
//   ContentLink   @@unique([contentId, linkKind, folderId, mixId])
//
// 注意 Prisma 复合唯一约束在 SQLite 下要把 null 视作不等，已通过 unique 索引保证。
// folderId / mixId 为 null 时 SQLite 多次 null 不视作冲突 —— 这正是我们想要的：
//   同一 contentId+POST 只允许一条；同一 contentId+COLLECT_FOLDER+folderId=A 与 folderId=B 共存。

import type { PrismaClient } from '@prisma/client'
import type { ContentInput, LinkInput } from './normalize.js'

export interface UpsertResult {
  contentId: number
  isNewContent: boolean
  isNewLink: boolean
}

export async function upsertContentWithLink(
  prisma: PrismaClient,
  douyinAccountId: number,
  content: ContentInput,
  link: LinkInput
): Promise<UpsertResult> {
  return prisma.$transaction(async tx => {
    // 1) Content upsert
    const existing = await tx.content.findUnique({
      where: {
        douyinAccountId_awemeId_kind: {
          douyinAccountId,
          awemeId: content.awemeId,
          kind: content.kind
        }
      },
      select: { id: true, hidden: true }
    })

    let contentId: number
    let isNewContent = false
    if (existing) {
      contentId = existing.id
      // 已存在时刷新可变字段；若是 hidden tombstone（用户此前删过），本次推送应自动复活。
      await tx.content.update({
        where: { id: contentId },
        data: {
          title: content.title,
          desc: content.desc,
          authorSecUid: content.authorSecUid,
          authorName: content.authorName,
          durationSec: content.durationSec,
          publishAt: content.publishAt,
          originUrl: content.mediaUrl,
          originUrlExpiredAt: content.mediaUrlExpiredAt,
          rawMeta: content.rawMeta,
          ...(existing.hidden
            ? {
                hidden: false,
                hiddenAt: null,
                status: 'pending',
                errorMsg: null
              }
            : {})
        }
      })
      // 从 hidden 恢复时，把它视为“新入队内容”，让下载流程重新执行。
      if (existing.hidden) isNewContent = true
    } else {
      const created = await tx.content.create({
        data: {
          douyinAccountId,
          awemeId: content.awemeId,
          kind: content.kind,
          title: content.title,
          desc: content.desc,
          authorSecUid: content.authorSecUid,
          authorName: content.authorName,
          durationSec: content.durationSec,
          publishAt: content.publishAt,
          originUrl: content.mediaUrl,
          originUrlExpiredAt: content.mediaUrlExpiredAt,
          rawMeta: content.rawMeta,
          status: 'pending'
        },
        select: { id: true }
      })
      contentId = created.id
      isNewContent = true
    }

    // 2) Link upsert —— Prisma 不支持复合唯一含 null 字段直接走 upsert，手动 find+create
    const existedLink = await tx.contentLink.findFirst({
      where: {
        contentId,
        linkKind: link.linkKind,
        folderId: link.folderId ?? null,
        mixId: link.mixId ?? null
      },
      select: { id: true }
    })

    let isNewLink = false
    if (!existedLink) {
      await tx.contentLink.create({
        data: {
          contentId,
          linkKind: link.linkKind,
          folderId: link.folderId ?? null,
          mixId: link.mixId ?? null
        }
      })
      isNewLink = true
    }

    return { contentId, isNewContent, isNewLink }
  })
}
