// 本地用户登录时派生的对称密钥，用于加解密 DouyinAccount.cookieEnc。
//
// 持久化策略（2026-05 起）：
//   - in-memory Map：现网热路径，O(1) 读取
//   - 落盘到 $ARCHIVE_ROOT/.keystore.json：用 $ARCHIVE_ROOT/.machine.key (32B 随机，0600)
//     做 AES-GCM 包装，server 启动后 lazy 解包重建 Map
//   - 触发动机：tsx watch hot reload / server 进程重启会清空内存 Map，
//     原本用户必须重新输密码登录 portal 才能继续操作抖音账号，dev 体验糟糕
//
// 单用户本机威胁模型：
//   - 攻击者拿到 $ARCHIVE_ROOT 整目录读权限 = 拿到 cookie 明文（因为 machine.key 与 cookieEnc 同盘）
//   - 但备份快照若漏带 .machine.key、或日志/调试 dump 不含 .machine.key，仍然安全
//   - 远比把 cookie 明文落盘强；远比把派生密码落盘强
//   - 与 jiji262-downloader 等本机工具一致的安全权衡
// 不适用：多用户共享盘、可被远程 backup 系统同步、需要"密钥仅活在内存"语义的场景

import { deriveKey, encrypt, decrypt } from './crypto.js'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  readFileSync,
  writeFileSync,
  existsSync,
  chmodSync,
  renameSync
} from 'node:fs'
import { randomBytes } from 'node:crypto'
import { getLogger } from './logger.js'

const keys = new Map<number, Buffer>()

// 派生用 salt。salt 不需要保密，且只随本地用户存在；
// 不同本地用户的盐目前共用一个常量；如需更强隔离，可改为 per-user salt（M1.3.x）。
const COOKIE_SALT = Buffer.from('dolike-cookie-kdf-v1', 'utf8')

function archiveRoot(): string {
  return process.env.ARCHIVE_ROOT ?? join(homedir(), '.dolike-archive')
}

function machineKeyPath(): string {
  return join(archiveRoot(), '.machine.key')
}

function keystoreFilePath(): string {
  return join(archiveRoot(), '.keystore.json')
}

let cachedMachineKey: Buffer | null = null
function getOrCreateMachineKey(): Buffer {
  if (cachedMachineKey) return cachedMachineKey
  const p = machineKeyPath()
  if (existsSync(p)) {
    const b = readFileSync(p)
    if (b.length === 32) {
      cachedMachineKey = b
      return b
    }
    // 长度不对 → 现场备份，重建。已包装的 keystore.json 将解不开 → 用户重登一次即可。
    try {
      const bk = `${p}.bak.${Date.now()}`
      writeFileSync(bk, b, { mode: 0o600 })
      getLogger().warn({ backup: bk }, 'machine.key size mismatch; backed up and regenerating')
    } catch { /* ignore */ }
  }
  const k = randomBytes(32)
  // tmp + rename = 原子写，崩在中间也不会留半截
  const tmp = `${p}.tmp`
  writeFileSync(tmp, k, { mode: 0o600 })
  renameSync(tmp, p)
  try { chmodSync(p, 0o600) } catch { /* fs without chmod, e.g. some win cases */ }
  cachedMachineKey = k
  return k
}

interface PersistedKeystore {
  users: Record<string, string>
}

function readPersisted(): PersistedKeystore {
  const p = keystoreFilePath()
  if (!existsSync(p)) return { users: {} }
  try {
    const raw = readFileSync(p, 'utf8')
    const obj = JSON.parse(raw) as Partial<PersistedKeystore>
    if (obj && typeof obj === 'object' && obj.users && typeof obj.users === 'object') {
      return { users: { ...(obj.users as Record<string, string>) } }
    }
  } catch (e) {
    getLogger().warn({ err: e }, 'keystore.json unreadable; treating as empty')
  }
  return { users: {} }
}

function writePersisted(data: PersistedKeystore): void {
  const p = keystoreFilePath()
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
  renameSync(tmp, p)
  try { chmodSync(p, 0o600) } catch { /* ignore */ }
}

let bootstrapDone = false
function bootstrap(): void {
  if (bootstrapDone) return
  bootstrapDone = true
  const p = keystoreFilePath()
  if (!existsSync(p)) return // 还没有用户登录过，省一次 machine.key 创建
  const data = readPersisted()
  const ids = Object.keys(data.users)
  if (ids.length === 0) return
  const mk = getOrCreateMachineKey()
  let loaded = 0
  for (const idStr of ids) {
    try {
      const wrapped = data.users[idStr]
      if (!wrapped) continue
      const keyB64 = decrypt(wrapped, mk)
      keys.set(Number(idStr), Buffer.from(keyB64, 'base64'))
      loaded++
    } catch (e) {
      getLogger().warn({ userId: idStr, err: e }, 'failed to unwrap persisted keystore entry; skipping')
    }
  }
  if (loaded > 0) {
    getLogger().info({ count: loaded }, 'keystore: restored from disk')
  }
}

function persistOne(userId: number, key: Buffer): void {
  try {
    const mk = getOrCreateMachineKey()
    const wrapped = encrypt(key.toString('base64'), mk)
    const data = readPersisted()
    data.users[String(userId)] = wrapped
    writePersisted(data)
  } catch (e) {
    getLogger().warn({ userId, err: e }, 'failed to persist keystore entry')
  }
}

function removePersisted(userId: number): void {
  try {
    const data = readPersisted()
    if (!data.users[String(userId)]) return
    delete data.users[String(userId)]
    writePersisted(data)
  } catch (e) {
    getLogger().warn({ userId, err: e }, 'failed to remove persisted keystore entry')
  }
}

export function setUserKeyFromPassword(userId: number, password: string): void {
  bootstrap()
  const key = deriveKey(password, COOKIE_SALT)
  keys.set(userId, key)
  persistOne(userId, key)
}

export function clearUserKey(userId: number): void {
  bootstrap()
  const k = keys.get(userId)
  if (k) k.fill(0)
  keys.delete(userId)
  removePersisted(userId)
}

export function getUserKey(userId: number): Buffer | undefined {
  bootstrap()
  return keys.get(userId)
}

export function hasUserKey(userId: number): boolean {
  bootstrap()
  return keys.has(userId)
}
