import { beforeEach, describe, expect, it, vi } from 'vitest';

const createServer = vi.fn();
const parseRuntimeConfig = vi.fn();
const createDatabaseClient = vi.fn();
const bootstrapKeys = vi.fn();
const createApp = vi.fn();
const createRootLogger = vi.fn();
const loggerChild = vi.fn();
const loggerInfo = vi.fn();
const loggerError = vi.fn();

vi.mock('node:http', () => ({
  createServer,
}));

vi.mock('../../src/shared/config.js', () => ({
  parseRuntimeConfig,
}));

vi.mock('../../src/infra/db/client.js', () => ({
  createDatabaseClient,
}));

vi.mock('../../src/modules/jwks/service.js', () => ({
  bootstrapKeys,
}));

vi.mock('../../src/server/app.js', () => ({
  createApp,
}));

vi.mock('../../src/shared/logger.js', () => ({
  createRootLogger,
  withErrorFields(error: unknown) {
    if (!(error instanceof Error)) {
      return {};
    }

    return {
      error_name: error.name,
      error_message: error.message,
    };
  },
}));

async function loadRunStartCommand() {
  vi.resetModules();
  const module = await import('../../src/app/commands/start.js');

  return module.runStartCommand;
}

async function loadStartCommandModule() {
  vi.resetModules();
  return import('../../src/commands/start.ts');
}

describe('runStartCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    loggerChild.mockReturnValue({
      child: loggerChild,
      info: loggerInfo,
      error: loggerError,
    });
    createRootLogger.mockReturnValue({ child: loggerChild });
    parseRuntimeConfig.mockReturnValue({
      dbPath: '/tmp/auth-mini.db',
      host: '127.0.0.1',
      port: 4100,
      issuer: 'https://issuer.example',
      origins: ['https://app.example.com'],
      rpId: 'example.com',
    });
  });

  it('closes the database when startup fails before listen completes', async () => {
    const db = { close: vi.fn() };

    createDatabaseClient.mockReturnValue(db);
    bootstrapKeys.mockRejectedValue(new Error('bootstrap failed'));

    const runStartCommand = await loadRunStartCommand();

    expect(runStartCommand).toBeTypeOf('function');

    await expect(
      runStartCommand({ dbPath: '/tmp/auth-mini.db' }),
    ).rejects.toThrow('bootstrap failed');
    expect(db.close).toHaveBeenCalledTimes(1);
    expect(bootstrapKeys).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        logger: expect.any(Object),
      }),
    );
  });

  it('converts async request handler failures into a 500 response', async () => {
    const db = { close: vi.fn() };
    let requestHandler:
      | ((req: IncomingMessageLike, res: ServerResponseLike) => unknown)
      | undefined;

    createDatabaseClient.mockReturnValue(db);
    bootstrapKeys.mockResolvedValue({ id: 'key-1', kid: 'kid-1' });
    createApp.mockReturnValue({
      fetch: vi.fn().mockRejectedValue(new Error('boom')),
    });
    createServer.mockImplementation((handler) => {
      requestHandler = handler;

      return {
        once: vi.fn(),
        off: vi.fn(),
        listen: (_port: number, _host: string, callback: () => void) => {
          callback();
        },
        close: (callback: (error?: Error | null) => void) => {
          callback(null);
        },
      };
    });

    const runStartCommand = await loadRunStartCommand();
    expect(runStartCommand).toBeTypeOf('function');
    const server = await runStartCommand({ dbPath: '/tmp/auth-mini.db' });

    const response = createResponseRecorder();

    await expect(
      Promise.resolve(
        requestHandler?.(
          createRequest({ method: 'GET', url: '/jwks' }),
          response,
        ),
      ),
    ).resolves.toBeUndefined();
    expect(response.statusCode).toBe(500);
    expect(response.headers['content-type']).toBe('application/json');
    expect(response.body).toBe('{"error":"internal_server_error"}');
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'server.request.failed',
        error_message: 'boom',
      }),
      'HTTP request handling failed',
    );

    await server.close();
  });
});

describe('createStartLifecycle', () => {
  it('registers SIGINT and SIGTERM handlers', async () => {
    const on = vi.fn();
    const off = vi.fn();
    const { createStartLifecycle } = await loadStartCommandModule();

    createStartLifecycle({ close: vi.fn(), on, off });

    expect(on).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    expect(on).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
  });

  it('closes the server only once when shutdown signals repeat', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const on = vi.fn();
    const off = vi.fn();
    const { createStartLifecycle } = await loadStartCommandModule();

    createStartLifecycle({ close, on, off });
    const shutdown = on.mock.calls[0]?.[1] as (() => Promise<void>) | undefined;

    await shutdown?.();
    await shutdown?.();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('removes listeners after shutdown and forwards close errors', async () => {
    const error = new Error('close failed');
    const close = vi.fn().mockRejectedValue(error);
    const on = vi.fn();
    const off = vi.fn();
    const onCloseError = vi.fn();
    const { createStartLifecycle } = await loadStartCommandModule();

    createStartLifecycle({ close, on, off, onCloseError });
    const shutdown = on.mock.calls[0]?.[1] as (() => Promise<void>) | undefined;

    await shutdown?.();

    expect(off).toHaveBeenCalledWith('SIGINT', shutdown);
    expect(off).toHaveBeenCalledWith('SIGTERM', shutdown);
    expect(onCloseError).toHaveBeenCalledWith(error);
  });
});

type IncomingMessageLike = {
  headers: Record<string, string>;
  method: string;
  socket: { remoteAddress: string | null };
  url: string;
  [Symbol.asyncIterator](): AsyncIterator<Buffer>;
};

type ServerResponseLike = {
  body: string;
  headers: Record<string, string>;
  setHeader(name: string, value: string): void;
  end(chunk?: Buffer | string): void;
  statusCode: number;
};

function createRequest(input: {
  method: string;
  url: string;
}): IncomingMessageLike {
  return {
    headers: {
      host: '127.0.0.1:4100',
    },
    method: input.method,
    socket: { remoteAddress: '203.0.113.10' },
    url: input.url,
    async *[Symbol.asyncIterator]() {},
  };
}

function createResponseRecorder(): ServerResponseLike {
  return {
    body: '',
    headers: {},
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(chunk?: Buffer | string) {
      this.body = typeof chunk === 'string' ? chunk : (chunk?.toString() ?? '');
    },
    statusCode: 200,
  };
}
