import type { ChecklistItem, ChecklistItemInput, ChecklistPatch } from '../domain/operationalTypes';
import { ChecklistRepository } from '../repositories/checklistRepository';

const DEFAULT_CHECKLIST_ITEMS: Array<Pick<ChecklistItemInput, 'title' | 'category'>> = [
  { title: 'ler edital', category: 'DOCUMENTS' },
  { title: 'conferir objeto e requisitos', category: 'DOCUMENTS' },
  { title: 'separar documentos', category: 'DOCUMENTS' },
  { title: 'validar certidões', category: 'DOCUMENTS' },
  { title: 'validar preço e margem', category: 'COMMERCIAL' },
  { title: 'montar proposta', category: 'PROPOSAL' },
  { title: 'revisar proposta', category: 'PROPOSAL' },
  { title: 'enviar proposta', category: 'PROPOSAL' },
  { title: 'preparar sessão', category: 'SESSION' },
  { title: 'acompanhar resultado', category: 'REVIEW' },
];

export class ChecklistService {
  constructor(private readonly repository: ChecklistRepository) {}

  ensureDefaults(organizationId: number, opportunityId: number): ChecklistItem[] {
    const items = DEFAULT_CHECKLIST_ITEMS.map((item, index) => ({
      organizationId,
      opportunityId,
      title: item.title,
      category: item.category,
      position: index,
    }));
    this.repository.ensureDefaults(items);
    return this.repository.list(organizationId, opportunityId);
  }

  list(organizationId: number, opportunityId: number): ChecklistItem[] {
    return this.repository.list(organizationId, opportunityId);
  }

  create(input: ChecklistItemInput): ChecklistItem {
    return this.repository.create(input);
  }

  update(organizationId: number, id: number, patch: ChecklistPatch): ChecklistItem | undefined {
    return this.repository.update(organizationId, id, patch);
  }
}
