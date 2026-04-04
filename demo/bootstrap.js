import { buildDemoContent } from './content.js';
import { getDemoSetupState } from './setup.js';
import {
  createDemoRuntime,
  disableFlowButtons,
  loadSdkScript as defaultLoadSdkScript,
  renderApiReference,
  renderContentState,
} from './main.js';

const DEFAULT_SDK_URL = 'http://127.0.0.1:7777/sdk/singleton-iife.js';

export async function bootstrapDemoPage({
  document = globalThis.document,
  history = globalThis.history,
  localStorage = globalThis.localStorage,
  window: windowObject = globalThis.window,
  location = windowObject?.location,
  loadSdkScript = defaultLoadSdkScript,
} = {}) {
  const setupState = getDemoSetupState(
    readLocationInputs({ document, location, windowObject }),
  );
  const content = buildDemoContent(setupState);

  renderContentState(document, setupState, content);
  renderApiReference(document, content.apiReference);

  const runtime = createDemoRuntime({
    root: document,
    setupState,
    history,
    localStorage,
    location,
    windowObject,
  });

  runtime.hydrateState();
  runtime.wireEvents();
  runtime.renderState();

  if (setupState.configError) {
    disableFlowButtons(document);
    runtime.handleConfigError(setupState.configError);
    return;
  }

  try {
    await loadSdkScript(setupState, { document });
    runtime.attachSdk(windowObject.MiniAuth);
    await runtime.completeStartup();
  } catch (error) {
    disableFlowButtons(document);
    runtime.handleSdkLoadFailure(error);
  }
}

function readLocationInputs({ document, location, windowObject }) {
  const resolvedLocation = location || windowObject?.location;
  const url =
    resolvedLocation instanceof URL
      ? resolvedLocation
      : new URL(resolvedLocation.href);
  const sdkOriginInput = url.searchParams.has('sdk-origin')
    ? (url.searchParams.get('sdk-origin') ?? '')
    : undefined;

  return {
    origin: url.origin,
    protocol: url.protocol,
    hostname: url.hostname,
    sdkOriginInput,
    sdkUrl:
      document?.querySelector?.('script[data-mini-auth-sdk]')?.src ||
      windowObject?.__MINI_AUTH_SDK_URL__ ||
      DEFAULT_SDK_URL,
  };
}
