import { bootstrapDatabase } from '../infra/db/bootstrap.js'
import { createDatabaseClient } from '../infra/db/client.js'
import { rotateKeys } from '../modules/jwks/service.js'
import { parseRotateJwksCommandInput } from '../shared/config.js'
import { createRootLogger } from '../shared/logger.js'

type RotateJwksCommandInput = {
  loggerSink?: { write(line: string): void }
}

export async function runRotateJwksCommand(input: unknown): Promise<void> {
  const command = parseRotateJwksCommandInput(input)
  const logger = createRootLogger({ sink: toLoggerSink(input) }).child({
    command: 'rotate-jwks',
    db_path: command.dbPath
  })

  logger.info(
    { event: 'cli.rotate_jwks.started' },
    'Rotate JWKS command started'
  )

  await bootstrapDatabase(command.dbPath, { logger })

  const db = createDatabaseClient(command.dbPath)

  try {
    await rotateKeys(db, { logger })
    logger.info(
      { event: 'cli.rotate_jwks.completed' },
      'Rotate JWKS command completed'
    )
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

  return (input as RotateJwksCommandInput).loggerSink
}
