<script setup lang="ts">
import AppIcon from './AppIcon.vue';
import type { DoctorProposalChange } from '../../types/api';

defineOptions({ inheritAttrs: false });

// This component INTERPRETS NOTHING. Every value it shows is a display string the server already
// rendered, and it is printed verbatim — no casing, no truncation, no unit suffixes, no date reformatting.
// That restraint is the whole point: the API owns what a change MEANS (spec §5.4), so a browser that
// reformatted a value would become a second, drifting description of the write the owner is approving.
// Its job is layout and clarity, never interpretation.
//
// Copy arrives as props rather than being resolved here, so this stays i18n-namespace-agnostic and is
// reusable by any future "before → after" surface (the consumer already knows its own namespace).
defineProps<{
  changes: DoctorProposalChange[];
  // Rendered wherever a value is null — both "had no value" and "will be cleared".
  emptyValue: string;
  // Leads the drift disclosure, e.g. "This changed since the doctor looked. It saw:".
  staleLabel: string;
}>();
</script>

<template>
  <ul class="mp-changes" v-bind="$attrs">
    <!-- Keyed by INDEX as well as field: two changes in one operation can legitimately carry the same
         label, and keying on the label alone would make Vue reuse the wrong node. -->
    <li v-for="(change, i) in changes" :key="`${change.field}-${i}`" class="mp-changes__row">
      <span class="mp-changes__field">{{ change.field }}</span>
      <span class="mp-changes__values">
        <span class="mp-changes__before">{{ change.before ?? emptyValue }}</span>
        <!-- Decorative: the direction is already carried by the layout and the surrounding copy, and an
             announced "arrow right" between two values adds noise rather than meaning. -->
        <AppIcon name="arrow-right" :size="14" class="mp-changes__arrow" aria-hidden="true" />
        <span class="mp-changes__after">{{ change.after ?? emptyValue }}</span>
      </span>
      <!-- Presence of `stale` is the signal, NOT the truthiness of its value: a drift whose earlier value
           was empty is still a drift, and `atProposeTime: null` must disclose rather than disappear. -->
      <span v-if="change.stale" class="mp-changes__stale">
        {{ staleLabel }} {{ change.stale.atProposeTime ?? emptyValue }}
      </span>
    </li>
  </ul>
</template>

<style scoped>
.mp-changes {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.mp-changes__row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.mp-changes__field {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.mp-changes__values {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  min-width: 0;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
}

.mp-changes__before {
  color: var(--text-muted);
  text-decoration: line-through;
  overflow-wrap: anywhere;
}

.mp-changes__arrow {
  flex: none;
  color: var(--text-muted);
}

.mp-changes__after {
  color: var(--text-strong);
  font-weight: var(--weight-semibold);
  overflow-wrap: anywhere;
}

.mp-changes__stale {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--care-caution-text);
  overflow-wrap: anywhere;
}
</style>
