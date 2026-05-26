import { encrypt, decrypt } from '../core/crypto.js'
import { getUserKey } from '../core/keystore.js'
import { AppError, ERR } from '../core/errors.js'

export function encryptCookieFor(userId: number, plaintext: string): string {
  const key = getUserKey(userId)
  if (!key) {
    throw new AppError(ERR.AUTH_NOT_LOGGED_IN, '请重新登录后再操作抖音账号', 401)
  }
  return encrypt(plaintext, key)
}

export function decryptCookieFor(userId: number, payload: string): string {
  const key = getUserKey(userId)
  if (!key) {
    throw new AppError(ERR.AUTH_NOT_LOGGED_IN, '请重新登录后再操作抖音账号', 401)
  }
  return decrypt(payload, key)
}
