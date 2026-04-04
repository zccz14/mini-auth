export function getDemoSetupState(locationLike) {
  const origin = locationLike.origin;
  const protocol = locationLike.protocol;
  const hostname = locationLike.hostname;
  const ipAddressHost = isIpAddressHost(hostname);
  const webauthnReady =
    hostname === 'localhost' || (protocol === 'https:' && !ipAddressHost);
  const fallbackRpId = webauthnReady ? hostname : 'localhost';
  const corsWarning =
    'Start mini-auth with --origin set to this page origin so the browser can call the auth server cross-origin.';
  const passkeyWarning = ipAddressHost
    ? 'This demo is running on an IP address. Passkeys require a domain RP ID, so open the demo on localhost or an HTTPS domain instead.'
    : webauthnReady
      ? ''
      : 'This demo must run on localhost or an HTTPS domain before passkeys will work.';

  const normalizedSdkOrigin = normalizeSdkOrigin(
    locationLike.sdkOriginInput ?? getOriginFromSdkUrl(locationLike.sdkUrl),
  );

  if (!normalizedSdkOrigin.ok && locationLike.sdkOriginInput) {
    return {
      currentOrigin: origin,
      currentRpId: hostname,
      suggestedOrigin: origin,
      suggestedRpId: '',
      sdkOrigin: '',
      sdkScriptUrl: '',
      issuer: '',
      jwksUrl: '',
      configError: normalizedSdkOrigin.error,
      webauthnReady: false,
      corsWarning,
      passkeyWarning,
      startupCommand: '',
    };
  }

  const sdkOrigin = normalizedSdkOrigin.ok ? normalizedSdkOrigin.value : '';
  const suggestedRpId = sdkOrigin ? new URL(sdkOrigin).hostname : fallbackRpId;
  const issuer = sdkOrigin || '<auth-server-origin>';

  return {
    currentOrigin: origin,
    currentRpId: hostname,
    suggestedOrigin: origin,
    suggestedRpId,
    sdkOrigin,
    sdkScriptUrl: sdkOrigin
      ? new URL('/sdk/singleton-iife.js', sdkOrigin).toString()
      : '',
    issuer,
    jwksUrl: sdkOrigin ? new URL('/jwks', sdkOrigin).toString() : '',
    configError: '',
    webauthnReady,
    corsWarning,
    passkeyWarning,
    startupCommand: `mini-auth start ./mini-auth.sqlite --issuer ${issuer} --origin ${origin} --rp-id ${suggestedRpId}`,
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

function normalizeSdkOrigin(value) {
  if (typeof value !== 'string' || !value) {
    return { ok: false, error: 'sdk-origin must be an origin-only URL.' };
  }

  try {
    const url = new URL(value);

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
