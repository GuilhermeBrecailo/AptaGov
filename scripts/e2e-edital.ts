import { readFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { loadEnv } from '../src/config/env';
import { companyProfileSchema, emptyCompanyProfile, type CompanyProfile } from '../src/domain/companyProfile';
import { fitToBudget, parsePncpId, PncpDocumentClient, selectDocuments } from '../src/services/edital/pncpDocuments';
import { ClaudeEditalExtractor, estimateCostUsdMicros } from '../src/services/edital/claudeExtractor';
import { compareRequirements } from '../src/services/edital/compareRequirements';

// Uso: npm run e2e:edital -- <pncp_id> [perfil.json]
// ATENCAO: chama a API real da Anthropic e GERA CUSTO. Nao grava em banco algum.
const env = loadEnv();
const [pncpId, profilePath] = process.argv.slice(2);

function fail(message: string): never {
  console.error(`E2E edital: ${message}`);
  process.exit(1);
}

if (!env.anthropicApiKey) fail('ANTHROPIC_API_KEY está vazia. Este script chama a API real e gera custo; defina a chave no .env e rode de novo.');
if (!pncpId || !parsePncpId(pncpId)) fail('informe o pncp_id no formato 00000000000000-1-000000/2026. Uso: npm run e2e:edital -- <pncp_id> [perfil.json]');

let profile: CompanyProfile = emptyCompanyProfile();
if (profilePath) {
  try {
    profile = companyProfileSchema.parse(JSON.parse(readFileSync(profilePath, 'utf8')));
  } catch (error) {
    fail(`perfil inválido em ${profilePath}: ${error instanceof Error ? error.message : 'erro desconhecido'}`);
  }
}

try {
  const documents = new PncpDocumentClient();
  const { selected } = selectDocuments(await documents.list(pncpId));
  const supported = selected.filter((doc) => doc.supported);
  if (supported.length === 0) fail('nenhum edital/termo de referência em PDF encontrado no PNCP.');
  const downloaded = await Promise.all(supported.map(async (doc) => ({ ...doc, data: await documents.download(doc.url) })));
  const { included, partial } = fitToBudget(downloaded.map((doc) => ({ ...doc, bytes: doc.data.length })));
  console.log(`Documentos: ${included.map((doc) => `${doc.kind} (${(doc.bytes / 1024).toFixed(0)} KB)`).join(', ')}${partial ? ' [parcial]' : ''}`);

  const extractor = new ClaudeEditalExtractor({ client: new Anthropic({ apiKey: env.anthropicApiKey }), model: env.editalAnalysisModel });
  const result = await extractor.extract({
    documents: included.map((doc) => ({ kind: doc.kind, title: doc.title, data: doc.data })),
    profile
  });
  const verdicts = compareRequirements({ extraction: result.extraction, profile, opportunityEstimatedValueCents: 0, now: new Date() });

  for (const lot of verdicts) {
    console.log(`\nLote ${lot.lotId ?? '(único)'}: ${lot.verdict} (${lot.failCount} falhas, ${lot.checkCount} a conferir)`);
    for (const check of lot.checks) console.log(`  [${check.status}] ${check.description} — exigido: ${check.required}${check.note ? ` | ${check.note}` : ''}`);
  }
  const cost = estimateCostUsdMicros(result.model, result.inputTokens, result.outputTokens) / 1_000_000;
  console.log(`\nModelo: ${result.model} | tokens: ${result.inputTokens} entrada, ${result.outputTokens} saída | custo estimado: US$ ${cost.toFixed(4)}`);
} catch (error) {
  fail(error instanceof Error ? error.message : 'erro desconhecido');
}
