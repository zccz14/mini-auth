import { createPrivateKey, sign } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootstrapDatabase } from '../../src/infra/db/bootstrap.js'
import { createDatabaseClient } from '../../src/infra/db/client.js'
import {
  bootstrapKeys,
  listPublicKeys,
  rotateKeys,
  signJwt,
  verifyJwt
} from '../../src/modules/jwks/service.js'
import { encodeBase64Url, type PrivateJwk } from '../../src/shared/crypto.js'
import { createTempDbPath } from '../helpers/db.js'

describe('jwks service', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('generates an Ed25519 signing key and emits a public jwks entry', async () => {
    const dbPath = await createTempDbPath()
    await bootstrapDatabase(dbPath)
    const db = createDatabaseClient(dbPath)

    try {
      const result = await bootstrapKeys(db)
      const publicKeys = await listPublicKeys(db)

      expect(result.kid).toBeDefined()
      expect(publicKeys).toHaveLength(1)
      expect(publicKeys[0]).toMatchObject({
        kid: result.kid,
        alg: 'EdDSA',
        kty: 'OKP',
        crv: 'Ed25519',
        use: 'sig'
      })
      expect(publicKeys[0]).not.toHaveProperty('d')
    } finally {
      db.close()
    }
  })

  it('keeps rotated keys available for verification', async () => {
    const dbPath = await createTempDbPath()
    await bootstrapDatabase(dbPath)
    const db = createDatabaseClient(dbPath)

    try {
      const firstKey = await bootstrapKeys(db)
      const token = await signJwt(db, {
        sub: 'user-1',
        typ: 'access',
        sid: 'session-1'
      })

      const rotatedKey = await rotateKeys(db)
      const payload = await verifyJwt(db, token)
      const publicKeys = await listPublicKeys(db)

      expect(rotatedKey.kid).not.toBe(firstKey.kid)
      expect(payload).toMatchObject({
        sub: 'user-1',
        sid: 'session-1',
        typ: 'access'
      })
      expect(publicKeys.map((key) => key.kid)).toEqual([
        firstKey.kid,
        rotatedKey.kid
      ])
    } finally {
      db.close()
    }
  })

  it('rejects tokens with missing or non-numeric exp claims', async () => {
    const dbPath = await createTempDbPath()
    await bootstrapDatabase(dbPath)
    const db = createDatabaseClient(dbPath)

    try {
      await bootstrapKeys(db)

      const missingExpToken = createSignedToken(
        db,
        {
          alg: 'EdDSA',
          kid: getActiveKid(db),
          typ: 'JWT'
        },
        {
          sub: 'user-1',
          typ: 'access'
        }
      )

      await expect(verifyJwt(db, missingExpToken)).rejects.toThrowError(
        'JWT exp must be a number'
      )

      const stringExpToken = createSignedToken(
        db,
        {
          alg: 'EdDSA',
          kid: getActiveKid(db),
          typ: 'JWT'
        },
        {
          sub: 'user-1',
          typ: 'access',
          exp: '900'
        }
      )

      await expect(verifyJwt(db, stringExpToken)).rejects.toThrowError(
        'JWT exp must be a number'
      )
    } finally {
      db.close()
    }
  })

  it('rejects tokens with invalid protected header fields', async () => {
    const dbPath = await createTempDbPath()
    await bootstrapDatabase(dbPath)
    const db = createDatabaseClient(dbPath)

    try {
      await bootstrapKeys(db)
      const kid = getActiveKid(db)
      const validPayload = {
        sub: 'user-1',
        typ: 'access',
        exp: 4_102_444_800
      }

      const wrongAlgToken = createSignedToken(
        db,
        { alg: 'HS256', kid, typ: 'JWT' },
        validPayload
      )

      await expect(verifyJwt(db, wrongAlgToken)).rejects.toThrowError(
        'JWT header alg must be EdDSA'
      )

      const wrongTypToken = createSignedToken(
        db,
        { alg: 'EdDSA', kid, typ: 'JOSE' },
        validPayload
      )

      await expect(verifyJwt(db, wrongTypToken)).rejects.toThrowError(
        'JWT header typ must be JWT'
      )

      const missingAlgToken = createSignedToken(
        db,
        { kid, typ: 'JWT' },
        validPayload
      )

      await expect(verifyJwt(db, missingAlgToken)).rejects.toThrowError(
        'JWT header alg must be EdDSA'
      )
    } finally {
      db.close()
    }
  })

  it('rejects tokens when exp equals the current time', async () => {
    const dbPath = await createTempDbPath()
    await bootstrapDatabase(dbPath)
    const db = createDatabaseClient(dbPath)

    try {
      await bootstrapKeys(db)
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'))

      const expNowToken = createSignedToken(
        db,
        {
          alg: 'EdDSA',
          kid: getActiveKid(db),
          typ: 'JWT'
        },
        {
          sub: 'user-1',
          typ: 'access',
          exp: 1_893_456_000
        }
      )

      await expect(verifyJwt(db, expNowToken)).rejects.toThrowError(
        'JWT expired'
      )
    } finally {
      db.close()
    }
  })
})

function getActiveKid(db: ReturnType<typeof createDatabaseClient>): string {
  const row = db
    .prepare('SELECT kid FROM jwks_keys WHERE is_active = 1 LIMIT 1')
    .get() as { kid: string }

  return row.kid
}

function getActivePrivateJwk(
  db: ReturnType<typeof createDatabaseClient>
): PrivateJwk {
  const row = db
    .prepare('SELECT private_jwk FROM jwks_keys WHERE is_active = 1 LIMIT 1')
    .get() as { private_jwk: string }

  return JSON.parse(row.private_jwk) as PrivateJwk
}

function createSignedToken(
  db: ReturnType<typeof createDatabaseClient>,
  header: Record<string, unknown>,
  payload: Record<string, unknown>
): string {
  const privateJwk = getActivePrivateJwk(db)
  const encodedHeader = encodeBase64Url(JSON.stringify(header))
  const encodedPayload = encodeBase64Url(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = sign(
    null,
    Buffer.from(signingInput, 'utf8'),
    createPrivateKey({ format: 'jwk', key: privateJwk })
  )

  return `${signingInput}.${encodeBase64Url(signature)}`
}
