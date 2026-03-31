import { randomUUID } from 'node:crypto'
import type { DatabaseClient } from '../../infra/db/client.js'

type ChallengeRow = {
  request_id: string
  type: 'register' | 'authenticate'
  challenge: string
  user_id: string | null
  expires_at: string
  consumed_at: string | null
  created_at: string
}

type CredentialRow = {
  id: string
  user_id: string
  credential_id: string
  public_key: string
  counter: number
  transports: string
  created_at: string
}

export type WebauthnChallenge = {
  requestId: string
  type: 'register' | 'authenticate'
  challenge: string
  userId: string | null
  expiresAt: string
  consumedAt: string | null
  createdAt: string
}

export type StoredWebauthnCredential = {
  id: string
  userId: string
  credentialId: string
  publicKey: string
  counter: number
  transports: string[]
  createdAt: string
}

export function createChallenge(
  db: DatabaseClient,
  input: {
    type: 'register' | 'authenticate'
    challenge: string
    userId: string | null
    expiresAt: string
  }
): WebauthnChallenge {
  const requestId = randomUUID()

  db.prepare(
    [
      'INSERT INTO webauthn_challenges',
      '(request_id, type, challenge, user_id, expires_at)',
      'VALUES (?, ?, ?, ?, ?)'
    ].join(' ')
  ).run(requestId, input.type, input.challenge, input.userId, input.expiresAt)

  return getChallengeByRequestId(db, requestId) as WebauthnChallenge
}

export function consumeUnusedRegistrationChallengesForUser(
  db: DatabaseClient,
  userId: string,
  now: string
): number {
  const result = db
    .prepare(
      [
        'UPDATE webauthn_challenges',
        'SET consumed_at = ?',
        "WHERE type = 'register' AND user_id = ? AND consumed_at IS NULL"
      ].join(' ')
    )
    .run(now, userId)

  return result.changes
}

export function getChallengeByRequestId(
  db: DatabaseClient,
  requestId: string
): WebauthnChallenge | null {
  const row = db
    .prepare(
      [
        'SELECT request_id, type, challenge, user_id, expires_at, consumed_at, created_at',
        'FROM webauthn_challenges',
        'WHERE request_id = ?',
        'LIMIT 1'
      ].join(' ')
    )
    .get(requestId) as ChallengeRow | undefined

  return row ? mapChallenge(row) : null
}

export function consumeChallenge(
  db: DatabaseClient,
  requestId: string,
  now: string
): boolean {
  const result = db
    .prepare(
      'UPDATE webauthn_challenges SET consumed_at = ? WHERE request_id = ? AND consumed_at IS NULL'
    )
    .run(now, requestId)

  return result.changes > 0
}

export function createCredential(
  db: DatabaseClient,
  input: {
    userId: string
    credentialId: string
    publicKey: string
    counter: number
    transports: string[]
  }
): StoredWebauthnCredential {
  const id = randomUUID()

  db.prepare(
    [
      'INSERT INTO webauthn_credentials',
      '(id, user_id, credential_id, public_key, counter, transports)',
      'VALUES (?, ?, ?, ?, ?, ?)'
    ].join(' ')
  ).run(
    id,
    input.userId,
    input.credentialId,
    input.publicKey,
    input.counter,
    input.transports.join(',')
  )

  return getCredentialById(db, id) as StoredWebauthnCredential
}

export function getCredentialByCredentialId(
  db: DatabaseClient,
  credentialId: string
): StoredWebauthnCredential | null {
  const row = db
    .prepare(
      [
        'SELECT id, user_id, credential_id, public_key, counter, transports, created_at',
        'FROM webauthn_credentials',
        'WHERE credential_id = ?',
        'LIMIT 1'
      ].join(' ')
    )
    .get(credentialId) as CredentialRow | undefined

  return row ? mapCredential(row) : null
}

export function getCredentialById(
  db: DatabaseClient,
  id: string
): StoredWebauthnCredential | null {
  const row = db
    .prepare(
      [
        'SELECT id, user_id, credential_id, public_key, counter, transports, created_at',
        'FROM webauthn_credentials',
        'WHERE id = ?',
        'LIMIT 1'
      ].join(' ')
    )
    .get(id) as CredentialRow | undefined

  return row ? mapCredential(row) : null
}

export function updateCredentialCounter(
  db: DatabaseClient,
  id: string,
  counter: number
): void {
  db.prepare('UPDATE webauthn_credentials SET counter = ? WHERE id = ?').run(
    counter,
    id
  )
}

export function consumeChallengeAndUpdateCredentialCounter(
  db: DatabaseClient,
  input: {
    requestId: string
    credentialId: string
    expectedCounter: number
    nextCounter: number
    now: string
  }
): boolean {
  const consume = db.prepare(
    'UPDATE webauthn_challenges SET consumed_at = ? WHERE request_id = ? AND consumed_at IS NULL'
  )
  const update = db.prepare(
    'UPDATE webauthn_credentials SET counter = ? WHERE id = ? AND counter = ?'
  )
  const transaction = db.transaction(
    (
      requestId: string,
      credentialId: string,
      expectedCounter: number,
      nextCounter: number,
      now: string
    ): boolean => {
      const consumeResult = consume.run(now, requestId)

      if (consumeResult.changes === 0) {
        return false
      }

      const updateResult = update.run(
        nextCounter,
        credentialId,
        expectedCounter
      )

      return updateResult.changes > 0
    }
  )

  return transaction(
    input.requestId,
    input.credentialId,
    input.expectedCounter,
    input.nextCounter,
    input.now
  )
}

export function deleteCredentialById(
  db: DatabaseClient,
  id: string,
  userId: string
): boolean {
  const result = db
    .prepare('DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?')
    .run(id, userId)

  return result.changes > 0
}

function mapChallenge(row: ChallengeRow): WebauthnChallenge {
  return {
    requestId: row.request_id,
    type: row.type,
    challenge: row.challenge,
    userId: row.user_id,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    createdAt: row.created_at
  }
}

function mapCredential(row: CredentialRow): StoredWebauthnCredential {
  return {
    id: row.id,
    userId: row.user_id,
    credentialId: row.credential_id,
    publicKey: row.public_key,
    counter: row.counter,
    transports: row.transports ? row.transports.split(',').filter(Boolean) : [],
    createdAt: row.created_at
  }
}
