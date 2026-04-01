import { randomInt } from 'node:crypto'
import type { DatabaseClient } from '../../infra/db/client.js'
import {
  listSmtpConfigs,
  selectSmtpConfig,
  sendOtpMail
} from '../../infra/smtp/mailer.js'
import { hashValue } from '../../shared/crypto.js'
import {
  TTLS,
  getExpiresAtUnixSeconds,
  getUnixTimeSeconds
} from '../../shared/time.js'
import {
  createUser,
  getUserByEmail,
  markUserEmailVerified
} from '../users/repo.js'
import { mintSessionTokens, type TokenPair } from '../session/service.js'
import {
  consumeEmailOtp,
  getEmailOtp,
  invalidateEmailOtp,
  upsertEmailOtp
} from './repo.js'

export class SmtpNotConfiguredError extends Error {
  constructor() {
    super('smtp_not_configured')
  }
}

export class SmtpDeliveryError extends Error {
  constructor() {
    super('smtp_temporarily_unavailable')
  }
}

export class InvalidEmailOtpError extends Error {
  constructor() {
    super('invalid_email_otp')
  }
}

export async function startEmailAuth(
  db: DatabaseClient,
  input: { email: string }
): Promise<{ ok: true }> {
  const email = normalizeEmail(input.email)
  const smtpConfig = selectSmtpConfig(listSmtpConfigs(db))

  if (!smtpConfig) {
    throw new SmtpNotConfiguredError()
  }

  const code = generateOtpCode()

  upsertEmailOtp(db, {
    email,
    codeHash: hashValue(code),
    expiresAt: new Date(
      getExpiresAtUnixSeconds(getUnixTimeSeconds(), TTLS.otpSeconds) * 1000
    ).toISOString()
  })

  try {
    await sendOtpMail(smtpConfig, email, code)
  } catch {
    invalidateEmailOtp(db, email, new Date().toISOString())
    throw new SmtpDeliveryError()
  }

  return { ok: true }
}

export async function verifyEmailAuth(
  db: DatabaseClient,
  input: { email: string; code: string; issuer: string }
): Promise<TokenPair> {
  const email = normalizeEmail(input.email)
  const otp = getEmailOtp(db, email)
  const now = new Date().toISOString()

  if (
    !otp ||
    otp.consumedAt ||
    otp.expiresAt <= now ||
    otp.codeHash !== hashValue(input.code)
  ) {
    throw new InvalidEmailOtpError()
  }

  if (!consumeEmailOtp(db, email, now)) {
    throw new InvalidEmailOtpError()
  }

  let user = getUserByEmail(db, email)

  if (!user) {
    user = createUser(db, email, now)
  } else if (!user.emailVerifiedAt) {
    markUserEmailVerified(db, user.id, now)
  }

  const tokens = await mintSessionTokens(db, {
    userId: user.id,
    issuer: input.issuer
  })

  return {
    access_token: tokens.access_token,
    token_type: tokens.token_type,
    expires_in: tokens.expires_in,
    refresh_token: tokens.refresh_token
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0')
}
