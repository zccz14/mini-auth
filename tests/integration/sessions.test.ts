import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { OtpMailSeam } from '../helpers/mock-smtp.js'
import { bootstrapDatabase } from '../../src/infra/db/bootstrap.js'
import { createDatabaseClient } from '../../src/infra/db/client.js'
import { importSmtpConfigs } from '../../src/infra/smtp/config-import.js'
import { runStartCommand } from '../../src/cli/start.js'
import { hashValue } from '../../src/shared/crypto.js'
import {
  createSession,
  revokeSessionByRefreshTokenHash
} from '../../src/modules/session/repo.js'
import { createTempDbPath } from '../helpers/db.js'
import {
  createOtpMailSeam,
  extractOtpCode,
  findLatestOtpMail,
  startConfigurableMockSmtpServer,
  startMockSmtpServer
} from '../helpers/mock-smtp.js'

const json = (value: unknown) => JSON.stringify(value)
const otpSeam = { current: null as OtpMailSeam | null }

const openApps: Array<{ close(): void }> = []

afterEach(() => {
  vi.doUnmock('../../src/infra/smtp/mailer.js')
  vi.resetModules()
  otpSeam.current = null

  while (openApps.length > 0) {
    openApps.pop()?.close()
  }
})

describe('session routes', () => {
  it('refresh rotates the refresh token', async () => {
    const testApp = await createSignedInApp('rotate@example.com')
    openApps.push(testApp)

    const response = await testApp.app.request('/session/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json({ refresh_token: testApp.tokens.refresh_token })
    })

    const body = await response.json()
    const sessions = testApp.db
      .prepare(
        'SELECT id, revoked_at FROM sessions ORDER BY created_at ASC, id ASC'
      )
      .all() as Array<{ id: string; revoked_at: string | null }>
    const originalSession = sessions.find(
      (session) => session.id === testApp.sessionId
    )
    const rotatedSession = sessions.find(
      (session) => session.id !== testApp.sessionId
    )

    expect(response.status).toBe(200)
    expect(body.refresh_token).not.toBe(testApp.tokens.refresh_token)
    expect(sessions).toHaveLength(2)
    expect(originalSession?.revoked_at).toBeTruthy()
    expect(rotatedSession?.revoked_at).toBeNull()
  })

  it('refresh rejects revoked session reuse', async () => {
    const testApp = await createSignedInApp('refresh-reuse@example.com')
    openApps.push(testApp)

    const firstResponse = await testApp.app.request('/session/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json({ refresh_token: testApp.tokens.refresh_token })
    })
    const secondResponse = await testApp.app.request('/session/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json({ refresh_token: testApp.tokens.refresh_token })
    })

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(401)
    expect(await secondResponse.json()).toEqual({
      error: 'invalid_refresh_token'
    })
  })

  it('refresh rejects expired session', async () => {
    const testApp = await createSignedInApp('refresh-expired@example.com')
    openApps.push(testApp)

    testApp.db
      .prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
      .run('2020-01-01T00:00:00.000Z', testApp.sessionId)

    const response = await testApp.app.request('/session/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json({ refresh_token: testApp.tokens.refresh_token })
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'invalid_refresh_token' })
  })

  it('refresh token claim only succeeds once across database clients', async () => {
    const dbPath = await createTempDbPath()
    await bootstrapDatabase(dbPath)
    const writerDb = createDatabaseClient(dbPath)
    const readerDb = createDatabaseClient(dbPath)

    try {
      writerDb
        .prepare(
          'INSERT INTO users (id, email, email_verified_at) VALUES (?, ?, ?)'
        )
        .run('user-1', 'user-1@example.com', '2030-01-01T00:00:00.000Z')

      createSession(writerDb, {
        userId: 'user-1',
        refreshTokenHash: 'refresh-hash',
        expiresAt: '2099-01-01T00:00:00.000Z'
      })

      const firstClaim = revokeSessionByRefreshTokenHash(
        writerDb,
        'refresh-hash',
        '2030-01-01T00:00:00.000Z'
      )
      const secondClaim = revokeSessionByRefreshTokenHash(
        readerDb,
        'refresh-hash',
        '2030-01-01T00:00:01.000Z'
      )

      expect(firstClaim).toMatchObject({
        userId: 'user-1',
        refreshTokenHash: 'refresh-hash'
      })
      expect(secondClaim).toBeNull()
    } finally {
      writerDb.close()
      readerDb.close()
    }
  })

  it('logout revokes the session referenced by sid', async () => {
    const testApp = await createSignedInApp('logout@example.com')
    openApps.push(testApp)

    const response = await testApp.app.request('/session/logout', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${testApp.tokens.access_token}`
      }
    })

    const session = testApp.db
      .prepare('SELECT revoked_at FROM sessions WHERE id = ?')
      .get(testApp.sessionId) as { revoked_at: string | null }

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(session.revoked_at).toBeTruthy()
  })

  it('logout makes the current refresh token unusable', async () => {
    const testApp = await createSignedInApp('logout-refresh@example.com')
    openApps.push(testApp)

    const logoutResponse = await testApp.app.request('/session/logout', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${testApp.tokens.access_token}`
      }
    })
    const refreshResponse = await testApp.app.request('/session/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json({ refresh_token: testApp.tokens.refresh_token })
    })

    expect(logoutResponse.status).toBe(200)
    expect(refreshResponse.status).toBe(401)
    expect(await refreshResponse.json()).toEqual({
      error: 'invalid_refresh_token'
    })
  })

  it('me returns user id, email, credentials, and active sessions', async () => {
    const testApp = await createSignedInApp('me@example.com')
    openApps.push(testApp)

    const response = await testApp.app.request('/me', {
      headers: {
        authorization: `Bearer ${testApp.tokens.access_token}`
      }
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      user_id: testApp.userId,
      email: 'me@example.com',
      webauthn_credentials: [],
      active_sessions: [
        {
          id: testApp.sessionId,
          created_at: expect.any(String),
          expires_at: expect.any(String)
        }
      ]
    })
  })

  it('me excludes revoked and expired sessions from active_sessions', async () => {
    const testApp = await createSignedInApp('active@example.com')
    openApps.push(testApp)

    testApp.db
      .prepare(
        [
          'INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at, revoked_at)',
          'VALUES (?, ?, ?, ?, ?)'
        ].join(' ')
      )
      .run(
        'session-revoked',
        testApp.userId,
        hashValue('revoked-token'),
        '2099-01-01T00:00:00.000Z',
        '2026-04-01T00:00:00.000Z'
      )
    testApp.db
      .prepare(
        'INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at) VALUES (?, ?, ?, ?)'
      )
      .run(
        'session-expired',
        testApp.userId,
        hashValue('expired-token'),
        '2020-01-01T00:00:00.000Z'
      )

    const response = await testApp.app.request('/me', {
      headers: {
        authorization: `Bearer ${testApp.tokens.access_token}`
      }
    })

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.active_sessions).toHaveLength(1)
    expect(body.active_sessions[0]?.id).toBe(testApp.sessionId)
  })

  it('me rejects missing or invalid bearer token', async () => {
    const testApp = await createSignedInApp('reject@example.com')
    openApps.push(testApp)

    const missingResponse = await testApp.app.request('/me')
    const invalidResponse = await testApp.app.request('/me', {
      headers: {
        authorization: 'Bearer not-a-token'
      }
    })

    expect(missingResponse.status).toBe(401)
    expect(await missingResponse.json()).toEqual({
      error: 'invalid_access_token'
    })
    expect(invalidResponse.status).toBe(401)
    expect(await invalidResponse.json()).toEqual({
      error: 'invalid_access_token'
    })
  })

  it('jwks returns public keys only', async () => {
    const testApp = await createSignedInApp('jwks@example.com')
    openApps.push(testApp)

    const response = await testApp.app.request('/jwks')
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.keys).toHaveLength(1)
    expect(body.keys[0]).toMatchObject({
      alg: 'EdDSA',
      crv: 'Ed25519',
      kty: 'OKP',
      use: 'sig'
    })
    expect(body.keys[0]).not.toHaveProperty('d')
  })

  it('start fails fast when required webauthn config is missing', async () => {
    await expect(
      runStartCommand({
        dbPath: '/tmp/mini-auth.sqlite',
        issuer: 'https://issuer.example'
      })
    ).rejects.toThrowError()
  })

  it('start succeeds with valid required config and can be cleanly started and stopped', async () => {
    const smtpServer = await startMockSmtpServer()
    const dbPath = await createTempDbPath()
    const port = await getAvailablePort()

    await bootstrapDatabase(dbPath)
    const db = createDatabaseClient(dbPath)

    await importSmtpConfigs(
      db,
      await writeRuntimeSmtpConfigJson({
        host: '127.0.0.1',
        port: smtpServer.port,
        username: 'mailer',
        password: 'secret',
        from_email: 'noreply@example.com',
        from_name: 'mini-auth'
      })
    )
    db.close()

    const server = await runStartCommand({
      dbPath,
      host: '127.0.0.1',
      port,
      issuer: 'https://issuer.example',
      rpId: 'example.com',
      origin: ['https://app.example.com']
    })

    const response = await fetch(`http://127.0.0.1:${port}/email/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json({ email: 'runtime@example.com' })
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(smtpServer.mailbox).toHaveLength(1)
    expect(smtpServer.mailbox[0]?.to).toBe('runtime@example.com')

    await server.close()
    await smtpServer.close()
  })

  it('runtime smtp negative response returns 503 and invalidates the otp', async () => {
    const smtpServer = await startConfigurableMockSmtpServer({
      onRcptTo: ['550 mailbox unavailable']
    })
    const dbPath = await createTempDbPath()
    const port = await getAvailablePort()

    await bootstrapDatabase(dbPath)
    const db = createDatabaseClient(dbPath)

    await importSmtpConfigs(
      db,
      await writeRuntimeSmtpConfigJson({
        host: '127.0.0.1',
        port: smtpServer.port,
        username: 'mailer',
        password: 'secret',
        from_email: 'noreply@example.com',
        from_name: 'mini-auth'
      })
    )
    db.close()

    const server = await runStartCommand({
      dbPath,
      host: '127.0.0.1',
      port,
      issuer: 'https://issuer.example',
      rpId: 'example.com',
      origin: ['https://app.example.com']
    })

    const response = await fetch(`http://127.0.0.1:${port}/email/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json({ email: 'runtime-failure@example.com' })
    })

    const verifyDb = createDatabaseClient(dbPath)
    const otpRow = verifyDb
      .prepare('SELECT consumed_at FROM email_otps WHERE email = ?')
      .get('runtime-failure@example.com') as
      | { consumed_at: string | null }
      | undefined
    verifyDb.close()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'smtp_temporarily_unavailable'
    })
    expect(otpRow?.consumed_at).toBeTruthy()
    expect(smtpServer.mailbox).toHaveLength(0)

    await server.close()
    await smtpServer.close()
  })
})

async function createSignedInApp(email: string) {
  otpSeam.current = createOtpMailSeam()
  const { createTestApp } = await loadMockedAppHelpers()
  const testApp = await createTestApp()
  const seam = getCurrentOtpSeam()

  await testApp.app.request('/email/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: json({ email })
  })

  const code = extractOtpCode(
    findLatestOtpMail(seam.mailbox, email)?.text ?? ''
  )
  const verifyResponse = await testApp.app.request('/email/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: json({ email, code })
  })

  const tokens = (await verifyResponse.json()) as {
    access_token: string
    refresh_token: string
  }
  const user = testApp.db
    .prepare('SELECT id FROM users WHERE email = ?')
    .get(email) as { id: string }
  const session = testApp.db
    .prepare(
      'SELECT id FROM sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1'
    )
    .get(user.id) as { id: string }

  return {
    ...testApp,
    tokens,
    userId: user.id,
    sessionId: session.id
  }
}

function getCurrentOtpSeam(): OtpMailSeam {
  if (!otpSeam.current) {
    throw new Error('OTP seam not installed for session tests')
  }

  return otpSeam.current
}

async function loadMockedAppHelpers() {
  vi.resetModules()
  vi.doMock('../../src/infra/smtp/mailer.js', async () => {
    const actual = await vi.importActual<
      typeof import('../../src/infra/smtp/mailer.js')
    >('../../src/infra/smtp/mailer.js')

    return {
      ...actual,
      async sendOtpMail(config: unknown, email: string, code: string) {
        const seam = otpSeam.current

        if (!seam) {
          throw new Error('OTP seam not installed for session tests')
        }

        return seam.sendOtpMail(
          config as { fromEmail: string; fromName?: string },
          email,
          code
        )
      }
    }
  })

  return import('../helpers/app.js')
}

async function writeRuntimeSmtpConfigJson(row: {
  host: string
  port: number
  username: string
  password: string
  from_email: string
  from_name: string
}) {
  const directoryPath = await mkdtemp(join(tmpdir(), 'mini-auth-runtime-smtp-'))
  const filePath = join(directoryPath, 'smtp.json')

  await writeFile(filePath, JSON.stringify([row]), 'utf8')

  return filePath
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
