import { describe, expect, it } from 'vitest';
import { createI18n } from 'vue-i18n';
import en from './locales/en.json';
import es from './locales/es.json';

function make() {
  const i18n = createI18n({
    legacy: false,
    locale: 'en',
    fallbackLocale: 'en',
    messages: { en, es },
  });
  return i18n.global;
}

describe('vue-i18n message resolution', () => {
  it('resolves task labels per locale', () => {
    const g = make();
    expect(g.t('tasks.labels.WATER')).toBe('Water');
    g.locale.value = 'es';
    expect(g.t('tasks.labels.WATER')).toBe('Regar');
    expect(g.t('tasks.labels.CLEAN_LEAVES')).toBe('Limpiar hojas');
  });

  it('resolves health labels per locale', () => {
    const g = make();
    expect(g.t('health.EXCELLENT')).toBe('Excellent');
    g.locale.value = 'es';
    expect(g.t('health.EXCELLENT')).toBe('Excelente');
  });

  it('pluralizes the short due label (en)', () => {
    const g = make();
    expect(g.t('due.short.inDays', { n: 1 }, 1)).toBe('In 1 day');
    expect(g.t('due.short.inDays', { n: 3 }, 3)).toBe('In 3 days');
  });

  it('pluralizes the long due label (es)', () => {
    const g = make();
    g.locale.value = 'es';
    expect(g.t('due.long.overdue', { n: 1 }, 1)).toBe('Atrasada por 1 día');
    expect(g.t('due.long.overdue', { n: 2 }, 2)).toBe('Atrasada por 2 días');
  });

  it('interpolates named params in both locales', () => {
    const g = make();
    expect(g.t('actingAs.banner', { label: 'Sofia' })).toBe('Acting as Sofia');
    expect(g.t('more.signedInAs', { username: 'sofia' })).toBe('Signed in as sofia');
    g.locale.value = 'es';
    expect(g.t('actingAs.banner', { label: 'Sofia' })).toBe('Actuando como Sofia');
  });

  it('pluralizes history + count keys', () => {
    const g = make();
    expect(g.t('history.daysAgo', { n: 1 }, 1)).toBe('1 day ago');
    expect(g.t('history.photoCount', { n: 2 }, 2)).toBe('2 photos');
    expect(g.t('today.tasksDue', { n: 1 }, 1)).toBe('1 task due');
    expect(g.t('today.tasksDue', { n: 5 }, 5)).toBe('5 tasks due');
  });

  it('resolves knowledge-engine composer chrome per locale', () => {
    const g = make();
    expect(g.t('knowledgeEngine.composer.promptLabel')).toBe('Message');
    expect(g.t('knowledgeEngine.composer.send')).toBe('Send');
    expect(g.t('knowledgeEngine.composer.enterToSend')).toBe('Enter to send');
    g.locale.value = 'es';
    expect(g.t('knowledgeEngine.composer.promptLabel')).toBe('Mensaje');
    expect(g.t('knowledgeEngine.composer.send')).toBe('Enviar');
    expect(g.t('knowledgeEngine.composer.shiftEnterNewline')).toBe('Shift+Enter para una nueva línea');
  });

  it('resolves per-task info copy and dryness labels per locale', () => {
    const g = make();
    expect(g.t('taskInfo.tasks.WATER.what')).toBe('Giving the plant water at the roots.');
    expect(g.t('taskInfo.dryness.mostly-dry')).toBe('Let the soil dry out almost completely before watering.');
    g.locale.value = 'es';
    expect(g.t('taskInfo.tasks.WATER.what')).toBe('Darle agua a la planta en la raíz.');
    expect(g.t('taskInfo.speciesTitle')).toBe('Para esta planta');
  });

  it('en and es have identical key trees', () => {
    const paths = (o: Record<string, unknown>, prefix = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => {
        const key = prefix ? `${prefix}.${k}` : k;
        return v && typeof v === 'object' ? paths(v as Record<string, unknown>, key) : [key];
      });
    const enKeys = paths(en as Record<string, unknown>).sort();
    const esKeys = paths(es as Record<string, unknown>).sort();
    expect(esKeys).toEqual(enKeys);
  });
});
