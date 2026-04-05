#!/usr/bin/env node

import { handle, run } from '@oclif/core';
import { fileURLToPath } from 'node:url';

export async function runCli(argv = process.argv.slice(2)): Promise<unknown> {
  const normalizedArgv = normalizeArgv(argv);

  if (isVersionRequest(normalizedArgv)) {
    const { default: pkg } = await import('../package.json', {
      with: { type: 'json' },
    });
    console.log(pkg.version);
    return pkg.version;
  }

  try {
    return await run(
      normalizedArgv,
      fileURLToPath(new URL('..', import.meta.url)),
    );
  } catch (error) {
    await handle(error as Error);
  }
}

function normalizeArgv(argv: string[]): string[] {
  if (argv.length >= 2 && argv[0]?.includes('node')) {
    return argv.slice(2);
  }

  return argv;
}

function isVersionRequest(argv: string[]): boolean {
  return argv.length === 1 && (argv[0] === '--version' || argv[0] === '-v');
}

await runCli();
