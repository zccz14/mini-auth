import { Args, Flags } from '@oclif/core';
import { runCreateCommand } from '../app/commands/create.js';
import { BaseCommand } from '../oclif/base-command.js';

export default class CreateCommand extends BaseCommand {
  static summary = 'Create a new auth-mini database';

  static args = {
    dbPath: Args.string({
      required: true,
      description: 'SQLite database path',
    }),
  };

  static flags = {
    'smtp-config': Flags.string({
      description: 'SMTP config JSON file',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(CreateCommand);

    await runCreateCommand({
      dbPath: args.dbPath,
      smtpConfig: flags['smtp-config'],
    });
  }
}
