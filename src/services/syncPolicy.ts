export type SyncMode = 'automatic' | 'manual';

export function shouldRunSync(mode: SyncMode, hasEnabledOrganization: boolean): boolean {
  return mode === 'manual' || hasEnabledOrganization;
}
