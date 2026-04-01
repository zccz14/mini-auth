import { bootstrapDatabase } from '../../src/infra/db/bootstrap.js'
import { createDatabaseClient } from '../../src/infra/db/client.js'
import { createApp } from '../../src/server/app.js'
import { bootstrapKeys } from '../../src/modules/jwks/service.js'
import { createTempDbPath } from './db.js'
import { createMemoryLogCollector } from './logging.js'

type CreateTestAppOptions = {
  clientIp?: string | null
  smtpConfigs?: Array<{
    host?: string
    port?: number
    username?: string
    password?: string
    fromEmail?: string
    fromName?: string
    secure?: boolean
    isActive?: boolean
    weight?: number
  }>
}

export async function createTestApp(options: CreateTestAppOptions = {}) {
  const dbPath = await createTempDbPath()
  await bootstrapDatabase(dbPath)
  const db = createDatabaseClient(dbPath)
  const logCollector = createMemoryLogCollector()

  await bootstrapKeys(db)

  const smtpConfigs = options.smtpConfigs ?? [
    {
      host: 'smtp.example.com',
      port: 587,
      username: 'mailer',
      password: 'secret',
      fromEmail: 'noreply@example.com',
      fromName: 'mini-auth',
      secure: false,
      isActive: true,
      weight: 1
    }
  ]

  for (const config of smtpConfigs) {
    db.prepare(
      [
        'INSERT INTO smtp_configs',
        '(host, port, username, password, from_email, from_name, secure, is_active, weight)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ].join(' ')
    ).run(
      config.host ?? 'smtp.example.com',
      config.port ?? 587,
      config.username ?? 'mailer',
      config.password ?? 'secret',
      config.fromEmail ?? 'noreply@example.com',
      config.fromName ?? '',
      (config.secure ?? false) ? 1 : 0,
      (config.isActive ?? true) ? 1 : 0,
      config.weight ?? 1
    )
  }

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

  return {
    app: {
      request(input: string, init?: RequestInit) {
        const request = new Request(
          new URL(input, 'http://mini-auth.test'),
          init
        )
        clientIps.set(request, options.clientIp ?? null)
        return app.fetch(request)
      }
    },
    db,
    dbPath,
    logs: logCollector.entries,
    close() {
      db.close()
    }
  }
}
