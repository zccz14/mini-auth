import {
  createHash,
  generateKeyPairSync,
  sign,
  type JsonWebKey,
  type KeyObject
} from 'node:crypto'
import { Encoder } from 'cbor-x'
import { encodeBase64Url } from '../../src/shared/crypto.js'

const encoder = new Encoder()

type RegistrationOptions = {
  challenge: string
  rp: { id: string; name: string }
  user: { id: string; name: string; displayName: string }
}

type AuthenticationOptions = {
  challenge: string
  rpId: string
}

export function createTestPasskey(seed = 'default-passkey') {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1'
  })
  const publicJwk = publicKey.export({ format: 'jwk' }) as JsonWebKey
  const credentialId = sha256(Buffer.from(seed, 'utf8')).subarray(0, 32)
  let counter = 0

  return {
    credentialId: encodeBase64Url(credentialId),
    createRegistrationCredential(options: RegistrationOptions, origin: string) {
      const clientDataJSON = toClientDataJSON({
        type: 'webauthn.create',
        challenge: options.challenge,
        origin
      })
      const authData = Buffer.concat([
        sha256(options.rp.id),
        Buffer.from([0x45]),
        toUint32Buffer(counter),
        Buffer.alloc(16),
        toUint16Buffer(credentialId.length),
        credentialId,
        encoder.encode(toCoseKey(publicJwk))
      ])
      const signature = signPayload(privateKey, authData, clientDataJSON)
      const attestationObject = encoder.encode({
        fmt: 'packed',
        attStmt: {
          alg: -7,
          sig: signature
        },
        authData
      })

      return {
        id: encodeBase64Url(credentialId),
        rawId: encodeBase64Url(credentialId),
        type: 'public-key',
        response: {
          clientDataJSON: encodeBase64Url(clientDataJSON),
          attestationObject: encodeBase64Url(attestationObject),
          transports: ['internal']
        }
      }
    },
    createAuthenticationCredential(
      options: AuthenticationOptions,
      origin: string
    ) {
      counter += 1
      return this.createAuthenticationCredentialWithCounter(
        options,
        origin,
        counter
      )
    },
    createAuthenticationCredentialWithCounter(
      options: AuthenticationOptions,
      origin: string,
      nextCounter: number
    ) {
      const clientDataJSON = toClientDataJSON({
        type: 'webauthn.get',
        challenge: options.challenge,
        origin
      })
      const authenticatorData = Buffer.concat([
        sha256(options.rpId),
        Buffer.from([0x05]),
        toUint32Buffer(nextCounter)
      ])
      const signature = signPayload(
        privateKey,
        authenticatorData,
        clientDataJSON
      )

      return {
        id: encodeBase64Url(credentialId),
        rawId: encodeBase64Url(credentialId),
        type: 'public-key',
        response: {
          clientDataJSON: encodeBase64Url(clientDataJSON),
          authenticatorData: encodeBase64Url(authenticatorData),
          signature: encodeBase64Url(signature)
        }
      }
    }
  }
}

function toClientDataJSON(input: {
  type: 'webauthn.create' | 'webauthn.get'
  challenge: string
  origin: string
}): Buffer {
  return Buffer.from(
    JSON.stringify({
      type: input.type,
      challenge: input.challenge,
      origin: input.origin,
      crossOrigin: false
    }),
    'utf8'
  )
}

function signPayload(
  privateKey: KeyObject,
  authData: Buffer,
  clientDataJSON: Buffer
): Buffer {
  const payload = Buffer.concat([authData, sha256(clientDataJSON)])

  return sign('sha256', payload, privateKey)
}

function toCoseKey(publicJwk: JsonWebKey) {
  return new Map<number, number | Buffer>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, Buffer.from(publicJwk.x ?? '', 'base64url')],
    [-3, Buffer.from(publicJwk.y ?? '', 'base64url')]
  ])
}

function toUint16Buffer(value: number): Buffer {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16BE(value, 0)
  return buffer
}

function toUint32Buffer(value: number): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32BE(value, 0)
  return buffer
}

function sha256(value: string | Buffer): Buffer {
  return createHash('sha256').update(value).digest()
}
