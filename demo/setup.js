const WAITING_FOR_SDK_ORIGIN_MESSAGE =
  'Add ?sdk-origin=https://your-auth-origin to this page URL to enable the live playground.';

export function getDemoSetupState(locationLike) {
  const origin = locationLike.origin;
  const protocol = locationLike.protocol;
  const hostname = locationLike.hostname;
  const pageHostIsIpAddress = isIpAddressHost(hostname);
  const normalizedSdkOrigin = resolveSdkOrigin(locationLike);
  const corsWarning =
    'Start mini-auth with --origin set to this page origin so the browser can call the auth server cross-origin.';

  if (!normalizedSdkOrigin.ok) {
    return {
      currentOrigin: origin,
      currentRpId: hostname,
      suggestedOrigin: origin,
      suggestedRpId: '',
      sdkOrigin: '',
      sdkScriptUrl: '',
      issuer: '',
      jwksUrl: '',
      configStatus: normalizedSdkOrigin.status,
      configError: normalizedSdkOrigin.error,
      webauthnReady: false,
      corsWarning,
      passkeyWarning: '',
      startupCommand: '',
    };
  }

  const sdkOrigin = normalizedSdkOrigin.value;
  const suggestedRpId = new URL(sdkOrigin).hostname;
  const rpIdIsIpAddress = isIpAddressHost(suggestedRpId);
  const securePageForPasskeys =
    hostname === 'localhost' || (protocol === 'https:' && !pageHostIsIpAddress);
  const pageMatchesSuggestedRpId = doesPageMatchRpId(hostname, suggestedRpId);
  const webauthnReady =
    !rpIdIsIpAddress && securePageForPasskeys && pageMatchesSuggestedRpId;
  const passkeyWarning = rpIdIsIpAddress
    ? 'This demo is configured against an IP-address auth server. Passkeys require a domain RP ID, so use a localhost or HTTPS domain sdk-origin instead.'
    : pageHostIsIpAddress
      ? 'This demo is running on an IP address. Passkeys require a domain RP ID, so open the demo on localhost or an HTTPS domain instead.'
      : !securePageForPasskeys
        ? 'This demo must run on localhost or an HTTPS domain before passkeys will work.'
        : !pageMatchesSuggestedRpId
          ? `This page origin is not compatible with the suggested RP ID ${suggestedRpId}. Open the demo on that domain or a subdomain of it before passkeys will work.`
          : '';
  const issuer = sdkOrigin;

  return {
    currentOrigin: origin,
    currentRpId: hostname,
    suggestedOrigin: origin,
    suggestedRpId,
    sdkOrigin,
    sdkScriptUrl: new URL('/sdk/singleton-iife.js', sdkOrigin).toString(),
    issuer,
    jwksUrl: new URL('/jwks', sdkOrigin).toString(),
    configStatus: 'ready',
    configError: '',
    webauthnReady,
    corsWarning,
    passkeyWarning,
    startupCommand: `mini-auth start ./mini-auth.sqlite --issuer ${issuer} --origin ${origin} --rp-id ${suggestedRpId}`,
  };
}

function doesPageMatchRpId(hostname, rpId) {
  if (hostname === 'localhost' || rpId === 'localhost') {
    return hostname === rpId;
  }

  return hostname === rpId || hostname.endsWith(`.${rpId}`);
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

function isIpAddressHost(hostname) {
  return isIpv4Host(hostname) || isBracketedIpv6Host(hostname);
}

function isIpv4Host(hostname) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

function isBracketedIpv6Host(hostname) {
  return hostname.startsWith('[') && hostname.endsWith(']');
}
