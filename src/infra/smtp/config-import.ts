import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type { DatabaseClient } from '../db/client.js'

const smtpConfigRowSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().positive(),
  username: z.string().min(1),
  password: z.string().min(1),
  from_email: z.string().min(1),
  from_name: z.string().default(''),
  secure: z.boolean().default(false),
  weight: z.coerce.number().int().positive().default(1)
})

const smtpConfigFileSchema = z.array(smtpConfigRowSchema)

type SmtpConfigRow = z.infer<typeof smtpConfigRowSchema>

export async function readSmtpConfigImportFile(
  filePath: string
): Promise<SmtpConfigRow[]> {
  let parsedJson: unknown

  try {
    parsedJson = JSON.parse(await readFile(filePath, 'utf8')) as unknown
  } catch (error) {
    throw new Error(`Invalid SMTP config: ${getErrorMessage(error)}`)
  }

  const result = smtpConfigFileSchema.safeParse(parsedJson)

  if (!result.success) {
    throw new Error(
      `Invalid SMTP config: ${result.error.issues
        .map((issue) => issue.message)
        .join(', ')}`
    )
  }

  return result.data
}

export async function importSmtpConfigs(
  db: DatabaseClient,
  filePath: string
): Promise<number> {
  const rows = await readSmtpConfigImportFile(filePath)
  const insert = db.prepare(
    [
      'INSERT INTO smtp_configs',
      '(host, port, username, password, from_email, from_name, secure, weight)',
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ].join(' ')
  )
  const transaction = db.transaction((configRows: SmtpConfigRow[]) => {
    for (const row of configRows) {
      insert.run(
        row.host,
        row.port,
        row.username,
        row.password,
        row.from_email,
        row.from_name,
        row.secure ? 1 : 0,
        row.weight
      )
    }
  })

  transaction(rows)
  return rows.length
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}
