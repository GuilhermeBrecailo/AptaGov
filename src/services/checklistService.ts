import type { ChecklistItem, ChecklistItemInput, ChecklistPatch, ChecklistTemplateKey } from '../domain/operationalTypes';
import { ChecklistRepository } from '../repositories/checklistRepository';

const DEFAULT_CHECKLIST_ITEMS: Array<Pick<ChecklistItemInput, 'templateKey' | 'title' | 'category'>> = [
  { templateKey: 'read_edital', title: 'ler edital', category: 'DOCUMENTS' },
  { templateKey: 'requirements', title: 'conferir objeto e requisitos', category: 'DOCUMENTS' },
  { templateKey: 'documents', title: 'separar documentos', category: 'DOCUMENTS' },
  { templateKey: 'certificates', title: 'validar certidões', category: 'DOCUMENTS' },
  { templateKey: 'pricing_margin', title: 'validar preço e margem', category: 'COMMERCIAL' },
  { templateKey: 'proposal', title: 'montar proposta', category: 'PROPOSAL' },
  { templateKey: 'review', title: 'revisar proposta', category: 'PROPOSAL' },
  { templateKey: 'submit', title: 'enviar proposta', category: 'PROPOSAL' },
  { templateKey: 'session', title: 'preparar sessão', category: 'SESSION' },
  { templateKey: 'result', title: 'acompanhar resultado', category: 'REVIEW' },
];

export class ChecklistService {
  constructor(private readonly repository: ChecklistRepository) {}

  ensureDefaults(organizationId: number, opportunityId: number): ChecklistItem[] {
    const items = DEFAULT_CHECKLIST_ITEMS.map((item, index) => ({
      organizationId,
      opportunityId,
      templateKey: item.templateKey,
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
