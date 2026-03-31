import type { DatabaseClient } from '../../infra/db/client.js'
import type { KeyRecord, PrivateJwk, PublicJwk } from '../../shared/crypto.js'

type JwksKeyRow = {
  id: string
  kid: string
  alg: 'EdDSA'
  public_jwk: string
  private_jwk: string
  is_active: number
}

export type StoredJwksKey = {
  id: string
  kid: string
  alg: 'EdDSA'
  publicJwk: PublicJwk
  privateJwk: PrivateJwk
  isActive: boolean
}

export function getActiveKey(db: DatabaseClient): StoredJwksKey | null {
  const row = db
    .prepare(
      [
        'SELECT id, kid, alg, public_jwk, private_jwk, is_active',
        'FROM jwks_keys',
        'WHERE is_active = 1',
        'LIMIT 1'
      ].join(' ')
    )
    .get() as JwksKeyRow | undefined

  return row ? mapRow(row) : null
}

export function getKeyByKid(
  db: DatabaseClient,
  kid: string
): StoredJwksKey | null {
  const row = db
    .prepare(
      [
        'SELECT id, kid, alg, public_jwk, private_jwk, is_active',
        'FROM jwks_keys',
        'WHERE kid = ?',
        'LIMIT 1'
      ].join(' ')
    )
    .get(kid) as JwksKeyRow | undefined

  return row ? mapRow(row) : null
}

export function listKeys(db: DatabaseClient): StoredJwksKey[] {
  const rows = db
    .prepare(
      [
        'SELECT id, kid, alg, public_jwk, private_jwk, is_active',
        'FROM jwks_keys',
        'ORDER BY rowid ASC'
      ].join(' ')
    )
    .all() as JwksKeyRow[]

  return rows.map(mapRow)
}

export function insertActiveKey(db: DatabaseClient, key: KeyRecord): void {
  const insert = db.prepare(
    [
      'INSERT INTO jwks_keys (id, kid, alg, public_jwk, private_jwk, is_active)',
      'VALUES (?, ?, ?, ?, ?, 1)'
    ].join(' ')
  )
  const deactivate = db.prepare(
    'UPDATE jwks_keys SET is_active = 0 WHERE is_active = 1'
  )
  const transaction = db.transaction(() => {
    deactivate.run()
    insert.run(
      key.id,
      key.kid,
      key.alg,
      JSON.stringify(key.publicJwk),
      JSON.stringify(key.privateJwk)
    )
  })

  transaction()
}

function mapRow(row: JwksKeyRow): StoredJwksKey {
  return {
    id: row.id,
    kid: row.kid,
    alg: row.alg,
    publicJwk: JSON.parse(row.public_jwk) as PublicJwk,
    privateJwk: JSON.parse(row.private_jwk) as PrivateJwk,
    isActive: row.is_active === 1
  }
}
