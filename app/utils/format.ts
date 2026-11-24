export const BRAZIL_STATES = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA',
  'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
] as const;

const moneyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat('pt-BR');
const DAY_MS = 86_400_000;

export function formatMoney(cents: number): string {
  return moneyFormatter.format(cents / 100);
}

export function formatDate(value: string | null, fallback = 'Sem prazo informado'): string {
  return value ? dateFormatter.format(new Date(value)) : fallback;
}

export type Tone = 'high' | 'mid' | 'low';
export type DeadlineTone = 'urgent' | 'soon' | 'normal' | 'closed';

export function scoreTone(score: number): Tone {
  if (score >= 70) return 'high';
  if (score >= 40) return 'mid';
  return 'low';
}

export function deadlineInfo(value: string | null, now = Date.now()): { label: string; tone: DeadlineTone } | null {
  if (!value) return null;
  const deadline = new Date(value).getTime();
  if (Number.isNaN(deadline)) return null;
  const diff = deadline - now;
  if (diff < 0) return { label: 'Prazo encerrado', tone: 'closed' };
  const days = Math.floor(diff / DAY_MS);
  if (days === 0) return { label: 'Encerra hoje', tone: 'urgent' };
  if (days === 1) return { label: 'Encerra amanhã', tone: 'urgent' };
  if (days <= 3) return { label: `Encerra em ${days} dias`, tone: 'urgent' };
  if (days <= 7) return { label: `Encerra em ${days} dias`, tone: 'soon' };
  return { label: `${days} dias para o prazo`, tone: 'normal' };
}
