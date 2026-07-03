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
});
