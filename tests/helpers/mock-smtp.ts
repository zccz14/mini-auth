import { createServer } from 'node:net'

export type MockMail = {
  from: string
  to: string
  subject: string
  text: string
}

export type MockSmtpTransport = {
  send(_config: unknown, message: MockMail): Promise<void>
}

export function createMockSmtp() {
  const mailbox: MockMail[] = []
  let failNext = false

  return {
    mailbox,
    failNextSend() {
      failNext = true
    },
    transport: {
      async send(_config: unknown, message: MockMail): Promise<void> {
        if (failNext) {
          failNext = false
          throw new Error('Mock SMTP send failed')
        }

        mailbox.push(message)
      }
    } satisfies MockSmtpTransport
  }
}

export function extractOtpCode(text: string): string {
  const match = text.match(/\b(\d{6})\b/)

  if (!match) {
    throw new Error('OTP code not found in mock email body')
  }

  return match[1]
}

export async function startMockSmtpServer(): Promise<{
  port: number
  mailbox: MockMail[]
  close(): Promise<void>
}> {
  return startConfigurableMockSmtpServer({})
}

export async function startConfigurableMockSmtpServer(options: {
  onEhlo?: string[]
  onAuth?: string[]
  onMailFrom?: string[]
  onRcptTo?: string[]
  onData?: string[]
  onQueued?: string[]
  onQuit?: string[]
}): Promise<{
  port: number
  mailbox: MockMail[]
  close(): Promise<void>
}> {
  const mailbox: MockMail[] = []
  const server = createServer((socket) => {
    let state: 'command' | 'data' = 'command'
    let dataLines: string[] = []
    let currentMail: Partial<MockMail> = {}
    let buffer = ''

    socket.setEncoding('utf8')
    socket.write('220 mock-smtp ready\r\n')

    socket.on('data', (chunk: string) => {
      buffer += chunk

      while (buffer.includes('\r\n')) {
        const index = buffer.indexOf('\r\n')
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)

        if (state === 'data') {
          if (line === '.') {
            mailbox.push(parseData(currentMail, dataLines))
            currentMail = {}
            dataLines = []
            state = 'command'
            writeResponses(socket, options.onQueued ?? ['250 queued'])
            continue
          }

          dataLines.push(line)
          continue
        }

        if (line.startsWith('EHLO ') || line.startsWith('HELO ')) {
          writeResponses(
            socket,
            options.onEhlo ?? ['250-mock-smtp', '250 AUTH PLAIN']
          )
          continue
        }

        if (line.startsWith('AUTH PLAIN ')) {
          writeResponses(socket, options.onAuth ?? ['235 authenticated'])
          continue
        }

        if (line.startsWith('MAIL FROM:')) {
          currentMail.from = extractAddress(line)
          writeResponses(socket, options.onMailFrom ?? ['250 ok'])
          continue
        }

        if (line.startsWith('RCPT TO:')) {
          currentMail.to = extractAddress(line)
          writeResponses(socket, options.onRcptTo ?? ['250 ok'])
          continue
        }

        if (line === 'DATA') {
          state = 'data'
          writeResponses(
            socket,
            options.onData ?? ['354 end data with <CR><LF>.<CR><LF>']
          )
          continue
        }

        if (line === 'QUIT') {
          writeResponses(socket, options.onQuit ?? ['221 bye'])
          socket.end()
          continue
        }

        socket.write('250 ok\r\n')
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()

  if (!address || typeof address === 'string') {
    throw new Error('Mock SMTP server failed to bind')
  }

  return {
    port: address.port,
    mailbox,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })
    }
  }
}

function writeResponses(
  socket: { write(value: string): void },
  lines: string[]
): void {
  socket.write(`${lines.join('\r\n')}\r\n`)
}

function extractAddress(line: string): string {
  const match = line.match(/<([^>]+)>/)

  if (!match) {
    throw new Error(`Invalid SMTP address line: ${line}`)
  }

  return match[1]
}

function parseData(mail: Partial<MockMail>, lines: string[]): MockMail {
  const subjectLine = lines.find((line) => line.startsWith('Subject: '))
  const bodyIndex = lines.findIndex((line) => line === '')
  const text = bodyIndex >= 0 ? lines.slice(bodyIndex + 1).join('\n') : ''

  return {
    from: mail.from ?? '',
    to: mail.to ?? '',
    subject: subjectLine?.slice('Subject: '.length) ?? '',
    text
  }
}
