<script setup lang="ts">
// An ORDINAL instrument (the wooden stick, the finger) does not produce a number — it produces one of a few
// NAMED states the owner recognises by feel or by eye ("it comes out clean" vs "a little dry soil clings to
// it" vs "damp soil sticks to it"). Rendering a number input for it would invite an answer the instrument
// cannot give, so it gets a CHOICE control instead, built on the same `SegmentedControl` every other
// picker in this modal already uses (never a hand-rolled row of buttons — design-system rule).
//
// The wire format is unchanged: an ordinal reading still sends its LEVEL as `rawValue`, exactly like every
// numeric instrument's own reading — see `soil-instrument-constants.ts`'s own comment on `captureKind`.
import SegmentedControl from './SegmentedControl.vue';
import {
  INSTRUMENTS,
  resolutionStates,
} from '@retaxmaster/my-plants-species-schema/soil-instrument-constants';
import type { InstrumentId } from '@retaxmaster/my-plants-species-schema/soil-instrument-constants';

const props = defineProps<{ instrumentId: InstrumentId }>();
// `null` is the "unanswered" sentinel — the same convention SoilReadingModal.vue's own fields (`rawValue`,
// `wateringRelation`) already use for a question nothing has answered yet.
const model = defineModel<number | null>({ default: null });

const { t } = useI18n();

const row = computed(() => INSTRUMENTS[props.instrumentId]);

// The level COUNT is derived from the row's own `rawMin`/`rawMax`, through the SAME helper the care engine
// uses to cap an instrument's confidence (`resolutionStates`) — never a literal `3`. A future four-level
// ordinal row needs no edit here: this list grows with the row it reads.
const levels = computed<number[]>(() => {
  const count = resolutionStates(row.value);
  // Every ordinal row declares a CLOSED `rawMax` today (it reports a finite set of named states, never an
  // open-ended one) — `resolutionStates` returns `null` only for an open-ended scale. Throwing here rather
  // than silently rendering zero options keeps a malformed/mis-tagged row from failing invisibly.
  if (count === null) {
    throw new Error(`ordinal instrument "${props.instrumentId}" has no closed rawMax; cannot derive levels`);
  }
  return Array.from({ length: count }, (_, i) => row.value.rawMin + i * row.value.rawStep);
});

// Labels are THIS instrument's own words — the stick and the finger read the same three-state shape but
// describe it differently, because they reach different depths (see `soil-instrument-constants.ts`).
const options = computed(() =>
  levels.value.map((level) => ({
    key: String(level),
    label: t(`reading.levels.${props.instrumentId}.${level}`),
  })),
);

// `SegmentedControl`'s own model is a plain, non-nullable `string` — it cannot accept `null`. '' is the
// "nothing chosen yet" sentinel, the same bridge SoilReadingModal.vue's `instrumentId`/`wateringRelation`
// refs already use for an unanswered field on that same control.
const segModel = computed<string>({
  get: () => (model.value == null ? '' : String(model.value)),
  set: (v) => { model.value = v === '' ? null : Number(v); },
});
</script>

<template>
  <SegmentedControl v-model="segModel" :options="options" />
</template>
