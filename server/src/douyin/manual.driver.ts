// 方案 B —— 手动粘贴 cookie 流程

import { bindFromCookie } from './session.service.js'
import type { DouyinAccountDTO } from './types.js'
import { toDTO } from './account.store.js'

export async function pasteCookie(localUserId: number, rawCookie: string): Promise<DouyinAccountDTO> {
  const acc = await bindFromCookie({
    localUserId,
    cookie: rawCookie,
    source: 'manual'
  })
  return toDTO(acc)
}
