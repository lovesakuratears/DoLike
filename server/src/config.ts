import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'

export interface AppConfig {
  readonly port: number
  readonly host: string
  readonly archiveRoot: string
  readonly dbPath: string
  readonly logLevel: string
  readonly logPretty: boolean
}

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
}

export function loadConfig(): AppConfig {
  const port = Number(process.env.PORT ?? 7777)
  const host = '127.0.0.1'
  const archiveRoot = process.env.ARCHIVE_ROOT ?? join(homedir(), '.dolike-archive')
  ensureDir(archiveRoot)
  ensureDir(join(archiveRoot, 'accounts'))
  ensureDir(join(archiveRoot, 'db'))
  ensureDir(join(archiveRoot, 'tmp'))
  ensureDir(join(archiveRoot, 'logs'))

  const dbPath = join(archiveRoot, 'db', 'app.sqlite')
  const logLevel = process.env.LOG_LEVEL ?? 'info'
  const logPretty = (process.env.LOG_PRETTY ?? 'true') === 'true'

  return { port, host, archiveRoot, dbPath, logLevel, logPretty }
}
