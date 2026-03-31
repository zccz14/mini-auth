import { describe, expect, it } from 'vitest'
import { bootstrapDatabase } from '../../src/infra/db/bootstrap.js'
import { createDatabaseClient } from '../../src/infra/db/client.js'
import {
  bootstrapKeys,
  listPublicKeys,
  rotateKeys,
  signJwt,
  verifyJwt
} from '../../src/modules/jwks/service.js'
import { createTempDbPath } from '../helpers/db.js'

describe('jwks service', () => {
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
})
