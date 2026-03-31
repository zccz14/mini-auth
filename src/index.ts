#!/usr/bin/env node

import { cac } from 'cac'
import { runCreateCommand } from './cli/create.js'
import { runRotateJwksCommand } from './cli/rotate-jwks.js'

const cli = cac('mini-auth')

cli
  .command('create <dbPath>')
  .option('--smtp-config <file>', 'SMTP config JSON file')
  .action(async (dbPath: string, options: { smtpConfig?: string }) => {
    await executeCommand(() =>
      runCreateCommand({ dbPath, smtpConfig: options.smtpConfig })
    )
  })

cli.command('rotate-jwks <dbPath>').action(async (dbPath: string) => {
  await executeCommand(() => runRotateJwksCommand({ dbPath }))
})

cli
  .command('start <dbPath>')
  .option('--host <host>', 'Listen host')
  .option('--port <port>', 'Listen port')
  .option('--issuer <url>', 'JWT issuer URL')
  .option('--rp-id <rpId>', 'WebAuthn relying party ID')
  .option('--origin <origin>', 'Allowed WebAuthn origin', {
    default: [] as string[]
  })
  .action(async () => {
    await executeCommand(async () => {
      throw new Error('start command is not implemented yet')
    })
  })

cli.version('0.1.0')
cli.help()
cli.parse()

async function executeCommand(run: () => Promise<void>): Promise<void> {
  try {
    await run()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error(message)
    process.exitCode = 1
  }
}
