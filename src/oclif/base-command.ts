import { Command, Flags } from '@oclif/core';

type CliErrorDetails = {
  hint?: string;
  see?: string;
};

type CommandLayerError = Error &
  CliErrorDetails & {
    cause?: unknown;
    exitCode?: number;
    oclif?: { exit?: number };
    showHelp?: boolean;
  };

export abstract class BaseCommand extends Command {
  static baseFlags = {
    help: Flags.help({ char: 'h' }),
    verbose: Flags.boolean({
      default: false,
      description: 'Show stack traces and nested error causes',
    }),
  };

  static enableJsonFlag = false;

  async catch(error: CommandLayerError): Promise<void> {
    if (error.showHelp) {
      await super.catch(error);
      return;
    }

    const exitCode = error.exitCode ?? error.oclif?.exit ?? 1;
    const details = [
      `Error: ${error.message}`,
      error.hint ? `Hint: ${error.hint}` : undefined,
      error.see ? `See: ${error.see}` : undefined,
    ];

    if (this.isVerbose()) {
      const cause = formatCause(error.cause);

      if (cause) {
        details.push(`Cause: ${cause}`);
      }

      if (error.stack) {
        details.push(`Stack:\n${error.stack}`);
      }
    }

    this.logToStderr(details.filter(Boolean).join('\n'));
    this.exit(exitCode);
  }

  private isVerbose(): boolean {
    return this.argv.includes('--verbose');
  }
}

export function withCliErrorMetadata(
  error: unknown,
  details: CliErrorDetails,
): CommandLayerError {
  const commandError =
    error instanceof Error
      ? (error as CommandLayerError)
      : (new Error(String(error)) as CommandLayerError);

  if (details.hint !== undefined) {
    commandError.hint = details.hint;
  }

  if (details.see !== undefined) {
    commandError.see = details.see;
  }

  return commandError;
}

function formatCause(cause: unknown): string | undefined {
  if (cause instanceof Error) {
    return cause.message;
  }

  if (typeof cause === 'string') {
    return cause;
  }

  return undefined;
}
