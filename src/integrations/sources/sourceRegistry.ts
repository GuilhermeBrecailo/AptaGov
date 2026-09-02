import { OpenDataClient } from '../pncp/OpenDataClient';
import { PncpClient } from '../pncp/PncpClient';
import { BecSpClient, type BecSpClientOptions } from './BecSpClient';
import {
  OpenDataSourceClient,
  PncpSourceClient,
  type OfficialSourceClient,
} from './OfficialSourceClient';

export interface SourceRegistryOptions {
  pncpClient?: ConstructorParameters<typeof PncpClient>[0] & { sourceClient?: never };
  openDataClient?: ConstructorParameters<typeof OpenDataClient>[0] & { sourceClient?: never };
  becSpClient?: BecSpClient;
  becSp?: BecSpClientOptions;
  becSpEnabled?: boolean;
}

export function createSourceRegistry(options: SourceRegistryOptions = {}): OfficialSourceClient[] {
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
  const clients: OfficialSourceClient[] = [
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

export const sourceRegistry = createSourceRegistry();
