import { randomBytes, createCipheriv, createDecipheriv, scryptSync, timingSafeEqual } from 'node:crypto'

// session token 生成
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

// push_token 生成（方案 C）
export function generatePushToken(): string {
  return 'pt_' + randomBytes(24).toString('base64url')
}

// 用本地用户密码派生 key，加密抖音 cookie
// 注意：密码本身不存明文，只在用户每次登录时被传入用于派生 key 加解密 cookie
// 由于密码哈希后无法解密 → 我们另存一个由密码派生的、与 password hash 不同盐的 key derivation salt
// M1.2 阶段先实现接口，加密 cookie 的真正使用在 M1.3 抖音登录中

const ALG = 'aes-256-gcm'

export function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 32)
}

export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALG, key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // 输出格式：iv(12) | tag(16) | ciphertext  → base64
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decrypt(payload: string, key: Buffer): string {
  const buf = Buffer.from(payload, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const decipher = createDecipheriv(ALG, key, iv)
  decipher.setAuthTag(tag)
  const dec = Buffer.concat([decipher.update(enc), decipher.final()])
  return dec.toString('utf8')
}

// 常量时间比较
export function safeCompare(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}
