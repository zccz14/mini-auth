import { Args } from '@oclif/core';
import { runRotateJwksCommand } from '../../app/commands/rotate-jwks.js';
import { BaseCommand } from '../base.js';

export default class RotateJwksCommand extends BaseCommand {
  static summary = 'Rotate the active JWKS signing key';

  static aliases = ['rotate-jwks'];

  static args = {
    dbPath: Args.string({
      required: true,
      description: 'SQLite database path',
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(RotateJwksCommand);

    await runRotateJwksCommand({ dbPath: args.dbPath });
  }
}
