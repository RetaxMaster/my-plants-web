import {
  EARLY_WATER_REASONS,
  WATER_POSTPONE_REASONS,
  REPOT_POSTPONE_REASONS,
  isMeasuredWaterReason,
} from '@retaxmaster/my-plants-species-schema/feedback-reason-constants';

// The reason option sets, each slug paired with its i18n label. Consumed by the ReasonPicker on the Today
// list and the plant detail. Labels resolve from feedback.reason.<slug> (identical key trees per locale).
// The vocabularies themselves live once in the shared schema package — never re-declared here.
export function useFeedbackReasons() {
  const { t } = useI18n();
  // The MEASURED slugs are excluded from the manual pickers on purpose. A measured reason asserts that an
  // instrument was used, and the measuring flow is the ONLY writer of it (enforced server-side in the same
  // transaction that writes the reading). Offering it in the hand-picked menu would let the owner claim a
  // measurement they never took — and it would land in the history as one. The LABEL lookup below stays
  // complete, so a measured event still renders with a proper sentence in the timeline.
  const earlyWaterOptions = computed(() =>
    EARLY_WATER_REASONS.filter((v) => !isMeasuredWaterReason(v))
      .map((value) => ({ value, label: t(`feedback.reason.${value}`) })),
  );
  const postponeOptions = computed(() =>
    WATER_POSTPONE_REASONS.filter((v) => !isMeasuredWaterReason(v))
      .map((value) => ({ value, label: t(`feedback.reason.${value}`) })),
  );
  // REPOT is an INSPECTION (spec F): its three outcomes are what the owner actually saw when they looked at
  // the roots. Same picker component, different vocabulary — parameterised, never forked.
  const repotPostponeOptions = computed(() =>
    REPOT_POSTPONE_REASONS.map((value) => ({ value, label: t(`feedback.reason.${value}`) })),
  );
  return { earlyWaterOptions, postponeOptions, repotPostponeOptions };
}
