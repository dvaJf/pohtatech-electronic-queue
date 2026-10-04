export interface ForceConfirmEnvironment {
  explicitFlag?: string;
  mode?: string;
  isDev?: boolean;
}

export function isForceConfirmVisible(environment: ForceConfirmEnvironment): boolean {
  const nonProduction = environment.mode === 'test' || environment.mode === 'development' || Boolean(environment.isDev);
  return nonProduction && environment.explicitFlag === 'true';
}
