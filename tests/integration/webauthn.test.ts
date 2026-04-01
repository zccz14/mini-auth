import { afterEach, describe, expect, it, vi } from 'vitest'

import type { OtpMailSeam } from '../helpers/mock-smtp.js'

const otpSeam = vi.hoisted(() => ({ current: null as OtpMailSeam | null }))

vi.mock('../../src/infra/smtp/mailer.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../src/infra/smtp/mailer.js')
  >('../../src/infra/smtp/mailer.js')

  return {
    ...actual,
    async sendOtpMail(config: unknown, email: string, code: string) {
      const seam = otpSeam.current

      if (!seam) {
        throw new Error('OTP seam not installed for webauthn tests')
      }

      return seam.sendOtpMail(
        config as { fromEmail: string; fromName?: string },
        email,
        code
      )
    }
  }
})

import { createDatabaseClient } from '../../src/infra/db/client.js'
import { mintSessionTokens } from '../../src/modules/session/service.js'
import { consumeChallengeAndUpdateCredentialCounter } from '../../src/modules/webauthn/repo.js'
import { createTestApp } from '../helpers/app.js'
import {
  createOtpMailSeam,
  extractOtpCode,
  findLatestOtpMail
} from '../helpers/mock-smtp.js'
import { createTestPasskey } from '../helpers/webauthn.js'

const json = (value: unknown) => JSON.stringify(value)
const origin = 'https://app.example.com'

const openApps: Array<{ close(): void }> = []

afterEach(() => {
  vi.useRealTimers()
  otpSeam.current = null

  while (openApps.length > 0) {
    openApps.pop()?.close()
  }
})

describe('webauthn routes', () => {
  it('register/options requires authenticated user', async () => {
    const testApp = await createTestApp()
    openApps.push(testApp)

    const response = await testApp.app.request('/webauthn/register/options', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json({})
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'invalid_access_token' })
  })

  it('register/verify stores a discoverable credential', async () => {
    const testApp = await createSignedInApp('register@example.com')
    openApps.push(testApp)
    const passkey = createTestPasskey('register@example.com')

    const optionsResponse = await testApp.app.request(
      '/webauthn/register/options',
      {
        method: 'POST',
        headers: authHeaders(testApp.tokens.access_token)
      }
    )
    const optionsBody = await optionsResponse.json()
    const credential = passkey.createRegistrationCredential(
      optionsBody.publicKey,
      origin
    )

    const verifyResponse = await testApp.app.request(
      '/webauthn/register/verify',
      {
        method: 'POST',
        headers: authHeaders(testApp.tokens.access_token),
        body: json({ request_id: optionsBody.request_id, credential })
      }
    )

    const storedCredential = testApp.db
      .prepare(
        'SELECT user_id, credential_id, transports, counter FROM webauthn_credentials WHERE user_id = ?'
      )
      .get(testApp.userId) as
      | {
          user_id: string
          credential_id: string
          transports: string
          counter: number
        }
      | undefined

    expect(optionsResponse.status).toBe(200)
    expect(optionsBody).toMatchObject({
      request_id: expect.any(String),
      publicKey: {
        challenge: expect.any(String),
        rp: { id: 'example.com', name: 'mini-auth' },
        user: {
          id: expect.any(String),
          name: 'register@example.com',
          displayName: 'register@example.com'
        },
        timeout: 300000,
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'preferred'
        }
      }
    })
    expect(verifyResponse.status).toBe(200)
    expect(await verifyResponse.json()).toEqual({ ok: true })
    expect(storedCredential).toEqual({
      user_id: testApp.userId,
      credential_id: passkey.credentialId,
      transports: 'internal',
      counter: 0
    })
  })

  it('second register/options invalidates the first unused request id', async () => {
    const testApp = await createSignedInApp('replace-register@example.com')
    openApps.push(testApp)
    const stalePasskey = createTestPasskey('replace-register-stale')
    const freshPasskey = createTestPasskey('replace-register-fresh')

    const firstOptions = await getRegisterOptions(testApp)
    const secondOptions = await getRegisterOptions(testApp)

    const staleResponse = await testApp.app.request(
      '/webauthn/register/verify',
      {
        method: 'POST',
        headers: authHeaders(testApp.tokens.access_token),
        body: json({
          request_id: firstOptions.request_id,
          credential: stalePasskey.createRegistrationCredential(
            firstOptions.publicKey,
            origin
          )
        })
      }
    )
    const freshResponse = await testApp.app.request(
      '/webauthn/register/verify',
      {
        method: 'POST',
        headers: authHeaders(testApp.tokens.access_token),
        body: json({
          request_id: secondOptions.request_id,
          credential: freshPasskey.createRegistrationCredential(
            secondOptions.publicKey,
            origin
          )
        })
      }
    )

    const storedCredentials = testApp.db
      .prepare(
        'SELECT credential_id FROM webauthn_credentials WHERE user_id = ?'
      )
      .all(testApp.userId) as Array<{ credential_id: string }>

    expect(staleResponse.status).toBe(400)
    expect(await staleResponse.json()).toEqual({
      error: 'invalid_webauthn_registration'
    })
    expect(freshResponse.status).toBe(200)
    expect(storedCredentials).toEqual([
      { credential_id: freshPasskey.credentialId }
    ])
  })

  it('authenticate/options returns independent request ids for concurrent requests', async () => {
    const testApp = await createTestApp()
    openApps.push(testApp)

    const [firstResponse, secondResponse] = await Promise.all([
      testApp.app.request('/webauthn/authenticate/options', { method: 'POST' }),
      testApp.app.request('/webauthn/authenticate/options', { method: 'POST' })
    ])
    const firstBody = await firstResponse.json()
    const secondBody = await secondResponse.json()

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    expect(firstBody.request_id).not.toBe(secondBody.request_id)
    expect(firstBody.publicKey.challenge).not.toBe(
      secondBody.publicKey.challenge
    )
  })

  it('authenticate/options omits allowCredentials', async () => {
    const testApp = await createTestApp()
    openApps.push(testApp)

    const response = await testApp.app.request(
      '/webauthn/authenticate/options',
      {
        method: 'POST'
      }
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      request_id: expect.any(String),
      publicKey: {
        challenge: expect.any(String),
        rpId: 'example.com',
        timeout: 300000,
        userVerification: 'preferred'
      }
    })
    expect(body.publicKey.allowCredentials).toBeUndefined()
  })

  it('authenticate/verify signs in by credential id', async () => {
    const testApp = await createSignedInApp('signin@example.com')
    openApps.push(testApp)
    const passkey = await registerPasskey(testApp, 'signin@example.com')

    const optionsResponse = await testApp.app.request(
      '/webauthn/authenticate/options',
      {
        method: 'POST'
      }
    )
    const optionsBody = await optionsResponse.json()
    const credential = passkey.createAuthenticationCredential(
      optionsBody.publicKey,
      origin
    )

    const verifyResponse = await testApp.app.request(
      '/webauthn/authenticate/verify',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: json({ request_id: optionsBody.request_id, credential })
      }
    )
    const storedCredential = testApp.db
      .prepare('SELECT counter FROM webauthn_credentials WHERE user_id = ?')
      .get(testApp.userId) as { counter: number }

    expect(verifyResponse.status).toBe(200)
    expect(await verifyResponse.json()).toMatchObject({
      access_token: expect.any(String),
      token_type: 'Bearer',
      expires_in: 900,
      refresh_token: expect.any(String)
    })
    expect(storedCredential.counter).toBe(1)
  })

  it('authenticate/verify rejects replayed or expired challenges', async () => {
    const testApp = await createSignedInApp('replay@example.com')
    openApps.push(testApp)
    const passkey = await registerPasskey(testApp, 'replay@example.com')

    const replayOptions = await getAuthOptions(testApp)
    const replayCredential = passkey.createAuthenticationCredential(
      replayOptions.publicKey,
      origin
    )
    const firstResponse = await verifyAuth(
      testApp,
      replayOptions.request_id,
      replayCredential
    )
    const secondResponse = await verifyAuth(
      testApp,
      replayOptions.request_id,
      replayCredential
    )

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'))
    const expiredOptions = await getAuthOptions(testApp)
    testApp.db
      .prepare(
        'UPDATE webauthn_challenges SET expires_at = ? WHERE request_id = ?'
      )
      .run('2029-12-31T00:00:00.000Z', expiredOptions.request_id)
    const expiredCredential = passkey.createAuthenticationCredential(
      expiredOptions.publicKey,
      origin
    )
    const expiredResponse = await verifyAuth(
      testApp,
      expiredOptions.request_id,
      expiredCredential
    )

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(400)
    expect(await secondResponse.json()).toEqual({
      error: 'invalid_webauthn_authentication'
    })
    expect(expiredResponse.status).toBe(400)
    expect(await expiredResponse.json()).toEqual({
      error: 'invalid_webauthn_authentication'
    })
  })

  it('register/verify rejects duplicate credential ids', async () => {
    const testApp = await createTestApp()
    openApps.push(testApp)
    const firstApp = await signInOnExistingApp(
      testApp,
      'first-passkey@example.com'
    )
    const secondApp = await signInOnExistingApp(
      testApp,
      'second-passkey@example.com'
    )
    const passkey = createTestPasskey('shared-passkey')

    const firstOptions = await getRegisterOptions(firstApp)
    const firstCredential = passkey.createRegistrationCredential(
      firstOptions.publicKey,
      origin
    )
    const firstVerify = await firstApp.app.request(
      '/webauthn/register/verify',
      {
        method: 'POST',
        headers: authHeaders(firstApp.tokens.access_token),
        body: json({
          request_id: firstOptions.request_id,
          credential: firstCredential
        })
      }
    )

    const secondOptions = await getRegisterOptions(secondApp)
    const secondCredential = passkey.createRegistrationCredential(
      secondOptions.publicKey,
      origin
    )
    const secondVerify = await secondApp.app.request(
      '/webauthn/register/verify',
      {
        method: 'POST',
        headers: authHeaders(secondApp.tokens.access_token),
        body: json({
          request_id: secondOptions.request_id,
          credential: secondCredential
        })
      }
    )

    expect(firstVerify.status).toBe(200)
    expect(secondVerify.status).toBe(409)
    expect(await secondVerify.json()).toEqual({ error: 'duplicate_credential' })
  })

  it('register/verify rejects replayed request ids before adding side effects', async () => {
    const testApp = await createSignedInApp('register-replay@example.com')
    openApps.push(testApp)
    const passkey = createTestPasskey('register-replay')

    const options = await getRegisterOptions(testApp)
    const credential = passkey.createRegistrationCredential(
      options.publicKey,
      origin
    )

    const firstResponse = await testApp.app.request(
      '/webauthn/register/verify',
      {
        method: 'POST',
        headers: authHeaders(testApp.tokens.access_token),
        body: json({ request_id: options.request_id, credential })
      }
    )
    const secondResponse = await testApp.app.request(
      '/webauthn/register/verify',
      {
        method: 'POST',
        headers: authHeaders(testApp.tokens.access_token),
        body: json({ request_id: options.request_id, credential })
      }
    )

    const storedCredentials = testApp.db
      .prepare(
        'SELECT credential_id FROM webauthn_credentials WHERE user_id = ?'
      )
      .all(testApp.userId) as Array<{ credential_id: string }>

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(400)
    expect(await secondResponse.json()).toEqual({
      error: 'invalid_webauthn_registration'
    })
    expect(storedCredentials).toEqual([{ credential_id: passkey.credentialId }])
  })

  it('delete credential only succeeds for the owning user', async () => {
    const ownerApp = await createSignedInApp('owner@example.com')
    const otherApp = await createSignedInApp('other@example.com')
    openApps.push(ownerApp, otherApp)

    await registerPasskey(ownerApp, 'owner@example.com')
    const credential = ownerApp.db
      .prepare('SELECT id FROM webauthn_credentials WHERE user_id = ?')
      .get(ownerApp.userId) as { id: string }

    const deniedResponse = await otherApp.app.request(
      `/webauthn/credentials/${credential.id}`,
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${otherApp.tokens.access_token}`
        }
      }
    )
    const allowedResponse = await ownerApp.app.request(
      `/webauthn/credentials/${credential.id}`,
      {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${ownerApp.tokens.access_token}`
        }
      }
    )
    const deleted = ownerApp.db
      .prepare('SELECT id FROM webauthn_credentials WHERE id = ?')
      .get(credential.id)

    expect(deniedResponse.status).toBe(404)
    expect(allowedResponse.status).toBe(200)
    expect(await allowedResponse.json()).toEqual({ ok: true })
    expect(deleted).toBeUndefined()
  })

  it('webauthn authenticate requests do not invalidate each other', async () => {
    const testApp = await createSignedInApp('multi-auth@example.com')
    openApps.push(testApp)
    const passkey = await registerPasskey(testApp, 'multi-auth@example.com')
    const firstOptions = await getAuthOptions(testApp)
    const secondOptions = await getAuthOptions(testApp)

    const firstResponse = await verifyAuth(
      testApp,
      firstOptions.request_id,
      passkey.createAuthenticationCredential(firstOptions.publicKey, origin)
    )
    const secondResponse = await verifyAuth(
      testApp,
      secondOptions.request_id,
      passkey.createAuthenticationCredential(secondOptions.publicKey, origin)
    )

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
  })

  it('replayed assertions across concurrent auth attempts cannot mint multiple sessions', async () => {
    const testApp = await createSignedInApp('webauthn-race@example.com')
    openApps.push(testApp)
    const passkey = await registerPasskey(testApp, 'webauthn-race@example.com')
    const [firstOptions, secondOptions] = await Promise.all([
      getAuthOptions(testApp),
      getAuthOptions(testApp)
    ])
    const firstAssertion = passkey.createAuthenticationCredentialWithCounter(
      firstOptions.publicKey,
      origin,
      1
    )
    const secondAssertion = passkey.createAuthenticationCredentialWithCounter(
      secondOptions.publicKey,
      origin,
      1
    )
    const credential = testApp.db
      .prepare('SELECT id, user_id, counter FROM webauthn_credentials LIMIT 1')
      .get() as { id: string; user_id: string; counter: number }
    const writerDb = createDatabaseClient(testApp.dbPath)
    const readerDb = createDatabaseClient(testApp.dbPath)

    try {
      const firstClaim = consumeChallengeAndUpdateCredentialCounter(writerDb, {
        requestId: firstOptions.request_id,
        credentialId: credential.id,
        expectedCounter: credential.counter,
        nextCounter: 1,
        now: '2030-01-01T00:00:00.000Z'
      })
      const secondClaim = consumeChallengeAndUpdateCredentialCounter(readerDb, {
        requestId: secondOptions.request_id,
        credentialId: credential.id,
        expectedCounter: credential.counter,
        nextCounter: 1,
        now: '2030-01-01T00:00:01.000Z'
      })

      if (firstClaim) {
        await mintSessionTokens(writerDb, {
          userId: credential.user_id,
          issuer: 'https://issuer.example'
        })
      }

      if (secondClaim) {
        await mintSessionTokens(readerDb, {
          userId: credential.user_id,
          issuer: 'https://issuer.example'
        })
      }

      const sessions = testApp.db
        .prepare('SELECT id FROM sessions WHERE user_id = ?')
        .all(credential.user_id) as Array<{ id: string }>
      const storedCredential = testApp.db
        .prepare('SELECT counter FROM webauthn_credentials WHERE id = ?')
        .get(credential.id) as { counter: number }

      expect(firstAssertion.response.signature).not.toBe(
        secondAssertion.response.signature
      )
      expect(firstClaim).toBe(true)
      expect(secondClaim).toBe(false)
      expect(sessions).toHaveLength(2)
      expect(storedCredential.counter).toBe(1)
    } finally {
      writerDb.close()
      readerDb.close()
    }
  })
})

async function createSignedInApp(email: string) {
  otpSeam.current = createOtpMailSeam()
  const testApp = await createTestApp()

  return signInOnExistingApp(testApp, email)
}

async function signInOnExistingApp(
  testApp: Awaited<ReturnType<typeof createTestApp>>,
  email: string
) {
  const seam = getOrCreateOtpSeam()

  await testApp.app.request('/email/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: json({ email })
  })

  const latestMail = findLatestOtpMail(seam.mailbox, email)
  const code = extractOtpCode(latestMail?.text ?? '')
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

  return {
    ...testApp,
    tokens,
    userId: user.id
  }
}

function getOrCreateOtpSeam(): OtpMailSeam {
  if (!otpSeam.current) {
    otpSeam.current = createOtpMailSeam()
  }

  return otpSeam.current
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json'
  }
}

async function getRegisterOptions(
  testApp: Awaited<ReturnType<typeof createSignedInApp>>
) {
  const response = await testApp.app.request('/webauthn/register/options', {
    method: 'POST',
    headers: authHeaders(testApp.tokens.access_token)
  })

  return response.json()
}

async function getAuthOptions(
  testApp: Awaited<ReturnType<typeof createSignedInApp>>
) {
  const response = await testApp.app.request('/webauthn/authenticate/options', {
    method: 'POST'
  })

  return response.json()
}

async function registerPasskey(
  testApp: Awaited<ReturnType<typeof createSignedInApp>>,
  seed: string
) {
  const passkey = createTestPasskey(seed)
  const options = await getRegisterOptions(testApp)
  const credential = passkey.createRegistrationCredential(
    options.publicKey,
    origin
  )
  const response = await testApp.app.request('/webauthn/register/verify', {
    method: 'POST',
    headers: authHeaders(testApp.tokens.access_token),
    body: json({ request_id: options.request_id, credential })
  })

  expect(response.status).toBe(200)

  return passkey
}

async function verifyAuth(
  testApp: Awaited<ReturnType<typeof createSignedInApp>>,
  requestId: string,
  credential: unknown
) {
  return testApp.app.request('/webauthn/authenticate/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: json({ request_id: requestId, credential })
  })
}
