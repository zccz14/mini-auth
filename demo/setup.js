const WAITING_FOR_SDK_ORIGIN_MESSAGE =
  'Add ?sdk-origin=https://your-auth-origin to this page URL to enable the live playground.';

export function getDemoSetupState(locationLike) {
  const origin = locationLike.origin;
  const hostname = locationLike.hostname;
  const normalizedSdkOrigin = resolveSdkOrigin(locationLike);
  const corsWarning =
    'Start auth-mini with --origin set to this page origin so the browser can call the auth server cross-origin.';

  if (!normalizedSdkOrigin.ok) {
    return {
      currentOrigin: origin,
      currentRpId: hostname,
      suggestedOrigin: origin,
      sdkOrigin: '',
      sdkScriptUrl: '',
      issuer: '',
      jwksUrl: '',
      configStatus: normalizedSdkOrigin.status,
      configError: normalizedSdkOrigin.error,
      corsWarning,
      startupCommand: '',
    };
  }

  const sdkOrigin = normalizedSdkOrigin.value;
  const issuer = sdkOrigin;

  return {
    currentOrigin: origin,
    currentRpId: hostname,
    suggestedOrigin: origin,
    sdkOrigin,
    sdkScriptUrl: new URL('/sdk/singleton-iife.js', sdkOrigin).toString(),
    issuer,
    jwksUrl: new URL('/jwks', sdkOrigin).toString(),
    configStatus: 'ready',
    configError: '',
    corsWarning,
    startupCommand: `auth-mini start ./auth-mini.sqlite --issuer ${issuer} --origin ${origin}`,
  };
}

function getOriginFromSdkUrl(sdkUrl) {
  if (typeof sdkUrl !== 'string' || !sdkUrl) {
    return '';
  }

  try {
    return new URL(sdkUrl).origin;
  } catch {
    return '';
  }
}

function resolveSdkOrigin(locationLike) {
  if (locationLike.sdkOriginInput !== undefined) {
    return withStatus(normalizeSdkOrigin(locationLike.sdkOriginInput), 'error');
  }

  if (typeof locationLike.sdkUrl !== 'string' || !locationLike.sdkUrl) {
    return {
      ok: false,
      status: 'waiting',
      error: WAITING_FOR_SDK_ORIGIN_MESSAGE,
    };
  }

  const derivedOrigin = getOriginFromSdkUrl(locationLike.sdkUrl);
  if (!derivedOrigin) {
    return withStatus(normalizeSdkOrigin(''), 'error');
  }

  return withStatus(normalizeSdkOrigin(derivedOrigin), 'ready');
}

function withStatus(result, status) {
  if (result.ok) {
    return { ...result, status };
  }

  return { ...result, status: 'error' };
}

function normalizeSdkOrigin(value) {
  if (typeof value !== 'string' || !value) {
    return { ok: false, error: 'sdk-origin must be an origin-only URL.' };
  }

  try {
    const url = new URL(value);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, error: 'sdk-origin must be an origin-only URL.' };
    }

    if (url.username || url.password) {
      return { ok: false, error: 'sdk-origin must be an origin-only URL.' };
    }

    if (url.pathname !== '/' || url.search || url.hash) {
      return { ok: false, error: 'sdk-origin must be an origin-only URL.' };
    }

    return { ok: true, value: url.origin };
  } catch {
    return { ok: false, error: 'sdk-origin must be an origin-only URL.' };
  }
}
