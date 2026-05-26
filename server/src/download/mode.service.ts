export type DownloadMode = 'enhanced' | 'compatible'
export type ParserStatus = 'unknown' | 'available' | 'unreachable' | 'unconfigured'

const modeByUser = new Map<number, DownloadMode>()
let parserStatus: ParserStatus = 'unknown'
let parserLastCheckedAt: number | null = null

export function getDownloadMode(localUserId: number): DownloadMode {
  return modeByUser.get(localUserId) ?? 'enhanced'
}

export function setDownloadMode(localUserId: number, mode: DownloadMode): DownloadMode {
  modeByUser.set(localUserId, mode)
  return mode
}

export function getParserEndpoint(): string {
  const v = String(process.env.MEDIA_PARSER_ENDPOINT || '').trim()
  if (v) return v
  return `http://127.0.0.1:${process.env.PORT || '7777'}/api/parser/parse`
}

export function getParserState(): { status: ParserStatus; lastCheckedAt: number | null } {
  if (!getParserEndpoint()) {
    return { status: 'unconfigured', lastCheckedAt: parserLastCheckedAt }
  }
  return { status: parserStatus, lastCheckedAt: parserLastCheckedAt }
}

export function markParserState(status: Exclude<ParserStatus, 'unconfigured'>): void {
  parserStatus = status
  parserLastCheckedAt = Date.now()
}
