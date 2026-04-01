import { access } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRootLogger, type AppLogger } from '../../shared/logger.js'
import { createDatabaseClient } from './client.js'
import { runSqlFile } from './migrations.js'

const currentFilePath = fileURLToPath(import.meta.url)
const currentDirectoryPath = dirname(currentFilePath)

async function resolveSchemaFilePath(): Promise<string> {
  const candidatePaths = [
    resolve(currentDirectoryPath, '../../../sql/schema.sql'),
    resolve(currentDirectoryPath, '../../../../sql/schema.sql'),
    resolve(process.cwd(), 'sql/schema.sql')
  ]

  for (const candidatePath of candidatePaths) {
    try {
      await access(candidatePath)
      return candidatePath
    } catch {
      continue
    }
  }

  throw new Error(
    `Unable to locate sql/schema.sql from ${currentDirectoryPath}`
  )
}

export async function bootstrapDatabase(
  dbPath: string,
  input?: { logger?: AppLogger }
): Promise<void> {
  const logger = input?.logger ?? createRootLogger().child({ db_path: dbPath })
  const db = createDatabaseClient(dbPath)

  try {
    logger.info({ event: 'db.migration.started' }, 'Database migration started')
    const schemaFilePath = await resolveSchemaFilePath()
    await runSqlFile(db, schemaFilePath)
    logger.info(
      { event: 'db.migration.completed' },
      'Database migration completed'
    )
  } finally {
    db.close()
  }
}
