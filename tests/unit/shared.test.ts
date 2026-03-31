import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildSecureSmtpOptions,
  selectSmtpConfig
} from '../../src/infra/smtp/mailer.js'
import { parseRuntimeConfig } from '../../src/shared/config.js'
import { TTLS, getExpiresAtUnixSeconds } from '../../src/shared/time.js'
import { createTempDbPath } from '../helpers/db.js'
import { exists } from '../helpers/fs.js'

describe('test helpers', () => {
  it('reports whether a path exists', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'mini-auth-fs-'))
    const filePath = join(tempDir, 'present.txt')

    await writeFile(filePath, 'ok', 'utf8')

    await expect(exists(filePath)).resolves.toBe(true)
    await expect(exists(join(tempDir, 'missing.txt'))).resolves.toBe(false)
  })

  it('creates a sqlite path inside a temp directory', async () => {
    const dbPath = await createTempDbPath()

    expect(dbPath.endsWith('.sqlite')).toBe(true)
    await expect(exists(dbPath)).resolves.toBe(false)
  })
})

describe('shared runtime defaults', () => {
  it('selects only active smtp configs and defaults weight to 1', () => {
    const config = selectSmtpConfig(
      [
        {
          id: 1,
          host: 'inactive.example.com',
          port: 587,
          username: 'inactive',
          password: 'secret',
          fromEmail: 'inactive@example.com',
          isActive: false
        },
        {
          id: 2,
          host: 'primary.example.com',
          port: 587,
          username: 'primary',
          password: 'secret',
          fromEmail: 'primary@example.com',
          isActive: true
        }
      ],
      () => 0
    )

    expect(config).toMatchObject({
      id: 2,
      weight: 1,
      fromName: '',
      secure: false,
      isActive: true
    })
  })

  it('keeps tls certificate verification enabled for secure smtp', () => {
    expect(
      buildSecureSmtpOptions({
        host: 'smtp.example.com',
        port: 465
      })
    ).toEqual({
      host: 'smtp.example.com',
      port: 465,
      servername: 'smtp.example.com'
    })
  })

  it('exposes agreed TTL defaults', () => {
    expect(TTLS.otpSeconds).toBe(600)
    expect(TTLS.webauthnChallengeSeconds).toBe(300)
    expect(TTLS.accessTokenSeconds).toBe(900)
    expect(TTLS.refreshTokenSeconds).toBe(604800)
  })

  it('parses runtime config with cli defaults and ordered origins', () => {
    expect(
      parseRuntimeConfig({
        dbPath: '/tmp/mini-auth.sqlite',
        issuer: 'https://issuer.example',
        rpId: 'example.com',
        origin: ['https://one.example', 'https://two.example']
      })
    ).toEqual({
      dbPath: '/tmp/mini-auth.sqlite',
      host: '127.0.0.1',
      port: 7777,
      issuer: 'https://issuer.example',
      rpId: 'example.com',
      origins: ['https://one.example', 'https://two.example']
    })
  })

  it('computes jwt expiry timestamps from ttl seconds', () => {
    expect(
      getExpiresAtUnixSeconds(1_700_000_000, TTLS.accessTokenSeconds)
    ).toBe(1_700_000_900)
  })
})
