import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bootstrapDatabase } from '../../src/infra/db/bootstrap.js';
import { createDatabaseClient } from '../../src/infra/db/client.js';
import { bootstrapKeys } from '../../src/modules/jwks/service.js';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from '../../src/modules/webauthn/service.js';
import { createTempDbPath } from '../helpers/db.js';
import { createMemoryLogCollector } from '../helpers/logging.js';
import { createTestPasskey } from '../helpers/webauthn.js';

const { mintSessionTokensMock, createCredentialMock } = vi.hoisted(() => ({
  mintSessionTokensMock: vi.fn(),
  createCredentialMock: vi.fn(),
}));

vi.mock('../../src/modules/session/service.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../src/modules/session/service.js')
  >('../../src/modules/session/service.js');

  mintSessionTokensMock.mockImplementation(actual.mintSessionTokens);

  return {
    ...actual,
    mintSessionTokens: mintSessionTokensMock,
  };
});

vi.mock('../../src/modules/webauthn/repo.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../src/modules/webauthn/repo.js')
  >('../../src/modules/webauthn/repo.js');

  createCredentialMock.mockImplementation(actual.createCredential);

  return {
    ...actual,
    createCredential: createCredentialMock,
  };
});

describe('webauthn service error mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rethrows unexpected registration persistence errors', async () => {
    const testContext = await createWebauthnContext(
      'register-runtime@example.com',
    );
    const passkey = createTestPasskey('register-runtime@example.com');
    const options = await generateRegistrationOptions(testContext.db, {
      userId: testContext.userId,
      email: testContext.email,
      rpId: testContext.rpId,
      logger: testContext.logger,
    });
    const credential = passkey.createRegistrationCredential(
      options.publicKey,
      testContext.origin,
    );

    createCredentialMock.mockImplementationOnce(() => {
      throw new Error('credential write failed');
    });

    await expect(
      verifyRegistration(testContext.db, {
        userId: testContext.userId,
        requestId: options.request_id,
        credential,
        rpId: testContext.rpId,
        origins: [testContext.origin],
        logger: testContext.logger,
      }),
    ).rejects.toThrow('credential write failed');

    testContext.db.close();
  });

  it('rethrows unexpected authentication session errors', async () => {
    const testContext = await createWebauthnContext('auth-runtime@example.com');
    const passkey = createTestPasskey('auth-runtime@example.com');
    const registrationOptions = await generateRegistrationOptions(
      testContext.db,
      {
        userId: testContext.userId,
        email: testContext.email,
        rpId: testContext.rpId,
        logger: testContext.logger,
      },
    );

    await verifyRegistration(testContext.db, {
      userId: testContext.userId,
      requestId: registrationOptions.request_id,
      credential: passkey.createRegistrationCredential(
        registrationOptions.publicKey,
        testContext.origin,
      ),
      rpId: testContext.rpId,
      origins: [testContext.origin],
      logger: testContext.logger,
    });

    const authenticationOptions = await generateAuthenticationOptions(
      testContext.db,
      {
        rpId: testContext.rpId,
        logger: testContext.logger,
      },
    );

    mintSessionTokensMock.mockRejectedValueOnce(
      new Error('session mint failed'),
    );

    await expect(
      verifyAuthentication(testContext.db, {
        requestId: authenticationOptions.request_id,
        credential: passkey.createAuthenticationCredential(
          authenticationOptions.publicKey,
          testContext.origin,
        ),
        rpId: testContext.rpId,
        origins: [testContext.origin],
        issuer: testContext.issuer,
        logger: testContext.logger,
      }),
    ).rejects.toThrow('session mint failed');

    testContext.db.close();
  });
});

async function createWebauthnContext(email: string) {
  const dbPath = await createTempDbPath();
  await bootstrapDatabase(dbPath);
  const db = createDatabaseClient(dbPath);
  const userId = `${email}-user`;
  const logger = createMemoryLogCollector().logger;

  await bootstrapKeys(db);
  db.prepare(
    'INSERT INTO users (id, email, email_verified_at) VALUES (?, ?, ?)',
  ).run(userId, email, new Date().toISOString());

  return {
    db,
    email,
    issuer: 'https://issuer.example',
    logger,
    origin: 'https://app.example.com',
    rpId: 'example.com',
    userId,
  };
}
