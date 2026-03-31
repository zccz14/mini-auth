import type { DatabaseClient } from '../../infra/db/client.js'
import { signJwt } from '../jwks/service.js'
import {
  TTLS,
  getExpiresAtUnixSeconds,
  getUnixTimeSeconds
} from '../../shared/time.js'
import { generateOpaqueToken, hashValue } from '../../shared/crypto.js'
import {
  createSession,
  revokeSessionById,
  revokeSessionByRefreshTokenHash,
  type Session
} from './repo.js'

export type TokenPair = {
  access_token: string
  token_type: 'Bearer'
  expires_in: number
  refresh_token: string
}

export class InvalidRefreshTokenError extends Error {
  constructor() {
    super('invalid_refresh_token')
  }
}

export async function mintSessionTokens(
  db: DatabaseClient,
  input: { userId: string; issuer: string }
): Promise<TokenPair & { session: Session }> {
  const refreshToken = generateOpaqueToken()
  const issuedAt = getUnixTimeSeconds()
  const expiresAt = new Date(
    getExpiresAtUnixSeconds(issuedAt, TTLS.refreshTokenSeconds) * 1000
  ).toISOString()
  const session = createSession(db, {
    userId: input.userId,
    refreshTokenHash: hashValue(refreshToken),
    expiresAt
  })
  const accessToken = await signJwt(db, {
    sub: input.userId,
    sid: session.id,
    iss: input.issuer,
    typ: 'access'
  })

  return {
    session,
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: TTLS.accessTokenSeconds,
    refresh_token: refreshToken
  }
}

export async function refreshSessionTokens(
  db: DatabaseClient,
  input: { refreshToken: string; issuer: string }
): Promise<TokenPair & { session: Session }> {
  const now = new Date().toISOString()
  const session = revokeSessionByRefreshTokenHash(
    db,
    hashValue(input.refreshToken),
    now
  )

  if (!session) {
    throw new InvalidRefreshTokenError()
  }

  return mintSessionTokens(db, {
    userId: session.userId,
    issuer: input.issuer
  })
}

export function logoutSession(db: DatabaseClient, sessionId: string): void {
  revokeSessionById(db, sessionId, new Date().toISOString())
}
