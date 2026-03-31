import { z } from 'zod'

const runtimeConfigSchema = z.object({
  dbPath: z.string().min(1),
  host: z.string().min(1).default('127.0.0.1'),
  port: z.coerce.number().int().positive().default(7777),
  issuer: z.url(),
  rpId: z.string().min(1),
  origin: z.array(z.string().min(1)).min(1)
})

const createCommandSchema = z.object({
  dbPath: z.string().min(1),
  smtpConfig: z.string().min(1).optional()
})

const rotateJwksCommandSchema = z.object({
  dbPath: z.string().min(1)
})

export type RuntimeConfig = {
  dbPath: string
  host: string
  port: number
  issuer: string
  rpId: string
  origins: string[]
}

export type CreateCommandInput = z.infer<typeof createCommandSchema>
export type RotateJwksCommandInput = z.infer<typeof rotateJwksCommandSchema>

export function parseRuntimeConfig(input: unknown): RuntimeConfig {
  const parsed = runtimeConfigSchema.parse(input)

  return {
    dbPath: parsed.dbPath,
    host: parsed.host,
    port: parsed.port,
    issuer: parsed.issuer,
    rpId: parsed.rpId,
    origins: parsed.origin
  }
}

export function parseCreateCommandInput(input: unknown): CreateCommandInput {
  return createCommandSchema.parse(input)
}

export function parseRotateJwksCommandInput(
  input: unknown
): RotateJwksCommandInput {
  return rotateJwksCommandSchema.parse(input)
}
