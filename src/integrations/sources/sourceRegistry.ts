import { OpenDataClient } from '../pncp/OpenDataClient';
import { PncpClient } from '../pncp/PncpClient';
import { loadEnv, type AppEnv } from '../../config/env';
import { BecSpClient, type BecSpClientOptions } from './BecSpClient';
import {
  OpenDataSourceClient,
  PncpSourceClient,
  type PagedOfficialSourceClient,
} from './OfficialSourceClient';

export interface SourceRegistryOptions {
  pncpClient?: ConstructorParameters<typeof PncpClient>[0] & { sourceClient?: never };
  openDataClient?: ConstructorParameters<typeof OpenDataClient>[0] & { sourceClient?: never };
  becSpClient?: BecSpClient;
  becSp?: BecSpClientOptions;
  becSpEnabled?: boolean;
}

export type SourceRegistryEnvironment = Pick<
  AppEnv,
  'pncpBaseUrl' | 'openDataBaseUrl' | 'pncpTimeoutMs' | 'pncpMaxRetries'
  | 'becSpEnabled' | 'becSpBaseUrl' | 'becSpTimeoutMs' | 'becSpMaxRetries'
>;

export function createSourceRegistry(options: SourceRegistryOptions = {}): PagedOfficialSourceClient[] {
  const pncpClient = new PncpClient(options.pncpClient ?? {
    baseUrl: 'https://pncp.gov.br/api/consulta/v1',
    timeoutMs: 15_000,
    maxRetries: 3,
  });
  const openDataClient = new OpenDataClient(options.openDataClient ?? {
    baseUrl: 'https://dadosabertos.compras.gov.br',
    timeoutMs: 15_000,
    maxRetries: 3,
  });
  const clients: PagedOfficialSourceClient[] = [
    new PncpSourceClient({ sourceClient: pncpClient }),
    new OpenDataSourceClient({ sourceClient: openDataClient }),
  ];
  if (options.becSpEnabled) {
    clients.push(options.becSpClient ?? new BecSpClient({
      timeoutMs: 15_000,
      maxRetries: 3,
      ...options.becSp,
    }));
  }
  return clients;
}

export function createDefaultSourceRegistry(env: SourceRegistryEnvironment = loadEnv()): PagedOfficialSourceClient[] {
  return createSourceRegistry({
    pncpClient: { baseUrl: env.pncpBaseUrl, timeoutMs: env.pncpTimeoutMs, maxRetries: env.pncpMaxRetries },
    openDataClient: { baseUrl: env.openDataBaseUrl, timeoutMs: env.pncpTimeoutMs, maxRetries: env.pncpMaxRetries },
    becSpEnabled: env.becSpEnabled,
    becSp: { baseUrl: env.becSpBaseUrl, timeoutMs: env.becSpTimeoutMs, maxRetries: env.becSpMaxRetries },
  });
}

export const sourceRegistry = createDefaultSourceRegistry();
