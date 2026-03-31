import { bootstrapDatabase } from '../infra/db/bootstrap.js'
import { createDatabaseClient } from '../infra/db/client.js'
import { importSmtpConfigs } from '../infra/smtp/config-import.js'
import { bootstrapKeys } from '../modules/jwks/service.js'
import { parseCreateCommandInput } from '../shared/config.js'

export async function runCreateCommand(input: unknown): Promise<void> {
  const command = parseCreateCommandInput(input)

  await bootstrapDatabase(command.dbPath)

  const db = createDatabaseClient(command.dbPath)

  try {
    await bootstrapKeys(db)

    if (command.smtpConfig) {
      await importSmtpConfigs(db, command.smtpConfig)
    }
  } finally {
    db.close()
  }
}
