import { Buffer } from 'node:buffer'
import net from 'node:net'
import tls from 'node:tls'
import type { DatabaseClient } from '../db/client.js'

export type SmtpConfig = {
  id: number
  host: string
  port: number
  username: string
  password: string
  fromEmail: string
  fromName?: string
  secure?: boolean
  isActive: boolean
  weight?: number
}

export type NormalizedSmtpConfig = Omit<
  SmtpConfig,
  'fromName' | 'secure' | 'weight'
> & {
  fromName: string
  secure: boolean
  weight: number
}

export type MailMessage = {
  from: string
  to: string
  subject: string
  text: string
}

export type SmtpTransport = {
  send(config: NormalizedSmtpConfig, message: MailMessage): Promise<void>
}

type SmtpConfigRow = {
  id: number
  host: string
  port: number
  username: string
  password: string
  from_email: string
  from_name: string
  secure: number
  is_active: number
  weight: number
}

export function listSmtpConfigs(db: DatabaseClient): NormalizedSmtpConfig[] {
  const rows = db
    .prepare(
      [
        'SELECT id, host, port, username, password, from_email, from_name, secure, is_active, weight',
        'FROM smtp_configs',
        'ORDER BY id ASC'
      ].join(' ')
    )
    .all() as SmtpConfigRow[]

  return rows.map((row) =>
    normalizeSmtpConfig({
      id: row.id,
      host: row.host,
      port: row.port,
      username: row.username,
      password: row.password,
      fromEmail: row.from_email,
      fromName: row.from_name,
      secure: row.secure === 1,
      isActive: row.is_active === 1,
      weight: row.weight
    })
  )
}

export function selectSmtpConfig(
  configs: SmtpConfig[],
  random: () => number = Math.random
): NormalizedSmtpConfig | null {
  const activeConfigs = configs
    .map(normalizeSmtpConfig)
    .filter((config) => config.isActive)

  if (activeConfigs.length === 0) {
    return null
  }

  const totalWeight = activeConfigs.reduce(
    (sum, config) => sum + config.weight,
    0
  )
  let remaining = random() * totalWeight

  for (const config of activeConfigs) {
    remaining -= config.weight

    if (remaining < 0) {
      return config
    }
  }

  return activeConfigs.at(-1) ?? null
}

export async function sendOtpMail(
  transport: SmtpTransport,
  config: NormalizedSmtpConfig,
  email: string,
  code: string
): Promise<void> {
  const from = config.fromName
    ? `${config.fromName} <${config.fromEmail}>`
    : config.fromEmail

  await transport.send(config, {
    from,
    to: email,
    subject: 'Your mini-auth verification code',
    text: `Your verification code is ${code}. It expires in 10 minutes.`
  })
}

export function createRuntimeSmtpTransport(): SmtpTransport {
  return {
    async send(config, message) {
      const socket = await connectSmtp(config)

      try {
        await expectReply(readReply(socket), [220], 'greeting')
        await sendCommand(socket, `EHLO ${getEhloName(config.host)}`)
        await expectReply(readMultilineReply(socket), [250], 'ehlo')
        await sendCommand(socket, `AUTH PLAIN ${encodeAuthPlain(config)}`)
        await expectReply(readReply(socket), [235], 'auth')
        await sendCommand(socket, `MAIL FROM:<${config.fromEmail}>`)
        await expectReply(readReply(socket), [250], 'mail_from')
        await sendCommand(socket, `RCPT TO:<${message.to}>`)
        await expectReply(readReply(socket), [250, 251], 'rcpt_to')
        await sendCommand(socket, 'DATA')
        await expectReply(readReply(socket), [354], 'data')
        await writeLine(socket, buildMessageData(message))
        await expectReply(readReply(socket), [250], 'queued')
        await sendCommand(socket, 'QUIT')
        await expectReply(readReply(socket), [221], 'quit')
      } finally {
        socket.end()
      }
    }
  }
}

function normalizeSmtpConfig(config: SmtpConfig): NormalizedSmtpConfig {
  return {
    ...config,
    fromName: config.fromName ?? '',
    secure: config.secure ?? false,
    weight: config.weight ?? 1
  }
}

async function connectSmtp(
  config: NormalizedSmtpConfig
): Promise<net.Socket | tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = config.secure
      ? tls.connect(buildSecureSmtpOptions(config))
      : net.connect({
          host: config.host,
          port: config.port
        })

    socket.once('error', reject)
    socket.once('connect', () => {
      socket.off('error', reject)
      resolve(socket)
    })
  })
}

export function buildSecureSmtpOptions(
  config: Pick<NormalizedSmtpConfig, 'host' | 'port'>
): tls.ConnectionOptions {
  return {
    host: config.host,
    port: config.port,
    servername: config.host
  }
}

async function sendCommand(
  socket: net.Socket | tls.TLSSocket,
  command: string
): Promise<void> {
  await writeLine(socket, command)
}

async function writeLine(
  socket: net.Socket | tls.TLSSocket,
  value: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.write(`${value}\r\n`, (error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

async function readReply(socket: net.Socket | tls.TLSSocket): Promise<string> {
  const lines = await readSmtpLines(socket)
  return lines[0] ?? ''
}

async function readMultilineReply(
  socket: net.Socket | tls.TLSSocket
): Promise<string[]> {
  return readSmtpLines(socket)
}

async function expectReply(
  replyPromise: Promise<string | string[]>,
  expectedCodes: number[],
  stage: string
): Promise<void> {
  const reply = await replyPromise
  const lines = Array.isArray(reply) ? reply : [reply]

  if (lines.length === 0) {
    throw new Error(`SMTP ${stage} returned no reply`)
  }

  for (const line of lines) {
    const code = parseReplyCode(line)

    if (!expectedCodes.includes(code)) {
      throw new Error(`SMTP ${stage} failed with ${line}`)
    }
  }
}

async function readSmtpLines(
  socket: net.Socket | tls.TLSSocket
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    let buffer = ''

    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8')

      if (!buffer.includes('\r\n')) {
        return
      }

      const lines = buffer.split('\r\n').filter(Boolean)
      const lastLine = lines.at(-1)

      if (!lastLine || lastLine.length < 4 || lastLine[3] === '-') {
        return
      }

      cleanup()
      resolve(lines)
    }

    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }

    const cleanup = () => {
      socket.off('data', onData)
      socket.off('error', onError)
    }

    socket.on('data', onData)
    socket.on('error', onError)
  })
}

function encodeAuthPlain(config: NormalizedSmtpConfig): string {
  return Buffer.from(
    `\u0000${config.username}\u0000${config.password}`
  ).toString('base64')
}

function parseReplyCode(line: string): number {
  const match = line.match(/^(\d{3})[ -]/)

  if (!match) {
    throw new Error(`Invalid SMTP reply: ${line}`)
  }

  return Number(match[1])
}

function buildMessageData(message: MailMessage): string {
  return [
    `From: ${message.from}`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    '',
    message.text,
    '.'
  ].join('\r\n')
}

function getEhloName(host: string): string {
  return host === '127.0.0.1' ? 'localhost' : host
}
