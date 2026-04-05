import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../../src/infra/db/client.js';
import { ensureCliIsBuilt, runBuiltCli, runPackedCli } from '../helpers/cli.js';
import { countRows, createTempDbPath } from '../helpers/db.js';

describe('oclif cli contract', () => {
  it('supports rotate jwks as the primary command', async () => {
    const dbPath = await createTempDbPath();

    const createResult = await runBuiltCli(['create', dbPath]);

    expect(createResult.exitCode).toBe(0);
    expect(await countRows(dbPath, 'jwks_keys')).toBe(1);
    expect(await countActiveKeys(dbPath)).toBe(1);

    const result = await runBuiltCli(['rotate', 'jwks', dbPath]);

    expect(result.exitCode).toBe(0);
    expect(await countRows(dbPath, 'jwks_keys')).toBe(2);
    expect(await countActiveKeys(dbPath)).toBe(1);
  }, 15000);

  it('keeps rotate-jwks as a compatibility alias', async () => {
    const dbPath = await createTempDbPath();

    const createResult = await runBuiltCli(['create', dbPath]);

    expect(createResult.exitCode).toBe(0);
    expect(await countRows(dbPath, 'jwks_keys')).toBe(1);
    expect(await countActiveKeys(dbPath)).toBe(1);

    const result = await runBuiltCli(['rotate-jwks', dbPath]);

    expect(result.exitCode).toBe(0);
    expect(await countRows(dbPath, 'jwks_keys')).toBe(2);
    expect(await countActiveKeys(dbPath)).toBe(1);
  });

  it('prints unknown command errors to stderr', async () => {
    const result = await runBuiltCli(['wat']);

    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('command');
    expect(result.exitCode).toBeGreaterThan(0);
  });

  it('fails with usage when required args are missing', async () => {
    const result = await runBuiltCli(['create']);

    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('USAGE');
    expect(result.stderr).toContain('arg');
    expect(result.exitCode).toBeGreaterThan(0);
  });

  it('runs help from a packed install artifact', async () => {
    const result = await runPackedCli(['--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('auth-mini');
  }, 30000);

  it('runs start help from a packed install artifact', async () => {
    const result = await runPackedCli(['start', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('USAGE');
  }, 30000);

  it('discovers nested rotate jwks command from the packed artifact', async () => {
    const result = await runPackedCli(['rotate', 'jwks', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('USAGE');
  }, 30000);

  it('routes rotate-jwks alias from the packed artifact', async () => {
    const result = await runPackedCli(['rotate-jwks', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('USAGE');
  }, 30000);

  it('prints version from the packed artifact metadata', async () => {
    const { default: pkg } = await import('../../package.json');
    const result = await runPackedCli(['--version']);

    expect(result.stdout.trim()).toBe(pkg.version);
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
  }, 30000);

  it('prints help to stdout only', async () => {
    const result = await runBuiltCli(['start', '--help']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('USAGE');
  });

  it('prints concise command errors by default', async () => {
    const result = await runBuiltCli([
      'create',
      '/tmp/db.sqlite',
      '--smtp-config',
      './missing.json',
    ]);

    expect(result.exitCode).toBeGreaterThan(0);
    expect(result.stderr).toContain('Error:');
    expect(result.stderr).toContain('Hint:');
    expect(result.stderr).toContain('See:');
    expect(result.stderr).not.toContain('Stack:');
  });

  it('prints detailed diagnostics with --verbose', async () => {
    const result = await runBuiltCli([
      'create',
      '/tmp/db.sqlite',
      '--smtp-config',
      './missing.json',
      '--verbose',
    ]);

    expect(result.exitCode).toBeGreaterThan(0);
    expect(result.stderr).toContain('Error:');
    expect(result.stderr).toContain('Hint:');
    expect(result.stderr).toContain('See:');
    expect(result.stderr).toContain('Stack:');
  });

  it('keeps start alive until shutdown signal arrives', async () => {
    await ensureCliIsBuilt();
    const dbPath = await createTempDbPath();
    const port = await reservePort();
    const cliEntrypoint = resolve(process.cwd(), 'dist/index.js');
    const createResult = await runBuiltCli(['create', dbPath]);

    expect(createResult.exitCode).toBe(0);

    const child = spawn(
      process.execPath,
      [
        cliEntrypoint,
        'start',
        dbPath,
        '--host',
        '127.0.0.1',
        '--port',
        String(port),
        '--issuer',
        'https://issuer.example',
        '--rp-id',
        'app.example',
        '--origin',
        'https://app.example',
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    await waitFor(() => stdout.includes('server.listening'));
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));

    expect(child.exitCode).toBeNull();

    child.kill('SIGTERM');

    const [code] = (await once(child, 'close')) as [number | null];

    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('server.shutdown.completed');
  }, 15000);
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

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();

  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for CLI output');
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
}

async function reservePort(): Promise<number> {
  const server = createServer();

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();

  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    throw new Error('Failed to reserve test port');
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  return address.port;
}
