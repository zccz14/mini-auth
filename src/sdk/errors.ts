import type { ServerErrorPayload } from './types.js';

export type SdkErrorCode =
  | 'sdk_init_failed'
  | 'missing_session'
  | 'request_failed'
  | 'webauthn_cancelled'
  | 'webauthn_unsupported';

export type SdkError = Error & {
  code: SdkErrorCode;
};

export function createSdkError(code: SdkErrorCode, message: string): SdkError {
  const error = new Error(`${code}: ${message}`) as SdkError;
  error.name = 'MiniAuthSdkError';
  error.code = code;
  return error;
}

export function createRequestError(
  status: number,
  payload: ServerErrorPayload | null,
): Error & ServerErrorPayload & { status: number } {
  const code =
    typeof payload?.error === 'string' ? payload.error : 'request_failed';
  const error = createSdkError(
    'request_failed',
    typeof payload?.error === 'string'
      ? payload.error
      : `Request failed with status ${status}`,
  ) as unknown as Error & ServerErrorPayload & { status: number };

  error.status = status;

  if (payload) {
    Object.assign(error, payload);
  }

  if (!('error' in error)) {
    error.error = code;
  }

  return error;
}
