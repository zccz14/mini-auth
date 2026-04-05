import { Args, Flags } from '@oclif/core';
import { normalizeOriginOption } from '../app/commands/options.js';
import { runStartCommand } from '../app/commands/start.js';
import { BaseCommand } from '../oclif/base-command.js';

const START_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

export function createStartLifecycle(input: {
  close(): Promise<void>;
  on(signal: NodeJS.Signals, handler: () => void): void;
  off(signal: NodeJS.Signals, handler: () => void): void;
  onCloseError?(error: unknown): Promise<void> | void;
}): { waitForShutdown(): Promise<void> } {
  let shutdownPromise: Promise<void> | undefined;
  let resolveShutdown!: () => void;
  let rejectShutdown!: (error: unknown) => void;

  const completed = new Promise<void>((resolve, reject) => {
    resolveShutdown = resolve;
    rejectShutdown = reject;
  });
  void completed.catch(() => undefined);

  const removeListeners = () => {
    for (const signal of START_SIGNALS) {
      input.off(signal, shutdown);
    }
  };

  const shutdown = async (): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      removeListeners();

      try {
        await input.close();
        resolveShutdown();
      } catch (error) {
        await input.onCloseError?.(error);
        rejectShutdown(error);
      }
    })();

    return shutdownPromise;
  };

  for (const signal of START_SIGNALS) {
    input.on(signal, shutdown);
  }

  return {
    waitForShutdown() {
      return completed;
    },
  };
}

export default class StartCommand extends BaseCommand {
  static summary = 'Start the auth-mini server';

  static args = {
    dbPath: Args.string({
      required: true,
      description: 'SQLite database path',
    }),
  };

  static flags = {
    host: Flags.string({ description: 'Listen host' }),
    port: Flags.string({ description: 'Listen port' }),
    issuer: Flags.string({ description: 'JWT issuer URL' }),
    'rp-id': Flags.string({ description: 'WebAuthn relying party ID' }),
    origin: Flags.string({
      description: 'Allowed WebAuthn origin',
      multiple: true,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(StartCommand);
    const server = await runStartCommand({
      dbPath: args.dbPath,
      host: flags.host,
      port: flags.port,
      issuer: flags.issuer,
      rpId: flags['rp-id'],
      origin: normalizeOriginOption(flags.origin),
    });
    const lifecycle = createStartLifecycle({
      close: () => server.close(),
      on: (signal, handler) => process.on(signal, handler),
      off: (signal, handler) => process.off(signal, handler),
    });

    await lifecycle.waitForShutdown();
  }
}
