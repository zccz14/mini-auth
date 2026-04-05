import { Command, Flags } from '@oclif/core';

export abstract class BaseCommand extends Command {
  static baseFlags = {
    help: Flags.help({ char: 'h' }),
  };

  static enableJsonFlag = false;
}
