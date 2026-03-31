import { randomUUID } from 'node:crypto'
import type { DatabaseClient } from '../../infra/db/client.js'

type SessionRow = {
  id: string
  user_id: string
  refresh_token_hash: string
  expires_at: string
  revoked_at: string | null
  created_at: string
}

export type Session = {
  id: string
  userId: string
  refreshTokenHash: string
  expiresAt: string
  revokedAt: string | null
  createdAt: string
}

export function createSession(
  db: DatabaseClient,
  input: { userId: string; refreshTokenHash: string; expiresAt: string }
): Session {
  const id = randomUUID()

  db.prepare(
    'INSERT INTO sessions (id, user_id, refresh_token_hash, expires_at) VALUES (?, ?, ?, ?)'
  ).run(id, input.userId, input.refreshTokenHash, input.expiresAt)

  return getSessionById(db, id) as Session
}

export function getSessionById(db: DatabaseClient, id: string): Session | null {
  const row = db
    .prepare(
      'SELECT id, user_id, refresh_token_hash, expires_at, revoked_at, created_at FROM sessions WHERE id = ? LIMIT 1'
    )
    .get(id) as SessionRow | undefined

  return row ? mapSession(row) : null
}

export function getSessionByRefreshTokenHash(
  db: DatabaseClient,
  refreshTokenHash: string
): Session | null {
  const row = db
    .prepare(
      [
        'SELECT id, user_id, refresh_token_hash, expires_at, revoked_at, created_at',
        'FROM sessions',
        'WHERE refresh_token_hash = ?',
        'LIMIT 1'
      ].join(' ')
    )
    .get(refreshTokenHash) as SessionRow | undefined

  return row ? mapSession(row) : null
}

export function revokeSessionById(
  db: DatabaseClient,
  id: string,
  now: string
): void {
  db.prepare(
    'UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?'
  ).run(now, id)
}

export function revokeSessionByRefreshTokenHash(
  db: DatabaseClient,
  refreshTokenHash: string,
  now: string
): Session | null {
  const select = db.prepare(
    [
      'SELECT id, user_id, refresh_token_hash, expires_at, revoked_at, created_at',
      'FROM sessions',
      'WHERE refresh_token_hash = ? AND revoked_at IS NULL AND expires_at > ?',
      'LIMIT 1'
    ].join(' ')
  )
  const update = db.prepare(
    [
      'UPDATE sessions',
      'SET revoked_at = ?',
      'WHERE id = ? AND revoked_at IS NULL AND expires_at > ?'
    ].join(' ')
  )
  const transaction = db.transaction(
    (tokenHash: string, timestamp: string): Session | null => {
      const row = select.get(tokenHash, timestamp) as SessionRow | undefined

      if (!row) {
        return null
      }

      const result = update.run(timestamp, row.id, timestamp)

      if (result.changes === 0) {
        return null
      }

      return mapSession({
        ...row,
        revoked_at: timestamp
      })
    }
  )

  return transaction(refreshTokenHash, now)
}

function mapSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.user_id,
    refreshTokenHash: row.refresh_token_hash,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at
  }
}
