import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runCreateCommand } from '../../src/app/commands/create.js';
import { runRotateJwksCommand } from '../../src/app/commands/rotate-jwks.js';
import { createMemoryLogCollector, type LogEntry } from './logging.js';

let buildPromise: Promise<void> | null = null;

const npmCommand = resolveShellCommand('npm');
const npxCommand = resolveShellCommand('npx');

export async function ensureCliIsBuilt(): Promise<void> {
  if (!buildPromise) {
    buildPromise = rm(resolve(process.cwd(), 'dist'), {
      force: true,
      recursive: true,
    })
      .then(() => runCommand(npmCommand, ['run', 'build']))
      .then((result) => {
        if (result.exitCode !== 0) {
          throw new Error(result.stderr || result.stdout || 'CLI build failed');
        }
      });
  }

  await buildPromise;
}

export async function runSourceCli(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const cliEntrypoint = resolve(process.cwd(), 'src/index.ts');

  return runCommand(npxCommand, ['vite-node', cliEntrypoint, ...args]);
}

export async function runBuiltCli(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  await ensureCliIsBuilt();
  const cliEntrypoint = resolve(process.cwd(), 'dist/index.js');

  return runCommand(process.execPath, [cliEntrypoint, ...args]);
}

export async function runPackedCli(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const stageDir = await mkdtemp(join(tmpdir(), 'auth-mini-stage-'));
  const installDir = await mkdtemp(join(tmpdir(), 'auth-mini-pack-'));

  try {
    await preparePackedWorkspace(stageDir);

    const packResult = await runCommand(npmCommand, ['run', 'build'], {
      cwd: stageDir,
    }).then(async (result) => {
      if (result.exitCode !== 0) {
        throw new Error(result.stderr || result.stdout || 'CLI build failed');
      }

      return runCommand(npmCommand, ['pack', '--json'], { cwd: stageDir });
    });

    if (packResult.exitCode !== 0) {
      throw new Error(
        packResult.stderr || packResult.stdout || 'npm pack failed',
      );
    }

    const tarball = resolve(stageDir, getPackedFilename(packResult.stdout));

    try {
      const installResult = await runCommand(
        npmCommand,
        [
          'install',
          '--ignore-scripts',
          '--no-package-lock',
          '--prefix',
          installDir,
          tarball,
        ],
        { cwd: stageDir },
      );

      if (installResult.exitCode !== 0) {
        throw new Error(
          installResult.stderr || installResult.stdout || 'npm install failed',
        );
      }

      const binPath = resolve(
        installDir,
        'node_modules',
        '.bin',
        process.platform === 'win32' ? 'auth-mini.cmd' : 'auth-mini',
      );

      const result = await runCommand(binPath, args, {
        cwd: installDir,
        env: { NODE_ENV: 'production' },
      });

      if (result.exitCode !== 0) {
        throw new Error(
          result.stderr || result.stdout || 'packed CLI execution failed',
        );
      }

      return result;
    } finally {
      await unlink(tarball).catch(() => undefined);
    }
  } finally {
    await rm(stageDir, { force: true, recursive: true });
    await rm(installDir, { force: true, recursive: true });
  }
}

export async function runCli(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return runBuiltCli(args);
}

export async function runLoggedCli(args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  logs: LogEntry[];
}> {
  await ensureCliIsBuilt();

  const result = await runCli(args);

  return {
    ...result,
    logs: result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as LogEntry),
  };
}

export async function runLoggedCreateCommand(input: {
  dbPath: string;
  smtpConfig?: string;
}): Promise<{ logs: LogEntry[] }> {
  const logCollector = createMemoryLogCollector();

  await runCreateCommand({
    ...input,
    loggerSink: logCollector.sink,
  });

  return {
    logs: logCollector.entries,
  };
}

export async function runLoggedRotateJwksCommand(input: {
  dbPath: string;
}): Promise<{ logs: LogEntry[] }> {
  const logCollector = createMemoryLogCollector();

  await runRotateJwksCommand({
    ...input,
    loggerSink: logCollector.sink,
  });

  return {
    logs: logCollector.entries,
  };
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolveRun({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

function getPackedFilename(stdout: string): string {
  const jsonStart = stdout.indexOf('[');

  if (jsonStart === -1) {
    throw new Error(`npm pack did not return JSON output: ${stdout}`);
  }

  const parsed = JSON.parse(stdout.slice(jsonStart)) as Array<{
    filename?: string;
  }>;
  const filename = parsed[0]?.filename;

  if (!filename) {
    throw new Error(`npm pack did not return a tarball filename: ${stdout}`);
  }

  return filename;
}

async function preparePackedWorkspace(stageDir: string): Promise<void> {
  const repoRoot = process.cwd();
  const filesToCopy = [
    'LICENSE',
    'README.md',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'tsconfig.build.json',
  ];
  const directoriesToCopy = ['src'];

  for (const file of filesToCopy) {
    await cp(resolve(repoRoot, file), resolve(stageDir, file));
  }

  for (const directory of directoriesToCopy) {
    await cp(resolve(repoRoot, directory), resolve(stageDir, directory), {
      recursive: true,
    });
  }

  await symlink(
    resolve(repoRoot, 'node_modules'),
    resolve(stageDir, 'node_modules'),
  );
}

function resolveShellCommand(command: 'npm' | 'npx'): string {
  return process.platform === 'win32' ? `${command}.cmd` : command;
}
