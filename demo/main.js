import { bootstrapDemoPage } from './bootstrap.js';

const STORAGE_KEY = 'mini-auth-demo-inputs';
const DEFAULT_LATEST_ACTION = 'No request yet.';
const DEFAULT_LATEST_RESULT = 'No response yet.';
const DEFAULT_SDK_URL = 'http://127.0.0.1:7777/sdk/singleton-iife.js';
const BROWSER_PASSKEY_WARNING =
  'This browser does not support WebAuthn / passkeys.';

export function renderContentState(root, setupState, content) {
  setText(root, '#hero-title', content.hero?.title || '');
  setText(root, '#hero-value-prop', content.hero?.valueProp || '');
  setText(root, '#hero-audience', content.hero?.audience || '');
  setList(root, '#hero-capabilities', content.hero?.capabilities || []);
  setText(root, '#page-origin', setupState.currentOrigin || '');
  setText(root, '#page-rp-id', setupState.suggestedRpId || '');
  setText(root, '#origin-command', content.startupCommand || '');
  setText(root, '#sdk-script-snippet', content.sdkScriptTag || '');
  setText(root, '#jose-snippet', content.joseSnippet || '');
  setText(root, '#setup-warning', setupState.corsWarning || '');
  setList(root, '#how-it-works-list', content.howItWorks || []);
  setList(root, '#backend-notes-list', content.backendNotes || []);
  setList(root, '#deployment-notes-list', content.deploymentNotes || []);
  setList(root, '#known-issues-list', content.knownIssues || []);
  setBackendDisclosureSummary(root, content.backendNotesDisclosureLabel || '');

  const configError = query(root, '#config-error');
  if (configError) {
    configError.textContent = setupState.configError || '';
    configError.hidden = !setupState.configError;
  }

  if (setupState.passkeyWarning) {
    setText(root, '#register-output', setupState.passkeyWarning);
    setText(root, '#authenticate-output', setupState.passkeyWarning);
  }
}

export function renderApiReference(root, apiReference) {
  const container = query(root, '#api-reference-list');

  if (!container) {
    return;
  }

  replaceChildren(
    container,
    apiReference.map((entry) => {
      const article = createElementFor(root, 'article');
      const title = createElementFor(root, 'h3');
      const when = createElementFor(root, 'p');
      const details = createElementFor(root, 'details');
      const summary = createElementFor(root, 'summary');
      const request = createElementFor(root, 'pre');
      const response = createElementFor(root, 'pre');

      title.textContent = `${entry.method} ${entry.path}`;
      when.textContent = entry.when;
      summary.textContent = entry.detailsLabel;
      request.textContent = entry.request;
      response.textContent = entry.response;

      appendChildren(details, [summary, request, response]);
      appendChildren(article, [title, when, details]);
      return article;
    }),
  );
}

export function disableFlowButtons(root) {
  for (const selector of [
    '#email-start-button',
    '#email-verify-button',
    '#register-button',
    '#authenticate-button',
    '#clear-state-button',
  ]) {
    const element = query(root, selector);
    if (element) {
      element.disabled = true;
    }
  }
}

function enableFlowButtons(root) {
  for (const selector of [
    '#email-start-button',
    '#email-verify-button',
    '#register-button',
    '#authenticate-button',
    '#clear-state-button',
  ]) {
    const element = query(root, selector);
    if (element) {
      element.disabled = false;
    }
  }
}

export async function loadSdkScript(
  setupState,
  { document = globalThis.document } = {},
) {
  const script = document.createElement('script');
  script.src = setupState.sdkScriptUrl;
  script.dataset.miniAuthSdk = 'true';

  const loaded = waitForScript(script);
  if (typeof document.body.appendChild === 'function') {
    document.body.appendChild(script);
  } else {
    document.body.append(script);
  }

  await loaded;
}

export function createDemoRuntime({
  root,
  setupState,
  history,
  localStorage,
  location,
  windowObject,
}) {
  const elements = getElements(root);
  const sectionViews = getSectionViews(elements);
  const state = {
    email: '',
    latestAction: DEFAULT_LATEST_ACTION,
    latestResult: DEFAULT_LATEST_RESULT,
  };
  let sdk = null;
  let sdkInteractive = false;

  return {
    hydrateState() {
      const saved = parseJsonSafe(localStorage?.getItem(STORAGE_KEY) || '');

      if (saved && typeof saved === 'object') {
        state.email = typeof saved.email === 'string' ? saved.email : '';
      }

      if (elements.baseUrl) {
        elements.baseUrl.value = setupState.sdkScriptUrl || DEFAULT_SDK_URL;
      }

      if (elements.email) {
        elements.email.value = state.email;
      }
    },

    wireEvents() {
      disableFlowButtons(root);

      elements.email?.addEventListener('input', () => {
        state.email = elements.email.value.trim();
        persistState(localStorage, state.email);
      });

      elements.sdkOriginInput?.addEventListener('change', () => {
        handleSdkOriginChange({
          history,
          location,
          value: elements.sdkOriginInput.value,
          windowObject,
        });
      });

      elements.emailStartButton?.addEventListener('click', () =>
        handleEmailStart({
          elements,
          renderState,
          sdk,
          sdkInteractive,
          sectionViews,
          state,
          localStorage,
        }),
      );
      elements.emailVerifyButton?.addEventListener('click', () =>
        handleEmailVerify({
          elements,
          renderState,
          sdk,
          sdkInteractive,
          sectionViews,
          state,
          localStorage,
        }),
      );
      elements.registerButton?.addEventListener('click', () =>
        handleRegisterPasskey({
          renderState,
          sdk,
          sdkInteractive,
          sectionViews,
          state,
        }),
      );
      elements.authenticateButton?.addEventListener('click', () =>
        handleAuthenticatePasskey({
          renderState,
          sdk,
          sdkInteractive,
          sectionViews,
          state,
        }),
      );
      elements.clearStateButton?.addEventListener('click', () =>
        clearState({
          elements,
          renderState,
          sdk,
          sdkInteractive,
          sectionViews,
          state,
          localStorage,
        }),
      );
    },

    attachSdk(nextSdk) {
      sdk = nextSdk || null;
      sdkInteractive = false;

      if (sdk?.session?.onChange) {
        sdk.session.onChange(() => renderState());
      }
    },

    async completeStartup() {
      if (!sdk) {
        this.handleSdkLoadFailure(new Error('SDK global was not initialized.'));
        return;
      }

      renderState();

      try {
        await sdk.ready;
        sdkInteractive = true;
        enableFlowButtons(root);
        renderState();
      } catch (error) {
        state.latestAction = 'SDK startup recovery';
        state.latestResult = formatError(error);
        sdkInteractive = false;
        disableFlowButtons(root);
        renderState();
        return;
      }

      const passkeyBlockReason = getPasskeyBlockReason(
        setupState,
        windowObject,
      );
      if (passkeyBlockReason) {
        setSectionResult(sectionViews, 'register', 'error', passkeyBlockReason);
        setSectionResult(
          sectionViews,
          'authenticate',
          'error',
          passkeyBlockReason,
        );
        if (elements.registerButton) {
          elements.registerButton.disabled = true;
        }
        if (elements.authenticateButton) {
          elements.authenticateButton.disabled = true;
        }
      }
    },

    handleConfigError(message) {
      sdkInteractive = false;
      state.latestAction = 'Runtime blocked';
      state.latestResult = message;
      if (elements.statusConfig) {
        elements.statusConfig.textContent = 'Config error';
      }
      disableFlowButtons(root);
      renderState();
    },

    handleSdkLoadFailure(error) {
      sdkInteractive = false;
      state.latestAction = 'SDK bootstrap';
      state.latestResult = `MiniAuth SDK did not load: ${formatError(error)}`;
      if (elements.statusConfig) {
        elements.statusConfig.textContent = 'SDK missing';
      }
      disableFlowButtons(root);
      renderState();
    },

    renderState,
  };

  function renderState() {
    const snapshot = sdk?.session?.getState?.();

    if (elements.accessToken) {
      elements.accessToken.value = snapshot?.accessToken || '';
    }
    if (elements.refreshToken) {
      elements.refreshToken.value = snapshot?.refreshToken || '';
    }
    if (elements.requestId) {
      elements.requestId.value = snapshot?.status || 'sdk-unavailable';
    }
    if (elements.latestRequest) {
      elements.latestRequest.textContent = state.latestAction;
    }
    if (elements.latestResponse) {
      elements.latestResponse.textContent = state.latestResult;
    }
    if (elements.statusConfig) {
      elements.statusConfig.textContent =
        snapshot?.status || elements.statusConfig.textContent || 'Ready';
    }
  }
}

function getElements(root) {
  return {
    baseUrl: query(root, '#base-url'),
    sdkOriginInput: query(root, '#sdk-origin-input'),
    email: query(root, '#email'),
    otpCode: query(root, '#otp-code'),
    accessToken: query(root, '#access-token'),
    refreshToken: query(root, '#refresh-token'),
    requestId: query(root, '#request-id'),
    latestRequest: query(root, '#latest-request'),
    latestResponse: query(root, '#latest-response'),
    emailStartOutput: query(root, '#email-start-output'),
    emailVerifyOutput: query(root, '#email-verify-output'),
    registerOutput: query(root, '#register-output'),
    authenticateOutput: query(root, '#authenticate-output'),
    emailStartButton: query(root, '#email-start-button'),
    emailVerifyButton: query(root, '#email-verify-button'),
    registerButton: query(root, '#register-button'),
    authenticateButton: query(root, '#authenticate-button'),
    clearStateButton: query(root, '#clear-state-button'),
    statusConfig: query(root, '#status-config'),
    statusEmailStart: query(root, '#status-email-start'),
    statusEmailVerify: query(root, '#status-email-verify'),
    statusRegister: query(root, '#status-register'),
    statusAuthenticate: query(root, '#status-authenticate'),
  };
}

function getSectionViews(elements) {
  return {
    'email-start': {
      output: elements.emailStartOutput,
      pill: elements.statusEmailStart,
    },
    'email-verify': {
      output: elements.emailVerifyOutput,
      pill: elements.statusEmailVerify,
    },
    register: {
      output: elements.registerOutput,
      pill: elements.statusRegister,
    },
    authenticate: {
      output: elements.authenticateOutput,
      pill: elements.statusAuthenticate,
    },
  };
}

async function handleEmailStart({
  elements,
  renderState,
  sdk,
  sdkInteractive,
  sectionViews,
  state,
  localStorage,
}) {
  if (!sdk || !sdkInteractive) {
    renderMissingSdkState({ renderState, state });
    return;
  }

  const email = elements.email?.value.trim() || '';

  if (!email) {
    setSectionResult(
      sectionViews,
      'email-start',
      'error',
      'Email is required.',
    );
    return;
  }

  state.email = email;
  persistState(localStorage, state.email);
  state.latestAction = 'MiniAuth.email.start()';
  setSectionLoading(sectionViews, 'email-start', 'Sending OTP...');
  renderState();

  try {
    const result = await sdk.email.start({ email });
    state.latestResult = formatValue(result);
    setSectionResult(
      sectionViews,
      'email-start',
      'success',
      formatValue(result),
    );
    renderState();
  } catch (error) {
    state.latestResult = formatError(error);
    setSectionResult(sectionViews, 'email-start', 'error', formatError(error));
    renderState();
  }
}

async function handleEmailVerify({
  elements,
  renderState,
  sdk,
  sdkInteractive,
  sectionViews,
  state,
  localStorage,
}) {
  if (!sdk || !sdkInteractive) {
    renderMissingSdkState({ renderState, state });
    return;
  }

  const email = elements.email?.value.trim() || '';
  const code = elements.otpCode?.value.trim() || '';

  if (!email || !code) {
    setSectionResult(
      sectionViews,
      'email-verify',
      'error',
      'Email and OTP code are required.',
    );
    return;
  }

  state.email = email;
  persistState(localStorage, state.email);
  state.latestAction = 'MiniAuth.email.verify()';
  setSectionLoading(sectionViews, 'email-verify', 'Verifying OTP...');
  renderState();

  try {
    const session = await sdk.email.verify({ email, code });
    const result = formatValue({ session, me: sdk.me.get() });
    state.latestResult = result;
    setSectionResult(sectionViews, 'email-verify', 'success', result);
    renderState();
  } catch (error) {
    state.latestResult = formatError(error);
    setSectionResult(sectionViews, 'email-verify', 'error', formatError(error));
    renderState();
  }
}

async function handleRegisterPasskey({
  renderState,
  sdk,
  sdkInteractive,
  sectionViews,
  state,
}) {
  if (!sdk || !sdkInteractive) {
    renderMissingSdkState({ renderState, state });
    return;
  }

  state.latestAction = 'MiniAuth.webauthn.register()';
  setSectionLoading(sectionViews, 'register', 'Creating passkey...');
  renderState();

  try {
    const verify = await sdk.webauthn.register();
    const me = await sdk.me.reload();
    const result = formatValue({ verify, me });
    state.latestResult = result;
    setSectionResult(sectionViews, 'register', 'success', result);
    renderState();
  } catch (error) {
    state.latestResult = formatError(error);
    setSectionResult(sectionViews, 'register', 'error', formatError(error));
    renderState();
  }
}

async function handleAuthenticatePasskey({
  renderState,
  sdk,
  sdkInteractive,
  sectionViews,
  state,
}) {
  if (!sdk || !sdkInteractive) {
    renderMissingSdkState({ renderState, state });
    return;
  }

  state.latestAction = 'MiniAuth.webauthn.authenticate()';
  setSectionLoading(sectionViews, 'authenticate', 'Signing in with passkey...');
  renderState();

  try {
    const session = await sdk.webauthn.authenticate();
    const result = formatValue({ session, me: sdk.me.get() });
    state.latestResult = result;
    setSectionResult(sectionViews, 'authenticate', 'success', result);
    renderState();
  } catch (error) {
    state.latestResult = formatError(error);
    setSectionResult(sectionViews, 'authenticate', 'error', formatError(error));
    renderState();
  }
}

async function clearState({
  elements,
  renderState,
  sdk,
  sdkInteractive,
  sectionViews,
  state,
  localStorage,
}) {
  if (!sdk || !sdkInteractive) {
    state.latestAction = 'MiniAuth.session.logout()';
    state.latestResult = 'MiniAuth SDK is not ready yet.';
    renderState();
    return;
  }

  let logoutError = null;

  try {
    await sdk?.session?.logout?.();
  } catch (error) {
    logoutError = error;
  }

  state.email = '';
  state.latestAction = 'MiniAuth.session.logout()';
  state.latestResult = logoutError
    ? `Local demo state cleared. SDK logout failed: ${formatError(logoutError)}`
    : 'Local demo state cleared.';
  persistState(localStorage, '');

  for (const input of [
    elements.email,
    elements.otpCode,
    elements.accessToken,
    elements.refreshToken,
  ]) {
    if (input) {
      input.value = '';
    }
  }
  if (elements.requestId) {
    elements.requestId.value = logoutError ? 'logout-failed' : 'anonymous';
  }
  if (elements.statusConfig) {
    elements.statusConfig.textContent = logoutError
      ? 'Logout failed'
      : 'anonymous';
  }

  for (const name of Object.keys(sectionViews)) {
    setSectionResult(sectionViews, name, 'idle', DEFAULT_LATEST_ACTION);
  }

  renderState();
}

function handleSdkOriginChange({ history, location, value, windowObject }) {
  const params = new URLSearchParams(location.search);
  params.set('sdk-origin', value.trim());
  const search = params.toString();
  history.replaceState(
    {},
    '',
    `${location.pathname}${search ? `?${search}` : ''}${location.hash}`,
  );
  windowObject.location.reload();
}

function setSectionLoading(sectionViews, name, message) {
  const view = sectionViews[name];
  setPillState(view?.pill, 'Loading', 'loading');
  if (view?.output) {
    view.output.textContent = message;
  }
}

function setSectionResult(sectionViews, name, stateName, message) {
  const view = sectionViews[name];
  const label =
    stateName === 'success'
      ? 'Success'
      : stateName === 'error'
        ? 'Error'
        : 'Idle';
  setPillState(view?.pill, label, stateName === 'idle' ? '' : stateName);
  if (view?.output) {
    view.output.textContent = message;
  }
}

function setPillState(element, label, className) {
  if (!element) {
    return;
  }

  element.textContent = label;
  element.classList?.remove?.('loading', 'error', 'success');
  if (className) {
    element.classList?.add?.(className);
  }
}

function persistState(localStorage, email) {
  localStorage?.setItem(
    STORAGE_KEY,
    JSON.stringify({
      email,
    }),
  );
}

function getPasskeyBlockReason(setupState, windowObject) {
  if (setupState.passkeyWarning) {
    return setupState.passkeyWarning;
  }

  if (!windowObject.PublicKeyCredential) {
    return BROWSER_PASSKEY_WARNING;
  }

  return '';
}

function waitForScript(script) {
  return new Promise((resolve, reject) => {
    script.addEventListener('load', () => resolve(script), { once: true });
    script.addEventListener(
      'error',
      () => reject(new Error(`Failed to load ${script.src}`)),
      { once: true },
    );
  });
}

function setList(root, selector, items) {
  const element = query(root, selector);
  if (!element) {
    return;
  }

  replaceChildren(
    element,
    items.map((item) => {
      const listItem = createElementFor(root, 'li');
      listItem.textContent = item;
      return listItem;
    }),
  );
}

function replaceChildren(element, children) {
  if (typeof element.replaceChildren === 'function') {
    element.replaceChildren(...children);
    return;
  }

  element.children = [];
  element.innerHTML = '';
  appendChildren(element, children);
}

function appendChildren(element, children) {
  if (typeof element.append === 'function') {
    element.append(...children);
    return;
  }

  for (const child of children) {
    element.appendChild?.(child);
  }
}

function createElementFor(root, tagName) {
  if (typeof root.createElement === 'function') {
    return root.createElement(tagName);
  }

  if (typeof globalThis.document?.createElement === 'function') {
    return globalThis.document.createElement(tagName);
  }

  return {
    tagName: tagName.toUpperCase(),
    textContent: '',
    children: [],
    append(...nodes) {
      this.children.push(...nodes);
    },
    appendChild(node) {
      this.children.push(node);
      return node;
    },
    replaceChildren(...nodes) {
      this.children = [...nodes];
    },
  };
}

function setText(root, selector, value) {
  const element = query(root, selector);
  if (element) {
    element.textContent = value;
  }
}

function setBackendDisclosureSummary(root, value) {
  const disclosure = query(root, '#backend-notes-disclosure');
  const summary =
    disclosure?.querySelector?.('summary') ||
    disclosure?.children?.find?.(
      (child) => child.tagName?.toLowerCase?.() === 'summary',
    ) ||
    query(root, '#backend-notes-disclosure summary') ||
    query(root, '#backend-notes-disclosure-summary');

  if (summary) {
    summary.textContent = value;
  }
}

function query(root, selector) {
  return root?.querySelector?.(selector) ?? null;
}

function parseJsonSafe(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function renderMissingSdkState({ renderState, state }) {
  state.latestAction = 'SDK bootstrap';
  state.latestResult = 'MiniAuth SDK is not ready yet.';
  renderState();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const hooks =
    window.__MINI_AUTH_TEST_HOOKS__ ||
    globalThis.__MINI_AUTH_TEST_HOOKS__ ||
    {};
  void bootstrapDemoPage({ loadSdkScript: hooks.loadSdkScript }).catch(
    () => {},
  );
}
