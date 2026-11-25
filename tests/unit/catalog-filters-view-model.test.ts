import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CATALOG_FILTERS, activeFilterChips, countAdvancedFilters, filtersFromQuery, filtersToQuery, removeFilterChip,
  type CatalogFilterState,
} from '../../app/viewModels/catalogFiltersViewModel';

const full: CatalogFilterState = {
  situation: 'suspended',
  modalities: ['Dispensa', 'Pregão'],
  disputeModes: ['Aberto'],
  city: 'Campinas',
  publishedFrom: '2026-11-01',
  publishedTo: '2026-11-30',
  deadlineFrom: '2026-12-01',
  deadlineTo: '2026-12-31',
};

describe('catalogFiltersViewModel', () => {
  it('faz ida e volta entre query e estado', () => {
    const query = filtersToQuery(full);
    expect(query).toEqual({
      situation: 'suspended', modalities: 'Dispensa,Pregão', disputeModes: 'Aberto', city: 'Campinas',
      publishedFrom: '2026-11-01', publishedTo: '2026-11-30', deadlineFrom: '2026-12-01', deadlineTo: '2026-12-31',
    });
    expect(filtersFromQuery(query)).toEqual(full);
  });

  it('omite valores padrão da URL', () => {
    expect(filtersToQuery(DEFAULT_CATALOG_FILTERS)).toEqual({});
    expect(filtersToQuery({ ...DEFAULT_CATALOG_FILTERS, situation: 'all' })).toEqual({ situation: 'all' });
  });

  it('ignora valores inválidos', () => {
    const state = filtersFromQuery({ situation: 'xyz', publishedFrom: '01/11/2026', deadlineTo: '2026-02-31', modalities: ' , ,Dispensa', city: ['a', 'b'] });
    expect(state).toEqual({ ...DEFAULT_CATALOG_FILTERS, modalities: ['Dispensa'] });
    expect(filtersFromQuery({ modalities: ['Dispensa', 'Pregão'] }).modalities).toEqual(['Dispensa', 'Pregão']);
  });

  it('gera etiquetas com rótulos exatos', () => {
    expect(activeFilterChips(DEFAULT_CATALOG_FILTERS).map((c) => c.label)).toEqual(['Situação: Em andamento']);
    const labels = activeFilterChips({ ...DEFAULT_CATALOG_FILTERS, modalities: ['Dispensa'], city: 'Campinas', publishedFrom: '2026-11-01', publishedTo: '2026-11-30' }).map((c) => c.label);
    expect(labels).toEqual(['Situação: Em andamento', 'Modalidade: Dispensa', 'Cidade: Campinas', 'Publicação: 01/11/2026–30/11/2026']);
    expect(activeFilterChips({ ...DEFAULT_CATALOG_FILTERS, situation: 'all' })).toEqual([]);
  });

  it('remover etiqueta volta o campo ao padrão', () => {
    const chips = activeFilterChips(full);
    const remove = (key: string) => removeFilterChip(full, key);
    expect(remove('situation').situation).toBe('all');
    expect(remove(chips.find((c) => c.label === 'Modalidade: Pregão')!.key).modalities).toEqual(['Dispensa']);
    expect(remove('city').city).toBe('');
    expect(remove('published')).toMatchObject({ publishedFrom: '', publishedTo: '' });
    expect(remove('deadline')).toMatchObject({ deadlineFrom: '', deadlineTo: '' });
  });

  it('conta filtros avançados ativos', () => {
    expect(countAdvancedFilters(DEFAULT_CATALOG_FILTERS)).toBe(0);
    expect(countAdvancedFilters(full)).toBe(6);
  });
});
