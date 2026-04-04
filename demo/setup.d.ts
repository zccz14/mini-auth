export function getDemoSetupState(locationLike: {
  origin: string;
  protocol: string;
  hostname: string;
  sdkOriginInput?: string;
  sdkUrl?: string;
}): {
  currentOrigin: string;
  suggestedOrigin: string;
  sdkOrigin: string;
  sdkScriptUrl: string;
  issuer: string;
  jwksUrl: string;
  configStatus: string;
  configError: string;
  corsWarning: string;
  startupCommand: string;
};
