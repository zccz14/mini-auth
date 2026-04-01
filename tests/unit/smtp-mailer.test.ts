import { beforeEach, describe, expect, it, vi } from 'vitest'

const createTransport = vi.fn()

vi.mock('nodemailer', () => ({
  createTransport,
  default: {
    createTransport
  }
}))

const smtpConfig = {
  id: 1,
  host: 'smtp.example.com',
  port: 587,
  username: 'mailer-user',
  password: 'mailer-pass',
  fromEmail: 'noreply@example.com',
  fromName: 'Mini Auth',
  secure: false,
  isActive: true,
  weight: 1
}

const recipient = 'user@example.com'
const code = '123456'

async function loadSendOtpMail() {
  vi.resetModules()
  const mailer = await import('../../src/infra/smtp/mailer.js')

  return mailer.sendOtpMail
}

describe('smtp mailer', () => {
  beforeEach(() => {
    createTransport.mockReset()
  })

  it('maps smtp config into a nodemailer transport with explicit timeouts', async () => {
    const sendMail = vi.fn().mockResolvedValue({
      accepted: [recipient],
      rejected: []
    })

    createTransport.mockReturnValue({ sendMail })

    const sendOtpMail = await loadSendOtpMail()

    await sendOtpMail(smtpConfig, recipient, code)

    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: {
        user: 'mailer-user',
        pass: 'mailer-pass'
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000
    })
    expect(sendMail).toHaveBeenCalledWith({
      from: 'Mini Auth <noreply@example.com>',
      to: recipient,
      subject: 'Your mini-auth verification code',
      text: 'Your verification code is 123456. It expires in 10 minutes.'
    })
  })

  it('succeeds only when the target recipient is accepted and not rejected', async () => {
    createTransport.mockReturnValue({
      sendMail: vi.fn().mockResolvedValue({
        accepted: [recipient],
        rejected: []
      })
    })

    const sendOtpMail = await loadSendOtpMail()

    await expect(
      sendOtpMail(smtpConfig, recipient, code)
    ).resolves.toBeUndefined()
  })

  it('throws when sendMail rejects', async () => {
    createTransport.mockReturnValue({
      sendMail: vi.fn().mockRejectedValue(new Error('smtp offline'))
    })

    const sendOtpMail = await loadSendOtpMail()

    await expect(sendOtpMail(smtpConfig, recipient, code)).rejects.toThrow(
      'smtp offline'
    )
  })

  it('throws when sendMail returns no accepted recipients', async () => {
    createTransport.mockReturnValue({
      sendMail: vi.fn().mockResolvedValue({
        accepted: [],
        rejected: []
      })
    })

    const sendOtpMail = await loadSendOtpMail()

    await expect(sendOtpMail(smtpConfig, recipient, code)).rejects.toThrow()
  })

  it('throws when sendMail does not accept the target recipient', async () => {
    createTransport.mockReturnValue({
      sendMail: vi.fn().mockResolvedValue({
        accepted: ['other@example.com'],
        rejected: [recipient]
      })
    })

    const sendOtpMail = await loadSendOtpMail()

    await expect(sendOtpMail(smtpConfig, recipient, code)).rejects.toThrow()
  })
})
