const API_DETAILS_LABEL = 'Show request and response';

export function buildDemoContent(setupState) {
  const {
    currentOrigin,
    issuer,
    jwksUrl,
    sdkOrigin,
    sdkScriptUrl,
    startupCommand,
  } = setupState;
  const placeholderOrigin = 'https://your-auth-origin';
  const resolvedSdkOrigin = sdkOrigin || placeholderOrigin;
  const resolvedIssuer = issuer || placeholderOrigin;
  const resolvedJwksUrl = jwksUrl || `${placeholderOrigin}/jwks`;

  return {
    sdkScriptTag: sdkScriptUrl
      ? `<script src="${sdkScriptUrl}"></script>`
      : '<!-- Add ?sdk-origin=https://your-auth-origin to render the exact SDK script tag. -->',
    startupCommand,
    hero: {
      title: 'mini-auth',
      valueProp:
        'A small, self-hosted auth server for apps that just need auth.',
      audience:
        'For teams that want auth with email OTP, passkeys, JWTs, JWKS, and SQLite without adopting a larger platform.',
      capabilities: [
        'email OTP',
        'passkey',
        'JWT',
        'JWKS',
        'SQLite',
        'self-hosted',
      ],
    },
    howItWorks: [
      'The page origin is the value you pass to mini-auth --origin.',
      'The sdk-origin is where the browser loads /sdk/singleton-iife.js.',
      'script origin == api origin: the singleton SDK always talks back to the auth server that served the script.',
      'WebAuthn and CORS both depend on the auth server being started with the right origin settings.',
    ],
    joseSnippet: [
      "import { createRemoteJWKSet, jwtVerify } from 'jose';",
      '',
      `const issuer = '${resolvedIssuer}';`,
      "const jwks = createRemoteJWKSet(new URL('/jwks', issuer));",
      '// Validate aud when your backend defines an audience boundary.',
      'await jwtVerify(token, jwks, { issuer });',
    ].join('\n'),
    apiReference: [
      makeApiEntry({
        sdkOrigin: resolvedSdkOrigin,
        method: 'POST',
        path: '/email/start',
        when: 'Start email sign-in with an email OTP.',
        body: { email: 'user@example.com' },
        response: '{ "ok": true }',
      }),
      makeApiEntry({
        sdkOrigin: resolvedSdkOrigin,
        method: 'POST',
        path: '/email/verify',
        when: 'Exchange the email OTP for a signed-in session.',
        body: { email: 'user@example.com', code: '123456' },
        response:
          '{ "access_token": "<jwt>", "token_type": "Bearer", "expires_in": 3600, "refresh_token": "<refresh-token>" }',
      }),
      makeApiEntry({
        sdkOrigin: resolvedSdkOrigin,
        method: 'POST',
        path: '/session/refresh',
        when: 'Rotate a refresh token into a fresh access token.',
        body: { refresh_token: '<refresh-token>' },
        response:
          '{ "access_token": "<jwt>", "token_type": "Bearer", "expires_in": 3600, "refresh_token": "<refresh-token>" }',
      }),
      makeApiEntry({
        sdkOrigin: resolvedSdkOrigin,
        method: 'GET',
        path: '/me',
        when: 'Hydrate frontend user/session state after sign-in or refresh.',
        headers: { authorization: 'Bearer <access_token>' },
        response:
          '{ "user_id": "user_123", "email": "user@example.com", "webauthn_credentials": [{ "credential_id": "cred_123", "public_key": "<base64url>", "counter": 1, "transports": "internal" }], "active_sessions": [{ "id": "sess_123", "created_at": "2026-04-04T00:00:00.000Z", "expires_at": "2026-04-05T00:00:00.000Z" }] }',
      }),
      makeApiEntry({
        sdkOrigin: resolvedSdkOrigin,
        method: 'POST',
        path: '/session/logout',
        when: 'Invalidate the active session and clear refresh credentials.',
        headers: { authorization: 'Bearer <access_token>' },
        response: '{ "ok": true }',
      }),
      makeApiEntry({
        sdkOrigin: resolvedSdkOrigin,
        method: 'POST',
        path: '/webauthn/register/options',
        when: 'Request registration options before creating a passkey.',
        headers: { authorization: 'Bearer <access_token>' },
        response:
          '{ "request_id": "request-register", "publicKey": { "challenge": "...", "rp": { "id": "auth.example.com", "name": "mini-auth" }, "user": { "id": "<base64url>", "name": "user@example.com", "displayName": "user@example.com" }, "pubKeyCredParams": [{ "type": "public-key", "alg": -7 }, { "type": "public-key", "alg": -257 }], "timeout": 300000, "authenticatorSelection": { "residentKey": "required", "userVerification": "preferred" } } }',
      }),
      makeApiEntry({
        sdkOrigin: resolvedSdkOrigin,
        method: 'POST',
        path: '/webauthn/register/verify',
        when: 'Verify the completed passkey registration ceremony.',
        headers: { authorization: 'Bearer <access_token>' },
        body: {
          request_id: 'request-register',
          credential: '<PublicKeyCredential>',
        },
        response: '{ "ok": true, "user": { "email": "user@example.com" } }',
      }),
      makeApiEntry({
        sdkOrigin: resolvedSdkOrigin,
        method: 'POST',
        path: '/webauthn/authenticate/options',
        when: 'Request authentication options for username-less passkey sign-in.',
        response:
          '{ "request_id": "request-authenticate", "publicKey": { "challenge": "...", "rpId": "auth.example.com", "timeout": 300000, "userVerification": "preferred" } }',
      }),
      makeApiEntry({
        sdkOrigin: resolvedSdkOrigin,
        method: 'POST',
        path: '/webauthn/authenticate/verify',
        when: 'Verify the passkey assertion and create a session.',
        body: {
          request_id: 'request-authenticate',
          credential: '<PublicKeyCredential>',
        },
        response:
          '{ "access_token": "<jwt>", "token_type": "Bearer", "expires_in": 3600, "refresh_token": "<refresh-token>" }',
      }),
      makeApiEntry({
        sdkOrigin: resolvedSdkOrigin,
        method: 'DELETE',
        path: '/webauthn/credentials/cred_123',
        when: 'Delete a saved passkey credential for the signed-in user.',
        headers: { authorization: 'Bearer <access_token>' },
        response: '{ "ok": true }',
      }),
      makeApiEntry({
        sdkOrigin: resolvedSdkOrigin,
        method: 'GET',
        path: '/jwks',
        when: 'Publish the JWKS used to verify JWT signatures.',
        response: '{ "keys": [{ "kid": "...", "kty": "EC" }] }',
      }),
    ],
    backendNotes: [
      `Validate iss on every backend token check against ${resolvedIssuer}.`,
      'Validate aud whenever your backend uses audience boundaries between services.',
      'Use GET /me for frontend user-state hydration, not as the backend per-request auth path.',
      `Cache the remote JWKS from ${resolvedJwksUrl} and keep backend verifier config aligned with your issuer.`,
    ],
    backendNotesDisclosureLabel: 'More backend JWT notes',
    deploymentNotes: [
      'For GitHub Pages, publish the contents of demo/ so index.html stays at the final page URL and its relative ./style.css + ./main.js assets keep working on project subpaths.',
      `After publish, start mini-auth with --origin ${currentOrigin} (or whatever final page origin you actually deployed) because --origin must match the browser page origin, not the auth server origin.`,
      'If docs and auth live on different origins, keep the page URL on the docs host and append ?sdk-origin=https://your-auth-origin so the browser loads the SDK from the auth host.',
      'If you use a custom GitHub Pages domain, publish a matching CNAME file and keep that domain stable; change mini-auth --origin whenever the docs URL path/domain changes enough to alter window.location.origin.',
    ],
    knownIssues: [
      'Passkeys depend on a valid RP ID and a browser environment that supports WebAuthn.',
      'Cross-origin pages must start mini-auth with --origin set to the page origin before browser calls will succeed.',
      'Multiple tabs can currently race during session refresh. This is a known SDK bug, not a product contract.',
    ],
  };
}

function makeApiEntry({
  body,
  headers,
  method,
  path,
  response,
  sdkOrigin,
  when,
}) {
  return {
    method,
    path,
    when,
    detailsLabel: API_DETAILS_LABEL,
    request: buildRequestSnippet({ body, headers, method, path, sdkOrigin }),
    response,
  };
}

function buildRequestSnippet({ body, headers = {}, method, path, sdkOrigin }) {
  const url = `${sdkOrigin}${path}`;
  const requestHeaders = { ...headers };

  if (method === 'GET' || method === 'DELETE') {
    const lines = [`fetch('${url}', {`, `  method: '${method}',`];

    if (Object.keys(requestHeaders).length > 0) {
      lines.push(
        `  headers: ${JSON.stringify(requestHeaders, null, 2).replaceAll('\n', '\n  ')},`,
      );
    }

    lines.push('})');

    return lines.join('\n');
  }

  if (body !== undefined) {
    requestHeaders['content-type'] = 'application/json';
  }

  const lines = [`fetch('${url}', {`, `  method: '${method}',`];

  if (Object.keys(requestHeaders).length > 0) {
    lines.push(
      `  headers: ${JSON.stringify(requestHeaders, null, 2).replaceAll('\n', '\n  ')},`,
    );
  }

  if (body !== undefined) {
    lines.push(`  body: JSON.stringify(${JSON.stringify(body, null, 2)}),`);
  }

  lines.push('})');

  return lines.join('\n');
}
