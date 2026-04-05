import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { runCreateCommand } from '../../src/cli/create.js';
import { runRotateJwksCommand } from '../../src/cli/rotate-jwks.js';
import { createMemoryLogCollector, type LogEntry } from './logging.js';

let buildPromise: Promise<void> | null = null;

const npmCommand = resolveShellCommand('npm');
const npxCommand = resolveShellCommand('npx');

export async function ensureCliIsBuilt(): Promise<void> {
  if (!buildPromise) {
    buildPromise = runCommand(npmCommand, ['run', 'build']).then((result) => {
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
  const cliEntrypoint = resolve(process.cwd(), 'dist/index.js');

  return runCommand(process.execPath, [cliEntrypoint, ...args]);
}

export async function runCli(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return runSourceCli(args);
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
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
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

function resolveShellCommand(command: 'npm' | 'npx'): string {
  return process.platform === 'win32' ? `${command}.cmd` : command;
}
