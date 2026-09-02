import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('contrato visual operacional', () => {
  it('expõe a agenda em português com ações de lembrete e sem texto fora do escopo', () => {
    expect(existsSync('app/pages/agenda.vue')).toBe(true);
    expect(existsSync('app/components/AgendaView.vue')).toBe(true);
    expect(existsSync('app/components/OpportunityChecklist.vue')).toBe(true);
    expect(existsSync('app/components/ChecklistItemEditor.vue')).toBe(true);
    expect(existsSync('app/viewModels/operationalViewModels.ts')).toBe(true);
    expect(existsSync('server/api/opportunities/[id]/checklist.get.ts')).toBe(true);
    expect(existsSync('server/api/opportunities/[id]/checklist/[itemId].patch.ts')).toBe(true);
    expect(existsSync('server/api/opportunities/changes.get.ts')).toBe(true);

    const agendaPage = readFileSync('app/pages/agenda.vue', 'utf8');
    const agendaView = readFileSync('app/components/AgendaView.vue', 'utf8');
    const checklist = readFileSync('app/components/OpportunityChecklist.vue', 'utf8');
    const editor = readFileSync('app/components/ChecklistItemEditor.vue', 'utf8');
    const details = readFileSync('app/components/OpportunityDetails.vue', 'utf8');
    const kanban = readFileSync('app/components/OpportunityKanban.vue', 'utf8');
    const home = readFileSync('app/pages/index.vue', 'utf8');
    const viewModels = readFileSync('app/viewModels/operationalViewModels.ts', 'utf8');

    expect(agendaPage).toContain('/api/agenda');
    expect(agendaPage).toContain('/api/agenda-preferences');
    expect(agendaPage).toContain('/api/opportunities/changes');
    expect(agendaPage).toContain('Agenda operacional');
    expect(agendaView).toContain('Agenda');
    expect(agendaView).toContain('Visão mensal');
    expect(agendaView).toContain('Visão em lista');
    expect(agendaView).toContain('Criar lembrete');
    expect(agendaView).toContain('Concluir');
    expect(agendaView).toContain('Pular');
    expect(agendaView).toContain('Editar lembrete');
    expect(agendaView).toContain('Prazo oficial');
    expect(agendaView).toContain('Sessão pública');
    expect(agendaView).toContain('Início da disputa');
    expect(agendaView).toContain('Resultado oficial');
    expect(agendaView).toContain('Lembrete manual');
    expect(agendaView).not.toContain('Telegram');
    expect(agendaView).not.toContain('WhatsApp');
    expect(agendaView).not.toContain('IA');
    expect(checklist).toContain('Preparação');
    expect(checklist).toContain('Progresso');
    expect(checklist).toContain('Concluir item');
    expect(checklist).toContain('Sem responsável');
    expect(editor).toContain('Salvar alterações');
    expect(editor).toContain('Responsável');
    expect(editor).toContain('Prazo');
    expect(details).toContain('OpportunityChecklist');
    expect(kanban).toContain('OpportunityChecklist');
    expect(home).toContain("opportunity: route.query.opportunity");
    expect(home).toContain('opportunityId');
    expect(viewModels).toContain('buildChecklistPresentation');
  });
});
