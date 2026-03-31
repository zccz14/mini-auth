import { spawn } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDatabaseClient } from '../../src/infra/db/client.js'
import { runCli } from '../helpers/cli.js'
import { countRows, createTempDbPath } from '../helpers/db.js'
import { exists } from '../helpers/fs.js'

let buildPromise: Promise<void> | null = null

async function ensureCliIsBuilt(): Promise<void> {
  if (!buildPromise) {
    buildPromise = runCommand('npm', ['run', 'build']).then((result) => {
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || result.stdout || 'CLI build failed')
      }
    })
  }

  await buildPromise
}

async function runCommand(command: string, args: string[]) {
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(command, args, {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe']
      })

      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.on('error', reject)
      child.on('close', (code) => {
        resolve({
          exitCode: code ?? 1,
          stdout,
          stderr
        })
      })
    }
  )
}

describe('workspace bootstrap', () => {
  it('exposes the mini-auth bin entry', async () => {
    const { default: pkg } = await import('../../package.json')

    expect(pkg.bin['mini-auth']).toBe('dist/index.js')
  })

  it('defines build, test, lint, format, and typecheck scripts', async () => {
    const { default: pkg } = await import('../../package.json')

    expect(pkg.scripts.build).toBeDefined()
    expect(pkg.scripts.test).toBeDefined()
    expect(pkg.scripts['test:integration']).toBeDefined()
    expect(pkg.scripts.lint).toBeDefined()
    expect(pkg.scripts.format).toBeDefined()
    expect(pkg.scripts.typecheck).toBeDefined()
  })

  it('defines lint, format, and integration scripts', async () => {
    const { default: pkg } = await import('../../package.json')

    expect(pkg.scripts.lint).toBeDefined()
    expect(pkg.scripts.format).toBeDefined()
    expect(pkg.scripts['test:integration']).toBeDefined()
  })

  it('defines expected lint-staged rules and pre-commit hook command', async () => {
    const lintStaged = await import('../../.lintstagedrc.json')
    const { readFile } = await import('node:fs/promises')

    const hook = await readFile('.husky/pre-commit', 'utf8')

    expect(await exists('.prettierrc.json')).toBe(true)
    expect(await exists('eslint.config.js')).toBe(true)
    expect(await exists('.lintstagedrc.json')).toBe(true)
    expect(await exists('.husky/pre-commit')).toBe(true)
    expect(lintStaged.default).toEqual({
      '*.{js,json,md}': 'prettier --write',
      '*.ts': ['prettier --write', 'eslint --fix']
    })
    expect(hook).toContain('npx lint-staged')
  })

  it('runs the built cli help smoke path', async () => {
    await ensureCliIsBuilt()

    expect(await exists('dist/index.js')).toBe(true)

    const result = await runCli(['--help'])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('mini-auth')
    expect(result.stdout).toContain('--help')
  })

  it('create initializes schema and seeds an active jwks key', async () => {
    await ensureCliIsBuilt()
    const dbPath = await createTempDbPath()

    const result = await runCli(['create', dbPath])

    expect(result.exitCode).toBe(0)
    expect(await countRows(dbPath, 'jwks_keys')).toBe(1)

    const db = createDatabaseClient(dbPath)

    try {
      const activeRow = db
        .prepare(
          'SELECT kid, alg, is_active FROM jwks_keys WHERE is_active = 1'
        )
        .get() as { kid: string; alg: string; is_active: number } | undefined

      expect(activeRow).toMatchObject({ alg: 'EdDSA', is_active: 1 })
      expect(activeRow?.kid).toBeTruthy()
    } finally {
      db.close()
    }
  })

  it('create imports valid smtp json', async () => {
    await ensureCliIsBuilt()
    const dbPath = await createTempDbPath()
    const tempDir = await mkdtemp(join(tmpdir(), 'mini-auth-smtp-'))
    const smtpJsonPath = join(tempDir, 'smtp.json')

    await writeFile(
      smtpJsonPath,
      JSON.stringify([
        {
          host: 'smtp.example.com',
          port: 587,
          username: 'mailer',
          password: 'secret',
          from_email: 'noreply@example.com'
        }
      ]),
      'utf8'
    )

    const result = await runCli([
      'create',
      dbPath,
      '--smtp-config',
      smtpJsonPath
    ])

    expect(result.exitCode).toBe(0)
    expect(await countRows(dbPath, 'smtp_configs')).toBe(1)

    const db = createDatabaseClient(dbPath)

    try {
      const smtpRow = db
        .prepare(
          [
            'SELECT host, port, username, from_email, from_name, secure, weight',
            'FROM smtp_configs'
          ].join(' ')
        )
        .get() as {
        host: string
        port: number
        username: string
        from_email: string
        from_name: string
        secure: number
        weight: number
      }

      expect(smtpRow).toEqual({
        host: 'smtp.example.com',
        port: 587,
        username: 'mailer',
        from_email: 'noreply@example.com',
        from_name: '',
        secure: 0,
        weight: 1
      })
    } finally {
      db.close()
    }
  })

  it('create rejects invalid smtp json and imports nothing', async () => {
    await ensureCliIsBuilt()
    const dbPath = await createTempDbPath()
    const tempDir = await mkdtemp(join(tmpdir(), 'mini-auth-smtp-'))
    const smtpJsonPath = join(tempDir, 'smtp.json')

    await writeFile(smtpJsonPath, '{"host":"broken"}', 'utf8')

    const result = await runCli([
      'create',
      dbPath,
      '--smtp-config',
      smtpJsonPath
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Invalid SMTP config')
    expect(await countRows(dbPath, 'smtp_configs')).toBe(0)
  })

  it('create rejects smtp rows missing host, port, username, password, or from_email', async () => {
    await ensureCliIsBuilt()
    const dbPath = await createTempDbPath()
    const tempDir = await mkdtemp(join(tmpdir(), 'mini-auth-smtp-'))
    const smtpJsonPath = join(tempDir, 'smtp.json')

    await writeFile(
      smtpJsonPath,
      JSON.stringify([
        {
          host: 'smtp.example.com',
          port: 587,
          username: 'mailer',
          password: 'secret',
          from_email: 'noreply@example.com'
        },
        {
          host: 'smtp-backup.example.com',
          port: 2525,
          username: 'backup',
          password: 'secret'
        }
      ]),
      'utf8'
    )

    const result = await runCli([
      'create',
      dbPath,
      '--smtp-config',
      smtpJsonPath
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Invalid SMTP config')
    expect(await countRows(dbPath, 'smtp_configs')).toBe(0)
  })

  it('rotate-jwks generates a new active key and keeps older keys', async () => {
    await ensureCliIsBuilt()
    const dbPath = await createTempDbPath()

    const createResult = await runCli(['create', dbPath])
    const rotateResult = await runCli(['rotate-jwks', dbPath])

    expect(createResult.exitCode).toBe(0)
    expect(rotateResult.exitCode).toBe(0)
    expect(await countRows(dbPath, 'jwks_keys')).toBe(2)

    const db = createDatabaseClient(dbPath)

    try {
      const activeCount = db
        .prepare('SELECT COUNT(*) AS count FROM jwks_keys WHERE is_active = 1')
        .get() as { count: number }

      expect(activeCount.count).toBe(1)
    } finally {
      db.close()
    }
  })

  it('creates all v1 tables', async () => {
    const { bootstrapDatabase } =
      await import('../../src/infra/db/bootstrap.js')
    const { countRows, createTempDbPath, listTables } =
      await import('../helpers/db.js')
    const tempDbPath = await createTempDbPath()

    await bootstrapDatabase(tempDbPath)

    expect(await listTables(tempDbPath)).toEqual([
      'email_otps',
      'jwks_keys',
      'sessions',
      'smtp_configs',
      'users',
      'webauthn_challenges',
      'webauthn_credentials'
    ])
    expect(await countRows(tempDbPath, 'users')).toBe(0)
  })

  it('enforces a globally unique webauthn credential id', async () => {
    const { bootstrapDatabase } =
      await import('../../src/infra/db/bootstrap.js')
    const { createDatabaseClient } =
      await import('../../src/infra/db/client.js')
    const { createTempDbPath } = await import('../helpers/db.js')
    const tempDbPath = await createTempDbPath()

    await bootstrapDatabase(tempDbPath)

    const db = createDatabaseClient(tempDbPath)

    try {
      db.prepare(
        'INSERT INTO users (id, email, email_verified_at) VALUES (?, ?, ?)'
      ).run('user-1', 'first@example.com', '2026-03-31T00:00:00.000Z')
      db.prepare(
        'INSERT INTO users (id, email, email_verified_at) VALUES (?, ?, ?)'
      ).run('user-2', 'second@example.com', '2026-03-31T00:00:00.000Z')

      db.prepare(
        [
          'INSERT INTO webauthn_credentials',
          '(id, user_id, credential_id, public_key, counter, transports)',
          'VALUES (?, ?, ?, ?, ?, ?)'
        ].join(' ')
      ).run('cred-1', 'user-1', 'shared-credential', 'pk-1', 0, 'internal')

      expect(() => {
        db.prepare(
          [
            'INSERT INTO webauthn_credentials',
            '(id, user_id, credential_id, public_key, counter, transports)',
            'VALUES (?, ?, ?, ?, ?, ?)'
          ].join(' ')
        ).run('cred-2', 'user-2', 'shared-credential', 'pk-2', 0, 'usb')
      }).toThrowError(
        /UNIQUE constraint failed: webauthn_credentials.credential_id/
      )
    } finally {
      db.close()
    }
  })

  it('requires a user for register challenges but not authenticate challenges', async () => {
    const { bootstrapDatabase } =
      await import('../../src/infra/db/bootstrap.js')
    const { createDatabaseClient } =
      await import('../../src/infra/db/client.js')
    const { createTempDbPath } = await import('../helpers/db.js')
    const tempDbPath = await createTempDbPath()

    await bootstrapDatabase(tempDbPath)

    const db = createDatabaseClient(tempDbPath)

    try {
      db.prepare(
        'INSERT INTO users (id, email, email_verified_at) VALUES (?, ?, ?)'
      ).run('user-1', 'user@example.com', '2026-03-31T00:00:00.000Z')

      expect(() => {
        db.prepare(
          [
            'INSERT INTO webauthn_challenges',
            '(request_id, type, challenge, user_id, expires_at)',
            'VALUES (?, ?, ?, ?, ?)'
          ].join(' ')
        ).run(
          'register-missing-user',
          'register',
          'challenge',
          null,
          '2030-01-01T00:00:00.000Z'
        )
      }).toThrowError(/CHECK constraint failed/)

      expect(() => {
        db.prepare(
          [
            'INSERT INTO webauthn_challenges',
            '(request_id, type, challenge, user_id, expires_at)',
            'VALUES (?, ?, ?, ?, ?)'
          ].join(' ')
        ).run(
          'authenticate-without-user',
          'authenticate',
          'challenge',
          null,
          '2030-01-01T00:00:00.000Z'
        )
      }).not.toThrow()

      expect(() => {
        db.prepare(
          [
            'INSERT INTO webauthn_challenges',
            '(request_id, type, challenge, user_id, expires_at)',
            'VALUES (?, ?, ?, ?, ?)'
          ].join(' ')
        ).run(
          'authenticate-with-user',
          'authenticate',
          'challenge',
          'user-1',
          '2030-01-01T00:00:00.000Z'
        )
      }).toThrowError(/CHECK constraint failed/)
    } finally {
      db.close()
    }
  })

  it('allows at most one active jwks key', async () => {
    const { bootstrapDatabase } =
      await import('../../src/infra/db/bootstrap.js')
    const { createDatabaseClient } =
      await import('../../src/infra/db/client.js')
    const { createTempDbPath } = await import('../helpers/db.js')
    const tempDbPath = await createTempDbPath()

    await bootstrapDatabase(tempDbPath)

    const db = createDatabaseClient(tempDbPath)

    try {
      db.prepare(
        [
          'INSERT INTO jwks_keys',
          '(id, kid, alg, public_jwk, private_jwk, is_active)',
          'VALUES (?, ?, ?, ?, ?, ?)'
        ].join(' ')
      ).run('key-1', 'kid-1', 'EdDSA', '{}', '{}', 1)

      expect(() => {
        db.prepare(
          [
            'INSERT INTO jwks_keys',
            '(id, kid, alg, public_jwk, private_jwk, is_active)',
            'VALUES (?, ?, ?, ?, ?, ?)'
          ].join(' ')
        ).run('key-2', 'kid-2', 'EdDSA', '{}', '{}', 1)
      }).toThrowError(/UNIQUE constraint failed/)

      expect(() => {
        db.prepare(
          [
            'INSERT INTO jwks_keys',
            '(id, kid, alg, public_jwk, private_jwk, is_active)',
            'VALUES (?, ?, ?, ?, ?, ?)'
          ].join(' ')
        ).run('key-3', 'kid-3', 'EdDSA', '{}', '{}', 0)
      }).not.toThrow()
    } finally {
      db.close()
    }
  })
})
