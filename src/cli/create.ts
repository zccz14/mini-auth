import { bootstrapDatabase } from '../infra/db/bootstrap.js'
import { createDatabaseClient } from '../infra/db/client.js'
import { importSmtpConfigs } from '../infra/smtp/config-import.js'
import { bootstrapKeys } from '../modules/jwks/service.js'
import { parseCreateCommandInput } from '../shared/config.js'
import { createRootLogger } from '../shared/logger.js'

type CreateCommandInput = {
  loggerSink?: { write(line: string): void }
}

export async function runCreateCommand(input: unknown): Promise<void> {
  const command = parseCreateCommandInput(input)
  const logger = createRootLogger({ sink: toLoggerSink(input) }).child({
    command: 'create',
    db_path: command.dbPath
  })

  logger.info({ event: 'cli.create.started' }, 'Create command started')

  await bootstrapDatabase(command.dbPath, { logger })

  const db = createDatabaseClient(command.dbPath)

  try {
    await bootstrapKeys(db)

    if (command.smtpConfig) {
      await importSmtpConfigs(db, command.smtpConfig)
    }

    logger.info({ event: 'cli.create.completed' }, 'Create command completed')
  } finally {
    db.close()
  }
}

function toLoggerSink(
  input: unknown
): { write(line: string): void } | undefined {
  if (!input || typeof input !== 'object') {
    return undefined
  }

  return (input as CreateCommandInput).loggerSink
}
