import { Args, Flags } from '@oclif/core';
import { normalizeOriginOption } from '../app/commands/options.js';
import { runStartCommand } from '../app/commands/start.js';
import { BaseCommand } from './base.js';

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

    await runStartCommand({
      dbPath: args.dbPath,
      host: flags.host,
      port: flags.port,
      issuer: flags.issuer,
      rpId: flags['rp-id'],
      origin: normalizeOriginOption(flags.origin),
    });
  }
}
