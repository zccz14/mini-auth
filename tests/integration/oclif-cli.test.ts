import { describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../../src/infra/db/client.js';
import { runCli } from '../helpers/cli.js';
import { countRows, createTempDbPath } from '../helpers/db.js';

describe('oclif cli contract', () => {
  it('supports rotate jwks as the primary command', async () => {
    const dbPath = await createTempDbPath();

    const createResult = await runCli(['create', dbPath]);

    expect(createResult.exitCode).toBe(0);
    expect(await countRows(dbPath, 'jwks_keys')).toBe(1);
    expect(await countActiveKeys(dbPath)).toBe(1);

    const result = await runCli(['rotate', 'jwks', dbPath]);

    expect(result.exitCode).toBe(0);
    expect(await countRows(dbPath, 'jwks_keys')).toBe(2);
    expect(await countActiveKeys(dbPath)).toBe(1);
  }, 15000);

  it('keeps rotate-jwks as a compatibility alias', async () => {
    const dbPath = await createTempDbPath();

    const createResult = await runCli(['create', dbPath]);

    expect(createResult.exitCode).toBe(0);
    expect(await countRows(dbPath, 'jwks_keys')).toBe(1);
    expect(await countActiveKeys(dbPath)).toBe(1);

    const result = await runCli(['rotate-jwks', dbPath]);

    expect(result.exitCode).toBe(0);
    expect(await countRows(dbPath, 'jwks_keys')).toBe(2);
    expect(await countActiveKeys(dbPath)).toBe(1);
  });

  it('prints unknown command errors to stderr', async () => {
    const result = await runCli(['wat']);

    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('command');
    expect(result.exitCode).toBeGreaterThan(0);
  });

  it('fails with usage when required args are missing', async () => {
    const result = await runCli(['create']);

    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('USAGE');
    expect(result.stderr).toContain('arg');
    expect(result.exitCode).toBeGreaterThan(0);
  });

  it('prints version from package metadata', async () => {
    const { default: pkg } = await import('../../package.json');
    const result = await runCli(['--version']);

    expect(result.stdout.trim()).toBe(pkg.version);
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  });

  it('prints help to stdout only', async () => {
    const result = await runCli(['start', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('USAGE');
  });
});

async function countActiveKeys(dbPath: string): Promise<number> {
  const db = createDatabaseClient(dbPath);

  try {
    const row = db
      .prepare('SELECT COUNT(*) AS count FROM jwks_keys WHERE is_active = 1')
      .get() as { count: number };

    return row.count;
  } finally {
    db.close();
  }
}
