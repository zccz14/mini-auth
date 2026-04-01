import { createServer } from 'node:http'
import type { IncomingHttpHeaders } from 'node:http'
import { parseRuntimeConfig } from '../shared/config.js'
import { createDatabaseClient } from '../infra/db/client.js'
import { bootstrapKeys } from '../modules/jwks/service.js'
import { createApp } from '../server/app.js'
import { createRootLogger } from '../shared/logger.js'

type StartCommandInput = {
  loggerSink?: { write(line: string): void }
}

export async function runStartCommand(
  input: unknown
): Promise<{ close(): Promise<void> }> {
  const logger = createRootLogger({ sink: toLoggerSink(input) })
  const config = parseRuntimeConfig(input)
  const db = createDatabaseClient(config.dbPath)

  logger.info({ event: 'cli.start.started' }, 'Starting mini-auth server')

  await bootstrapKeys(db)

  const clientIps = new WeakMap<Request, string | null>()

  const app = createApp({
    db,
    getClientIp(request) {
      return clientIps.get(request) ?? null
    },
    issuer: config.issuer,
    logger,
    origins: config.origins,
    rpId: config.rpId
  })

  const server = createServer(async (req, res) => {
    const origin = `http://${req.headers.host ?? `${config.host}:${config.port}`}`
    const request = new Request(new URL(req.url ?? '/', origin), {
      method: req.method,
      headers: toHeaders(req.headers),
      body:
        req.method === 'GET' || req.method === 'HEAD'
          ? undefined
          : await readRequestBody(req)
    })
    clientIps.set(request, req.socket.remoteAddress ?? null)
    const response = await app.fetch(request)

    res.statusCode = response.status
    response.headers.forEach((value, key) => {
      res.setHeader(key, value)
    })
    const body = Buffer.from(await response.arrayBuffer())
    res.end(body)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.port, config.host, () => {
      server.off('error', reject)
      logger.info(
        {
          event: 'server.listening',
          host: config.host,
          port: config.port
        },
        'mini-auth server listening'
      )
      resolve()
    })
  })

  return {
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          db.close()
          logger.info(
            { event: 'server.shutdown.completed' },
            'mini-auth server shutdown complete'
          )
          resolve()
        })
      })
    }
  }
}

async function readRequestBody(
  request: NodeJS.ReadableStream
): Promise<string> {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return Buffer.concat(chunks).toString('utf8')
}

function toHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers()

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      result.set(key, value)
      continue
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        result.append(key, item)
      }
    }
  }

  return result
}

function toLoggerSink(
  input: unknown
): { write(line: string): void } | undefined {
  if (!input || typeof input !== 'object') {
    return undefined
  }

  return (input as StartCommandInput).loggerSink
}
