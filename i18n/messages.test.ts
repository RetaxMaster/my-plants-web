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

  // ---- QA 2026-08-11, finding 2: a reading badge states the ANSWER, never a completed action ----------
  //
  // THE MEASURED DEFECT. `reading.verdictBadge.WATER_NOW` read "Watered" / **"Regada"**. It badges the
  // VERDICT of a reading, so an owner who measured a pot last watered 60 days ago, was told *time to
  // water*, and closed the dialog WITHOUT watering saw his reading row labelled "Regada" — on the same
  // screen as "Regada hace 60 días" in the history and a still-pending water task. The app claiming an act
  // the owner did not perform is the same class of dishonesty the 2026-08-09 fabricated-`WATER DONE`
  // ruling deleted from the write path (docs/care-engine.md §7.20.14), surviving in a label. It was OUR
  // regression: until the survey started storing the honest `WATER_NOW` verdict this badge never rendered.
  //
  // ⚠️ ASSERTED ON THE PROSE, DELIBERATELY, and this is the ONE place in this file where that is right:
  // the wording IS the defect. Every other case here pins a key. A copy edit that revisits these four
  // strings is expected to update this case with them; a revert to a past participle goes red.
  //
  // The two labels are checked TOGETHER because the sibling is what makes the pair legible: both now
  // describe what the reading ANSWERED ("water now" / "don't water yet"), and Spanish uses the infinitive
  // so neither can be read as a report of something that already happened to the plant.
  it('badges a reading with the ANSWER it reached, never with an action nobody performed', () => {
    const g = make();
    expect(g.t('reading.verdictBadge.WATER_NOW')).toBe('Water now');
    expect(g.t('reading.verdictBadge.POSTPONE')).toBe("Don't water yet");
    g.locale.value = 'es';
    expect(g.t('reading.verdictBadge.WATER_NOW')).toBe('Regar ahora');
    expect(g.t('reading.verdictBadge.POSTPONE')).toBe('No regar todavía');
    // The specific words that were on screen, named so a revert cannot pass by looking plausible.
    expect(g.t('reading.verdictBadge.WATER_NOW')).not.toBe('Regada');
    expect(g.t('reading.verdictBadge.POSTPONE')).not.toBe('Aplazada');
  });

  // ---- AF-8: the approved-proposal summary is THREE independently-pluralised counts, not one sentence --
  //
  // ⚠️ ASSERTED ON THE PROSE, DELIBERATELY — the second of the two places in this file where that is right,
  // for the same reason as the verdict badge above: THE WORDING IS THE DEFECT. The line this replaces read
  // "Se aplicaron {applied} de {total} cambios", whose plural branch was chosen by `total` while the verb
  // "Se aplicaron" agrees with `applied` — so `applied=1, total=4` rendered "Se aplicaron 1 de 4 cambios"
  // where Spanish requires "Se aplicó". ONE vue-i18n plural choice cannot satisfy two independent
  // agreements in one sentence. Counting the three states separately removes the conjugated verb entirely:
  // a participle agrees with its own noun, and each segment carries its own count as its own plural choice.
  //
  // English does not inflect any of the three, so both branches of each key are the same string on purpose —
  // asserted at 1 AND at 2 so a future English word that DOES inflect cannot be added silently on one side.
  it('pluralises each outcome-summary segment against its OWN count (es)', () => {
    const g = make();
    g.locale.value = 'es';
    expect(g.t('tasks.outcomeSummary.applied', { count: 1 }, 1)).toBe('1 aplicado');
    expect(g.t('tasks.outcomeSummary.applied', { count: 2 }, 2)).toBe('2 aplicados');
    expect(g.t('tasks.outcomeSummary.partial', { count: 1 }, 1)).toBe('1 parcial');
    expect(g.t('tasks.outcomeSummary.partial', { count: 2 }, 2)).toBe('2 parciales');
    expect(g.t('tasks.outcomeSummary.alreadyRecorded', { count: 1 }, 1)).toBe('1 ya registrado');
    expect(g.t('tasks.outcomeSummary.alreadyRecorded', { count: 2 }, 2)).toBe('2 ya registrados');
  });

  it('pluralises each outcome-summary segment against its OWN count (en)', () => {
    const g = make();
    expect(g.t('tasks.outcomeSummary.applied', { count: 1 }, 1)).toBe('1 applied');
    expect(g.t('tasks.outcomeSummary.applied', { count: 2 }, 2)).toBe('2 applied');
    expect(g.t('tasks.outcomeSummary.partial', { count: 1 }, 1)).toBe('1 partial');
    expect(g.t('tasks.outcomeSummary.partial', { count: 2 }, 2)).toBe('2 partial');
    expect(g.t('tasks.outcomeSummary.alreadyRecorded', { count: 1 }, 1)).toBe('1 already recorded');
    expect(g.t('tasks.outcomeSummary.alreadyRecorded', { count: 2 }, 2)).toBe('2 already recorded');
  });

  // The superseded two-number key is GONE from both catalogues, not merely unreferenced. A dead plural
  // string is copy a translator has to maintain for a sentence nothing can render — and leaving it would
  // let a future surface reach for the very phrasing AF-8 retired.
  it('no longer carries the superseded two-number summary key', () => {
    expect((en.tasks as Record<string, unknown>).partialOutcomeSummary).toBeUndefined();
    expect((es.tasks as Record<string, unknown>).partialOutcomeSummary).toBeUndefined();
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
