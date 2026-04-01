import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { bootstrapDatabase } from '../../src/infra/db/bootstrap.js'
import { createDatabaseClient } from '../../src/infra/db/client.js'
import { runStartCommand } from '../../src/cli/start.js'
import { createApp } from '../../src/server/app.js'
import { createTestApp } from '../helpers/app.js'
import { createTempDbPath } from '../helpers/db.js'
import {
  completedEntriesForRequest,
  createMemoryLogCollector
} from '../helpers/logging.js'

const json = (value: unknown) => JSON.stringify(value)

const openResources: Array<{ close(): Promise<void> | void }> = []

afterEach(async () => {
  while (openResources.length > 0) {
    await openResources.pop()?.close()
  }
})

describe('http request logging', () => {
  it('emits request start and one terminal completion event', async () => {
    const testApp = await createTestApp({ clientIp: '203.0.113.5' })
    openResources.push(testApp)

    const response = await testApp.app.request('/jwks', { method: 'GET' })

    expect(response.status).toBe(200)

    const started = testApp.logs.find(
      (entry) => entry.event === 'http.request.started'
    )
    const requestId = started?.request_id

    expect(started).toMatchObject({
      event: 'http.request.started',
      method: 'GET',
      path: '/jwks',
      ip: '203.0.113.5'
    })
    expect(requestId).toEqual(expect.any(String))
    expect(
      completedEntriesForRequest(testApp.logs, String(requestId))
    ).toHaveLength(1)
    expect(
      completedEntriesForRequest(testApp.logs, String(requestId))[0]
    ).toMatchObject({
      event: 'http.request.completed',
      status_code: 200,
      duration_ms: expect.any(Number),
      ip: '203.0.113.5'
    })
  })

  it('emits one terminal completion event for handled errors', async () => {
    const testApp = await createTestApp({
      clientIp: '203.0.113.7',
      smtpConfigs: []
    })
    openResources.push(testApp)

    const response = await testApp.app.request('/email/start', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: json({ email: 'user@example.com' })
    })

    expect(response.status).toBe(503)

    const started = testApp.logs.find(
      (entry) => entry.event === 'http.request.started'
    )
    const requestId = String(started?.request_id)

    expect(completedEntriesForRequest(testApp.logs, requestId)).toHaveLength(1)
    expect(
      completedEntriesForRequest(testApp.logs, requestId)[0]
    ).toMatchObject({
      event: 'http.request.completed',
      status_code: 503,
      duration_ms: expect.any(Number),
      ip: '203.0.113.7'
    })
  })

  it('emits one diagnostic error log and one terminal completion event for unhandled exceptions', async () => {
    const dbPath = await createTempDbPath()
    await bootstrapDatabase(dbPath)
    const db = createDatabaseClient(dbPath)
    const logCollector = createMemoryLogCollector()
    const clientIps = new WeakMap<Request, string | null>()
    const app = createApp({
      db,
      getClientIp(request) {
        return clientIps.get(request) ?? null
      },
      issuer: 'https://issuer.example',
      origins: ['https://app.example.com'],
      rpId: 'example.com',
      logger: logCollector.logger
    })

    openResources.push({
      close() {
        db.close()
      }
    })

    app.get('/boom', () => {
      throw new Error('boom')
    })

    const request = new Request('http://mini-auth.test/boom')
    clientIps.set(request, '203.0.113.9')

    const response = await app.fetch(request)

    expect(response.status).toBe(500)

    const started = logCollector.entries.find(
      (entry) => entry.event === 'http.request.started'
    )
    const requestId = String(started?.request_id)
    const errorEntries = logCollector.entries.filter(
      (entry) =>
        entry.request_id === requestId && entry.error_message === 'boom'
    )

    expect(errorEntries).toHaveLength(1)
    expect(errorEntries[0]).toMatchObject({
      error_name: 'Error',
      error_message: 'boom'
    })
    expect(
      completedEntriesForRequest(logCollector.entries, requestId)
    ).toHaveLength(1)
    expect(
      completedEntriesForRequest(logCollector.entries, requestId)[0]
    ).toMatchObject({
      event: 'http.request.completed',
      status_code: 500,
      duration_ms: expect.any(Number),
      ip: '203.0.113.9'
    })
  })

  it('captures client ip from the direct socket path', async () => {
    const runtime = await startLoggedServer()
    openResources.push(runtime)

    const response = await fetch(`${runtime.url}/jwks`, {
      headers: {
        'x-forwarded-for': '198.51.100.9'
      }
    })

    expect(response.status).toBe(200)

    const completed = runtime.logs.find(
      (entry) => entry.event === 'http.request.completed'
    )

    expect(completed).toMatchObject({
      event: 'http.request.completed',
      status_code: 200,
      ip: expect.any(String)
    })
    expect(completed?.ip).not.toBe('198.51.100.9')
  })
})

async function startLoggedServer() {
  const dbPath = await createTempDbPath()
  const port = await getAvailablePort()
  const logCollector = createMemoryLogCollector()

  await bootstrapDatabase(dbPath)

  const server = await runStartCommand({
    dbPath,
    host: '127.0.0.1',
    port,
    issuer: 'https://issuer.example',
    rpId: 'example.com',
    origin: ['https://app.example.com'],
    loggerSink: logCollector.sink
  })

  return {
    ...server,
    logs: logCollector.entries,
    url: `http://127.0.0.1:${port}`
  }
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()

    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()

      if (!address || typeof address === 'string') {
        reject(new Error('Failed to allocate a test port'))
        return
      }

      const { port } = address
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve(port)
      })
    })
  })
}
