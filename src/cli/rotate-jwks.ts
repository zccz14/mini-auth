import { bootstrapDatabase } from '../infra/db/bootstrap.js'
import { createDatabaseClient } from '../infra/db/client.js'
import { rotateKeys } from '../modules/jwks/service.js'
import { parseRotateJwksCommandInput } from '../shared/config.js'

export async function runRotateJwksCommand(input: unknown): Promise<void> {
  const command = parseRotateJwksCommandInput(input)

  await bootstrapDatabase(command.dbPath)

  const db = createDatabaseClient(command.dbPath)

  try {
    await rotateKeys(db)
  } finally {
    db.close()
  }
}
