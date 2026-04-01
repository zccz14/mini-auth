import { describe, expect, it } from 'vitest'
import { createTempDbPath } from '../helpers/db.js'
import { runLoggedCli } from '../helpers/cli.js'

describe('cli lifecycle logging', () => {
  it('emits create command and migration lifecycle logs', async () => {
    const dbPath = await createTempDbPath()

    const result = await runLoggedCli(['create', dbPath])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')

    expect(result.logs).toContainEqual(
      expect.objectContaining({
        event: 'cli.create.started',
        command: 'create',
        db_path: dbPath
      })
    )
    expect(result.logs).toContainEqual(
      expect.objectContaining({
        event: 'db.migration.started',
        db_path: dbPath
      })
    )
    expect(result.logs).toContainEqual(
      expect.objectContaining({
        event: 'db.migration.completed',
        db_path: dbPath
      })
    )
    expect(result.logs).toContainEqual(
      expect.objectContaining({
        event: 'cli.create.completed',
        command: 'create',
        db_path: dbPath
      })
    )
  })

  it('emits rotate-jwks command and migration lifecycle logs', async () => {
    const dbPath = await createTempDbPath()

    expect((await runLoggedCli(['create', dbPath])).exitCode).toBe(0)

    const result = await runLoggedCli(['rotate-jwks', dbPath])

    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')

    expect(result.logs).toContainEqual(
      expect.objectContaining({
        event: 'cli.rotate_jwks.started',
        command: 'rotate-jwks',
        db_path: dbPath
      })
    )
    expect(result.logs).toContainEqual(
      expect.objectContaining({
        event: 'db.migration.started',
        db_path: dbPath
      })
    )
    expect(result.logs).toContainEqual(
      expect.objectContaining({
        event: 'db.migration.completed',
        db_path: dbPath
      })
    )
    expect(result.logs).toContainEqual(
      expect.objectContaining({
        event: 'cli.rotate_jwks.completed',
        command: 'rotate-jwks',
        db_path: dbPath
      })
    )
  })
})
