import { describe, expect, it } from 'vitest'
import {
  createMemoryLoggerSink,
  createRootLogger,
  withErrorFields
} from '../../src/shared/logger.js'

describe('shared logger', () => {
  it('writes JSON entries with base service fields', () => {
    const sink = createMemoryLoggerSink()
    const logger = createRootLogger({ sink })

    logger.info({ event: 'test.event' }, 'hello')

    expect(sink.entries[0]).toMatchObject({
      service: 'mini-auth',
      event: 'test.event',
      msg: 'hello'
    })
  })

  it('creates child loggers that preserve parent bindings', () => {
    const sink = createMemoryLoggerSink()
    const logger = createRootLogger({ sink }).child({ request_id: 'req-1' })

    logger.info({ event: 'child.event', email: 'user@example.com' }, 'ok')

    expect(sink.entries[0]).toMatchObject({
      service: 'mini-auth',
      request_id: 'req-1',
      event: 'child.event',
      email: 'user@example.com'
    })
  })

  it('serializes known error fields without dumping arbitrary objects', () => {
    const error = new Error('boom')

    expect(withErrorFields(error)).toMatchObject({
      error_name: 'Error',
      error_message: 'boom'
    })
    expect(withErrorFields(error)).not.toHaveProperty('cause')
  })
})
