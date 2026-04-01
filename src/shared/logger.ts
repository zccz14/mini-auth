import { randomUUID } from 'node:crypto'
import pino, { type Logger as PinoLogger } from 'pino'

type LogBindings = Record<string, unknown>

type LoggerSink = {
  write(line: string): void
}

export type AppLogger = {
  child(bindings: LogBindings): AppLogger
  info(bindings: LogBindings, msg: string): void
  warn(bindings: LogBindings, msg: string): void
  error(bindings: LogBindings, msg: string): void
}

export type MemoryLoggerSink = LoggerSink & {
  entries: Record<string, unknown>[]
  lines: string[]
}

const BASE_BINDINGS = {
  service: 'mini-auth'
} as const

class WrappedLogger implements AppLogger {
  constructor(private readonly logger: PinoLogger) {}

  child(bindings: LogBindings): AppLogger {
    return new WrappedLogger(this.logger.child(bindings))
  }

  info(bindings: LogBindings, msg: string): void {
    this.logger.info(bindings, msg)
  }

  warn(bindings: LogBindings, msg: string): void {
    this.logger.warn(bindings, msg)
  }

  error(bindings: LogBindings, msg: string): void {
    this.logger.error(bindings, msg)
  }
}

export function createRootLogger(options?: { sink?: LoggerSink }): AppLogger {
  const logger = pino(
    {
      base: BASE_BINDINGS
    },
    options?.sink
  )

  return new WrappedLogger(logger)
}

export function createRequestId(): string {
  return randomUUID()
}

export function withErrorFields(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return {}
  }

  return {
    error_name: error.name,
    error_message: error.message,
    ...(error.stack ? { stack: error.stack } : {})
  }
}

export function createMemoryLoggerSink(): MemoryLoggerSink {
  return {
    entries: [],
    lines: [],
    write(line: string) {
      const trimmedLine = line.trim()
      if (trimmedLine.length === 0) {
        return
      }

      this.lines.push(trimmedLine)
      this.entries.push(JSON.parse(trimmedLine) as Record<string, unknown>)
    }
  }
}
