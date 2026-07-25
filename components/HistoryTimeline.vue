<script setup lang="ts">
import type { HistoryItem } from '../types/api.js';
import { useTaskMeta } from '../composables/useTaskMeta';
import { calendarDaysSince } from '../utils/localDate.js';

defineProps<{ items: HistoryItem[] }>();
const emit = defineEmits<{
  openEntry: [entryId: string];
  openRecord: [recordId: string];
  openNote: [note: { noteId: string; occurredOn: string; body: string }];
}>();

const { TASK_ICONS, taskPastLabel, healthLabel } = useTaskMeta();
const { t } = useI18n();

// "today" / "yesterday" / "N days ago", localized + pluralized. The day count comes from the shared
// local-calendar helper: counting it here against the UTC clock is what made a just-logged entry read
// as "yesterday" every evening (see calendarDaysBetween).
function agoLabel(occurredOn: string): string {
  const days = calendarDaysSince(occurredOn);
  if (days <= 0) return t('history.today');
  if (days === 1) return t('history.yesterday');
  return t('history.daysAgo', { n: days }, days);
}

// A relocation's label is built entirely from the event's write-time snapshot (never re-derived from
// today's live place/city, which may have changed since). cityChanged decides which pair of names reads.
function moveLabel(item: Extract<HistoryItem, { kind: 'move' }>): string {
  if (item.cityChanged) {
    return t('history.moveCity', { from: item.fromCityName ?? '—', to: item.toCityName ?? '—' });
  }
  return t('history.movePlace', { from: item.fromPlaceName ?? '—', to: item.toPlaceName ?? '—' });
}

// A lifecycle event is a terminal-state transition (memorialized/gifted) or a reversal of one
// (revived) — non-clickable, since there is nothing to open. One icon per transition.
function lifecycleIcon(transition: 'MEMORIALIZED' | 'GIFTED' | 'REVIVED'): string {
  if (transition === 'MEMORIALIZED') return 'archive-box';
  if (transition === 'GIFTED') return 'gift';
  return 'arrow-uturn-left';
}

// Exhaustiveness guard for the v-if/v-else-if chain below: HistoryItem is a closed 6-member union, so
// TypeScript narrows `item` to `never` once every known `kind` has been checked. A future 7th kind added
// to the union without a matching template branch fails typecheck HERE (the call site below won't
// compile) instead of silently rendering nothing in production.
function assertNever(x: never): never {
  throw new Error(`HistoryTimeline: unhandled history item kind: ${JSON.stringify(x)}`);
}
</script>

<template>
  <ol class="mp-history">
    <li v-for="(item, i) in items" :key="i" class="mp-history__item">
      <template v-if="item.kind === 'progress'">
        <UiLinkRow icon="camera" :date-label="agoLabel(item.occurredOn)" @click="emit('openEntry', item.entryId)">
          {{ t('history.progressLogged') }}<template v-if="item.health"> · <strong>{{ healthLabel(item.health) }}</strong></template>
          <span v-if="item.photoCount" class="mp-history__meta"> · {{ t('history.photoCount', { n: item.photoCount }, item.photoCount) }}</span>
          <span v-if="item.tagCount" class="mp-history__meta"> · {{ t('history.tagCount', { n: item.tagCount }, item.tagCount) }}</span>
        </UiLinkRow>
      </template>
      <template v-else-if="item.kind === 'clinical'">
        <UiLinkRow
          icon="clipboard-document-list"
          :date-label="agoLabel(item.occurredOn)"
          @click="emit('openRecord', item.recordId)"
        >
          {{ t('history.clinicalRecordCreated') }}
        </UiLinkRow>
      </template>
      <template v-else-if="item.kind === 'action'">
        <div class="mp-history__row">
          <UiAppIcon :name="TASK_ICONS[item.task]" :size="18" class="mp-history__icon" />
          <span class="mp-history__text">{{ taskPastLabel(item.task) }}</span>
          <span class="mp-history__date">{{ agoLabel(item.occurredOn) }}</span>
        </div>
      </template>
      <template v-else-if="item.kind === 'move'">
        <div class="mp-history__row">
          <UiAppIcon name="arrows-right-left" :size="18" class="mp-history__icon" />
          <span class="mp-history__text">{{ moveLabel(item) }}</span>
          <span class="mp-history__date">{{ agoLabel(item.occurredOn) }}</span>
        </div>
      </template>
      <template v-else-if="item.kind === 'note'">
        <UiLinkRow
          icon="pencil-square"
          :date-label="agoLabel(item.occurredOn)"
          @click="emit('openNote', { noteId: item.noteId, occurredOn: item.occurredOn, body: item.body })"
        >
          {{ t('history.noteAdded') }}
        </UiLinkRow>
      </template>
      <template v-else-if="item.kind === 'lifecycle'">
        <div class="mp-history__row">
          <UiAppIcon :name="lifecycleIcon(item.transition)" :size="18" class="mp-history__icon" />
          <span class="mp-history__text">{{ t(`history.lifecycle.${item.transition}`) }}</span>
          <span class="mp-history__date">{{ agoLabel(item.occurredOn) }}</span>
        </div>
      </template>
      <template v-else>{{ assertNever(item) }}</template>
    </li>
  </ol>
</template>

<style scoped>
/* Back to SCOPED: the clickable rows (progress/clinical) now render through the shared `UiLinkRow`
 * component (components/ui/LinkRow.vue), which owns its OWN complete default look in its own <style
 * scoped> — a reusable component ships its own presentation rather than depending on whichever parent
 * renders it to also define matching CSS. This file's own scoped style now covers only what THIS
 * component still renders directly.
 */
.mp-history { list-style: none; margin: 0; padding: 0; display: grid; }

/* The ONE rule that deliberately reaches into UiLinkRow's root node from here, rather than living
 * solely in LinkRow.vue: it is a LIST-separator concern (":not(:last-child)" is relative to this <ol>'s
 * OWN <li> siblings), which is inherently the parent's layout to own, not the row's. This works with a
 * plain scoped selector — no `:deep()` needed — because Vue's scoped CSS deliberately DOES propagate a
 * parent's scope attribute onto a child component's ROOT node (here, UiLinkRow's outer <button>),
 * specifically so the parent can style a child root for layout purposes; it does NOT propagate onto
 * elements nested further inside that child's own template, which is why the rest of the row's chrome
 * (icon/text/date, below) lives in LinkRow.vue instead. Also matches the inline 'action' row's own
 * <div class="mp-history__row">, since that element is this component's own root-level markup already. */
.mp-history__item:not(:last-child) .mp-history__row { border-bottom: 1px solid var(--border-subtle); }

/* The 'action' row is the one branch that still renders its own row markup inline (kept untouched by
 * the UiLinkRow extraction — it was never a clickable row). Its base box layout is therefore this
 * component's own responsibility: LinkRow.vue already owns the identical rule set for the rows IT
 * renders (progress/clinical), in its own scoped style — same tokens, same values, kept here only
 * because scoped CSS cannot reach past a child component's root into its own template. */
.mp-history__row {
  display: flex; align-items: center; gap: var(--space-2);
  width: 100%; padding: var(--space-3) 0; text-align: left;
  background: transparent; border: none; font-family: var(--font-sans);
}
.mp-history__icon { color: var(--text-muted); flex: none; }
.mp-history__text { flex: 1; min-width: 0; font-size: var(--text-sm); color: var(--text-strong); }
/* Used only inside the 'progress' row's SLOT CONTENT (the photo-count / tag-count spans passed into
 * UiLinkRow's default slot). Slot content is compiled in THIS file, so it carries this component's own
 * scope attribute regardless of which child renders it — it belongs here, not in LinkRow.vue, which
 * never writes a `.mp-history__meta` element in its own template. */
.mp-history__meta { color: var(--text-muted); }
.mp-history__date { font-size: var(--text-xs); color: var(--text-faint); white-space: nowrap; }
</style>
