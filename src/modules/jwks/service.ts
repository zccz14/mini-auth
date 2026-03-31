import type { DatabaseClient } from '../../infra/db/client.js'
import {
  generateEd25519KeyRecord,
  signJwt as signCompactJwt,
  toPublicJwk,
  verifyJwt as verifyCompactJwt,
  type JwtPayload,
  type PublicJwk
} from '../../shared/crypto.js'
import {
  TTLS,
  getExpiresAtUnixSeconds,
  getUnixTimeSeconds
} from '../../shared/time.js'
import { getActiveKey, getKeyByKid, insertActiveKey, listKeys } from './repo.js'

export async function bootstrapKeys(db: DatabaseClient): Promise<{
  id: string
  kid: string
}> {
  const activeKey = getActiveKey(db)

  if (activeKey) {
    return { id: activeKey.id, kid: activeKey.kid }
  }

  const keyRecord = generateEd25519KeyRecord()
  insertActiveKey(db, keyRecord)

  return { id: keyRecord.id, kid: keyRecord.kid }
}

export async function rotateKeys(db: DatabaseClient): Promise<{
  id: string
  kid: string
}> {
  const keyRecord = generateEd25519KeyRecord()
  insertActiveKey(db, keyRecord)

  return { id: keyRecord.id, kid: keyRecord.kid }
}

export async function listPublicKeys(db: DatabaseClient): Promise<PublicJwk[]> {
  return listKeys(db).map((key) => toPublicJwk(key.privateJwk))
}

export async function signJwt(
  db: DatabaseClient,
  payload: JwtPayload
): Promise<string> {
  const activeKey = getActiveKey(db)

  if (!activeKey) {
    throw new Error('No active JWKS signing key')
  }

  const iat = getUnixTimeSeconds()
  const claims = {
    ...payload,
    iat,
    exp: getExpiresAtUnixSeconds(iat, TTLS.accessTokenSeconds)
  }

  return signCompactJwt(claims, activeKey.privateJwk, activeKey.kid)
}

export async function verifyJwt(
  db: DatabaseClient,
  token: string
): Promise<JwtPayload> {
  const headerSegment = token.split('.')[0]

  if (!headerSegment) {
    throw new Error('Invalid JWT format')
  }

  const header = JSON.parse(
    Buffer.from(headerSegment, 'base64url').toString('utf8')
  ) as { kid?: string }

  if (!header.kid) {
    throw new Error('JWT missing kid')
  }

  const storedKey = getKeyByKid(db, header.kid)

  if (!storedKey) {
    throw new Error('Unknown JWT kid')
  }

  const { payload } = verifyCompactJwt(token, storedKey.publicJwk)

  if (typeof payload.exp === 'number' && payload.exp < getUnixTimeSeconds()) {
    throw new Error('JWT expired')
  }

  return payload
}
