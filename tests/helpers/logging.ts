import type { AppLogger } from '../../src/shared/logger.js'
import { createRootLogger } from '../../src/shared/logger.js'

export type LogEntry = Record<string, unknown>

export type MemoryLogCollector = {
  entries: LogEntry[]
  lines: string[]
  logger: AppLogger
  sink: { write(line: string): void }
}

export function createMemoryLogCollector(): MemoryLogCollector {
  const entries: LogEntry[] = []
  const lines: string[] = []
  const sink = {
    write(line: string) {
      const trimmedLine = line.trim()

      if (trimmedLine.length === 0) {
        return
      }

      lines.push(trimmedLine)
      entries.push(JSON.parse(trimmedLine) as LogEntry)
    }
  }

  return {
    entries,
    lines,
    logger: createRootLogger({ sink }),
    sink
  }
}

export function entriesForRequest(entries: LogEntry[], requestId: string) {
  return entries.filter((entry) => entry.request_id === requestId)
}

export function completedEntriesForRequest(
  entries: LogEntry[],
  requestId: string
) {
  return entriesForRequest(entries, requestId).filter(
    (entry) => entry.event === 'http.request.completed'
  )
}
