const storageKey = 'mini-auth-demo-state'

const state = {
  baseUrl: '/api',
  email: '',
  accessToken: '',
  refreshToken: '',
  requestId: '',
  latestRequest: null,
  latestResponse: null
}

const elements = {
  baseUrl: document.querySelector('#base-url'),
  email: document.querySelector('#email'),
  otpCode: document.querySelector('#otp-code'),
  accessToken: document.querySelector('#access-token'),
  refreshToken: document.querySelector('#refresh-token'),
  requestId: document.querySelector('#request-id'),
  latestRequest: document.querySelector('#latest-request'),
  latestResponse: document.querySelector('#latest-response'),
  pageOrigin: document.querySelector('#page-origin'),
  pageRpId: document.querySelector('#page-rp-id'),
  proxyCommand: document.querySelector('#proxy-command'),
  originCommand: document.querySelector('#origin-command'),
  emailStartOutput: document.querySelector('#email-start-output'),
  emailVerifyOutput: document.querySelector('#email-verify-output'),
  registerOutput: document.querySelector('#register-output'),
  authenticateOutput: document.querySelector('#authenticate-output'),
  emailStartButton: document.querySelector('#email-start-button'),
  emailVerifyButton: document.querySelector('#email-verify-button'),
  registerButton: document.querySelector('#register-button'),
  authenticateButton: document.querySelector('#authenticate-button'),
  clearStateButton: document.querySelector('#clear-state-button'),
  statusConfig: document.querySelector('#status-config'),
  statusEmailStart: document.querySelector('#status-email-start'),
  statusEmailVerify: document.querySelector('#status-email-verify'),
  statusRegister: document.querySelector('#status-register'),
  statusAuthenticate: document.querySelector('#status-authenticate')
}

const sectionViews = {
  'email-start': {
    output: elements.emailStartOutput,
    pill: elements.statusEmailStart
  },
  'email-verify': {
    output: elements.emailVerifyOutput,
    pill: elements.statusEmailVerify
  },
  register: {
    output: elements.registerOutput,
    pill: elements.statusRegister
  },
  authenticate: {
    output: elements.authenticateOutput,
    pill: elements.statusAuthenticate
  }
}

initialize()

function initialize() {
  hydrateState()
  renderSetupHints()
  renderState()
  wireEvents()

  if (!window.PublicKeyCredential) {
    setSectionResult(
      'register',
      'error',
      'This browser does not support WebAuthn / passkeys.'
    )
    setSectionResult(
      'authenticate',
      'error',
      'This browser does not support WebAuthn / passkeys.'
    )
    elements.registerButton.disabled = true
    elements.authenticateButton.disabled = true
  }
}

function wireEvents() {
  elements.baseUrl.addEventListener('input', () => {
    state.baseUrl = elements.baseUrl.value.trim() || '/api'
    renderState()
    persistState()
  })

  elements.email.addEventListener('input', () => {
    state.email = elements.email.value.trim()
    persistState()
  })

  elements.emailStartButton.addEventListener('click', handleEmailStart)
  elements.emailVerifyButton.addEventListener('click', handleEmailVerify)
  elements.registerButton.addEventListener('click', handleRegisterPasskey)
  elements.authenticateButton.addEventListener(
    'click',
    handleAuthenticatePasskey
  )
  elements.clearStateButton.addEventListener('click', clearState)
}

async function handleEmailStart() {
  const email = elements.email.value.trim()

  if (!email) {
    setSectionResult('email-start', 'error', 'Email is required.')
    return
  }

  state.email = email
  persistState()
  setSectionLoading('email-start', 'Sending OTP...')

  try {
    const data = await requestJson('/email/start', {
      method: 'POST',
      body: { email }
    })

    setSectionResult('email-start', 'success', formatValue(data))
  } catch (error) {
    setSectionResult('email-start', 'error', formatError(error))
  }
}

async function handleEmailVerify() {
  const email = elements.email.value.trim()
  const code = elements.otpCode.value.trim()

  if (!email || !code) {
    setSectionResult(
      'email-verify',
      'error',
      'Email and OTP code are required.'
    )
    return
  }

  state.email = email
  persistState()
  setSectionLoading('email-verify', 'Verifying OTP...')

  try {
    const data = await requestJson('/email/verify', {
      method: 'POST',
      body: { email, code }
    })

    updateSession(data)
    setSectionResult('email-verify', 'success', formatValue(data))
  } catch (error) {
    setSectionResult('email-verify', 'error', formatError(error))
  }
}

async function handleRegisterPasskey() {
  if (!state.accessToken) {
    setSectionResult(
      'register',
      'error',
      'Access token missing. Complete email verify first.'
    )
    return
  }

  setSectionLoading('register', 'Fetching registration options...')

  try {
    const optionsData = await requestJson('/webauthn/register/options', {
      method: 'POST',
      headers: authorizationHeaders()
    })

    state.requestId = optionsData.request_id
    renderState()
    persistState()

    const credential = await navigator.credentials.create({
      publicKey: toCreatePublicKeyOptions(optionsData.publicKey)
    })

    if (!credential) {
      throw new Error('Passkey creation was cancelled.')
    }

    setSectionLoading('register', 'Verifying registration...')

    const data = await requestJson('/webauthn/register/verify', {
      method: 'POST',
      headers: authorizationHeaders(),
      body: {
        request_id: optionsData.request_id,
        credential: serializeCredential(credential)
      }
    })

    setSectionResult(
      'register',
      'success',
      formatValue({
        options: optionsData,
        verify: data
      })
    )
  } catch (error) {
    setSectionResult('register', 'error', formatError(error))
  }
}

async function handleAuthenticatePasskey() {
  setSectionLoading('authenticate', 'Fetching authentication options...')

  try {
    const optionsData = await requestJson('/webauthn/authenticate/options', {
      method: 'POST'
    })

    state.requestId = optionsData.request_id
    renderState()
    persistState()

    const credential = await navigator.credentials.get({
      publicKey: toGetPublicKeyOptions(optionsData.publicKey)
    })

    if (!credential) {
      throw new Error('Passkey sign-in was cancelled.')
    }

    setSectionLoading('authenticate', 'Verifying authentication...')

    const data = await requestJson('/webauthn/authenticate/verify', {
      method: 'POST',
      body: {
        request_id: optionsData.request_id,
        credential: serializeCredential(credential)
      }
    })

    updateSession(data)
    setSectionResult(
      'authenticate',
      'success',
      formatValue({
        options: optionsData,
        verify: data
      })
    )
  } catch (error) {
    setSectionResult('authenticate', 'error', formatError(error))
  }
}

async function requestJson(path, options) {
  const url = new URL(joinUrl(state.baseUrl, path), window.location.href)
  const headers = {
    'content-type': 'application/json',
    ...(options.headers || {})
  }
  const requestInit = {
    method: options.method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  }

  state.latestRequest = {
    method: options.method,
    url: url.toString(),
    headers,
    body: options.body ?? null
  }
  renderState()

  let response

  try {
    response = await fetch(url, requestInit)
  } catch (error) {
    throw new Error(
      `Network request failed. If you are using live-server, confirm the proxy or same-origin setup.\n\n${error instanceof Error ? error.message : String(error)}`
    )
  }

  const rawText = await response.text()
  const parsedBody = parseJsonSafe(rawText)

  state.latestResponse = {
    status: response.status,
    ok: response.ok,
    body: parsedBody ?? rawText
  }
  renderState()

  if (!response.ok) {
    const error = new Error(
      `HTTP ${response.status}\n\n${formatValue(parsedBody ?? rawText)}`
    )
    error.status = response.status
    error.body = parsedBody ?? rawText
    throw error
  }

  return parsedBody ?? rawText
}

function authorizationHeaders() {
  return {
    authorization: `Bearer ${state.accessToken}`
  }
}

function updateSession(tokens) {
  state.accessToken = tokens.access_token || ''
  state.refreshToken = tokens.refresh_token || ''
  renderState()
  persistState()
}

function clearState() {
  state.accessToken = ''
  state.refreshToken = ''
  state.requestId = ''
  state.latestRequest = null
  state.latestResponse = null
  elements.otpCode.value = ''

  for (const view of Object.values(sectionViews)) {
    setPillState(view.pill, 'Idle', '')
    view.output.textContent = 'No request yet.'
  }

  renderState()
  persistState()
}

function hydrateState() {
  const saved = parseJsonSafe(localStorage.getItem(storageKey) || '')

  if (saved && typeof saved === 'object') {
    state.baseUrl = typeof saved.baseUrl === 'string' ? saved.baseUrl : '/api'
    state.email = typeof saved.email === 'string' ? saved.email : ''
    state.accessToken =
      typeof saved.accessToken === 'string' ? saved.accessToken : ''
    state.refreshToken =
      typeof saved.refreshToken === 'string' ? saved.refreshToken : ''
    state.requestId = typeof saved.requestId === 'string' ? saved.requestId : ''
  }

  elements.baseUrl.value = state.baseUrl
  elements.email.value = state.email
}

function persistState() {
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      baseUrl: state.baseUrl,
      email: state.email,
      accessToken: state.accessToken,
      refreshToken: state.refreshToken,
      requestId: state.requestId
    })
  )
}

function renderState() {
  elements.accessToken.value = state.accessToken
  elements.refreshToken.value = state.refreshToken
  elements.requestId.value = state.requestId
  elements.latestRequest.textContent =
    formatValue(state.latestRequest) || 'No request yet.'
  elements.latestResponse.textContent =
    formatValue(state.latestResponse) || 'No response yet.'
  elements.statusConfig.textContent = 'Ready'
}

function renderSetupHints() {
  const origin = window.location.origin
  const rpId = window.location.hostname

  elements.pageOrigin.textContent = origin
  elements.pageRpId.textContent = rpId
  elements.proxyCommand.textContent = `live-server demo --proxy=/api:http://127.0.0.1:7777`
  elements.originCommand.textContent = `mini-auth start ./mini-auth.sqlite --origin ${origin} --rp-id ${rpId}`
}

function setSectionLoading(name, message) {
  const view = sectionViews[name]
  setPillState(view.pill, 'Loading', 'loading')
  view.output.textContent = message
}

function setSectionResult(name, stateName, message) {
  const view = sectionViews[name]
  const label =
    stateName === 'success'
      ? 'Success'
      : stateName === 'error'
        ? 'Error'
        : 'Idle'
  setPillState(view.pill, label, stateName)
  view.output.textContent = message
}

function setPillState(element, label, className) {
  element.textContent = label
  element.classList.remove('loading', 'error', 'success')

  if (className) {
    element.classList.add(className)
  }
}

function toCreatePublicKeyOptions(publicKey) {
  return {
    ...publicKey,
    challenge: base64urlToUint8Array(publicKey.challenge),
    user: {
      ...publicKey.user,
      id: base64urlToUint8Array(publicKey.user.id)
    },
    excludeCredentials: Array.isArray(publicKey.excludeCredentials)
      ? publicKey.excludeCredentials.map((item) => ({
          ...item,
          id: base64urlToUint8Array(item.id)
        }))
      : undefined
  }
}

function toGetPublicKeyOptions(publicKey) {
  return {
    ...publicKey,
    challenge: base64urlToUint8Array(publicKey.challenge),
    allowCredentials: Array.isArray(publicKey.allowCredentials)
      ? publicKey.allowCredentials.map((item) => ({
          ...item,
          id: base64urlToUint8Array(item.id)
        }))
      : undefined
  }
}

function serializeCredential(credential) {
  const response = credential.response
  const serialized = {
    id: credential.id,
    rawId: uint8ArrayToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: uint8ArrayToBase64url(response.clientDataJSON)
    }
  }

  if (typeof response.getTransports === 'function') {
    serialized.response.transports = response.getTransports()
  }

  if ('attestationObject' in response) {
    serialized.response.attestationObject = uint8ArrayToBase64url(
      response.attestationObject
    )
  }

  if ('authenticatorData' in response) {
    serialized.response.authenticatorData = uint8ArrayToBase64url(
      response.authenticatorData
    )
  }

  if ('signature' in response) {
    serialized.response.signature = uint8ArrayToBase64url(response.signature)
  }

  if ('userHandle' in response && response.userHandle) {
    serialized.response.userHandle = uint8ArrayToBase64url(response.userHandle)
  }

  return serialized
}

function base64urlToUint8Array(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const binary = window.atob(padded)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function uint8ArrayToBase64url(buffer) {
  const bytes =
    buffer instanceof ArrayBuffer
      ? new Uint8Array(buffer)
      : new Uint8Array(buffer)
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return window
    .btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function joinUrl(base, path) {
  if (!base) {
    return path
  }

  return `${base.replace(/\/$/, '')}${path}`
}

function parseJsonSafe(value) {
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  return JSON.stringify(value, null, 2)
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
