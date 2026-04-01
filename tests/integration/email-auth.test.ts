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
        throw new Error('OTP seam not installed for email-auth tests')
      }

      return seam.sendOtpMail(
        config as { fromEmail: string; fromName?: string },
        email,
        code
      )
    }
  }
})

import { hashValue } from '../../src/shared/crypto.js'
import { createTestApp } from '../helpers/app.js'
import {
  createOtpMailSeam,
  extractOtpCode,
  findLatestOtpMail
} from '../helpers/mock-smtp.js'

const json = (value: unknown) => JSON.stringify(value)

const openApps: Array<{ close(): void }> = []

afterEach(() => {
  otpSeam.current = null

  while (openApps.length > 0) {
    openApps.pop()?.close()
  }
})

describe('email auth routes', () => {
  it('captures outgoing otp email in mock mailbox', async () => {
    otpSeam.current = createOtpMailSeam()
    const testApp = await createTestApp()
    openApps.push(testApp)

    const response = await testApp.app.request('/email/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json({ email: 'user@example.com' })
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    const mailbox = otpSeam.current.mailbox

    expect(mailbox).toHaveLength(1)
    expect(mailbox[0]?.to).toBe('user@example.com')
    expect(mailbox[0]?.subject).toContain('verification code')
    expect(extractOtpCode(mailbox[0]?.text ?? '')).toMatch(/^\d{6}$/)
  })

  it('email/start returns the same success response for existing and new emails', async () => {
    otpSeam.current = createOtpMailSeam()
    const testApp = await createTestApp()
    openApps.push(testApp)

    testApp.db
      .prepare(
        'INSERT INTO users (id, email, email_verified_at) VALUES (?, ?, ?)'
      )
      .run('user-existing', 'existing@example.com', '2026-03-31T00:00:00.000Z')

    const existingResponse = await testApp.app.request('/email/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json({ email: 'existing@example.com' })
    })
    const newResponse = await testApp.app.request('/email/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json({ email: 'new@example.com' })
    })

    expect(existingResponse.status).toBe(200)
    expect(await existingResponse.json()).toEqual({ ok: true })
    expect(newResponse.status).toBe(200)
    expect(await newResponse.json()).toEqual({ ok: true })
  })

  it('email/start returns 503 smtp_not_configured when no active smtp exists', async () => {
    otpSeam.current = createOtpMailSeam()
    const testApp = await createTestApp({ smtpConfigs: [] })
    openApps.push(testApp)

    const response = await testApp.app.request('/email/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json({ email: 'user@example.com' })
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'smtp_not_configured' })
  })

  it('email/start invalidates the pending otp if smtp send fails', async () => {
    otpSeam.current = createOtpMailSeam()
    const testApp = await createTestApp()
    openApps.push(testApp)
    otpSeam.current.failNextSend()

    const response = await testApp.app.request('/email/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json({ email: 'user@example.com' })
    })

    const row = testApp.db
      .prepare('SELECT consumed_at FROM email_otps WHERE email = ?')
      .get('user@example.com') as { consumed_at: string | null } | undefined

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'smtp_temporarily_unavailable'
    })
    expect(row?.consumed_at).toBeTruthy()
  })

  it('verify creates a user when the email is first seen', async () => {
    otpSeam.current = createOtpMailSeam()
    const testApp = await createTestApp()
    openApps.push(testApp)

    await testApp.app.request('/email/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json({ email: 'first@example.com' })
    })

    const code = extractOtpCode(
      findLatestOtpMail(otpSeam.current.mailbox, 'first@example.com')?.text ??
        ''
    )
    const response = await testApp.app.request('/email/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json({ email: 'first@example.com', code })
    })

    const userCount = testApp.db
      .prepare('SELECT COUNT(*) AS count FROM users WHERE email = ?')
      .get('first@example.com') as { count: number }

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      access_token: expect.any(String),
      token_type: 'Bearer',
      expires_in: 900,
      refresh_token: expect.any(String)
    })
    expect(userCount.count).toBe(1)
  })

  it('verify signs in an existing user without creating a duplicate', async () => {
    otpSeam.current = createOtpMailSeam()
    const testApp = await createTestApp()
    openApps.push(testApp)

    testApp.db
      .prepare(
        'INSERT INTO users (id, email, email_verified_at) VALUES (?, ?, ?)'
      )
      .run('user-existing', 'existing@example.com', '2026-03-31T00:00:00.000Z')

    await testApp.app.request('/email/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json({ email: 'existing@example.com' })
    })

    const code = extractOtpCode(
      findLatestOtpMail(otpSeam.current.mailbox, 'existing@example.com')
        ?.text ?? ''
    )
    const response = await testApp.app.request('/email/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json({ email: 'existing@example.com', code })
    })

    const users = testApp.db
      .prepare('SELECT id FROM users WHERE email = ?')
      .all('existing@example.com') as Array<{ id: string }>

    expect(response.status).toBe(200)
    expect(users).toEqual([{ id: 'user-existing' }])
  })

  it('verify rejects expired otp', async () => {
    otpSeam.current = createOtpMailSeam()
    const testApp = await createTestApp()
    openApps.push(testApp)

    testApp.db
      .prepare(
        'INSERT INTO email_otps (email, code_hash, expires_at) VALUES (?, ?, ?)'
      )
      .run(
        'expired@example.com',
        hashValue('123456'),
        '2020-01-01T00:00:00.000Z'
      )

    const response = await testApp.app.request('/email/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json({ email: 'expired@example.com', code: '123456' })
    })

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'invalid_email_otp' })
  })

  it('verify rejects replayed otp', async () => {
    otpSeam.current = createOtpMailSeam()
    const testApp = await createTestApp()
    openApps.push(testApp)

    await testApp.app.request('/email/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json({ email: 'replay@example.com' })
    })

    const code = extractOtpCode(
      findLatestOtpMail(otpSeam.current.mailbox, 'replay@example.com')?.text ??
        ''
    )

    const firstResponse = await testApp.app.request('/email/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json({ email: 'replay@example.com', code })
    })
    const secondResponse = await testApp.app.request('/email/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json({ email: 'replay@example.com', code })
    })

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(401)
    expect(await secondResponse.json()).toEqual({ error: 'invalid_email_otp' })
  })
})
