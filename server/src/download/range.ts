// Range / HTTP 工具 —— 纯函数，便于单测
import { promises as fs } from 'node:fs'

export interface PartFileState {
  exists: boolean
  size: number
}

export async function statPart(partPath: string): Promise<PartFileState> {
  try {
    const st = await fs.stat(partPath)
    return { exists: true, size: Number(st.size) }
  } catch {
    return { exists: false, size: 0 }
  }
}

export function rangeHeaderFor(existingSize: number): string | null {
  if (existingSize <= 0) return null
  return `bytes=${existingSize}-`
}

export interface ContentRangeInfo {
  start: number
  end: number
  total: number
}

export function parseContentRange(header: string | undefined): ContentRangeInfo | null {
  if (!header) return null
  // e.g. "bytes 1024-2047/2048"
  const m = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(header.trim())
  if (!m) return null
  const start = Number(m[1])
  const end = Number(m[2])
  const total = m[3] === '*' ? -1 : Number(m[3])
  return { start, end, total }
}
