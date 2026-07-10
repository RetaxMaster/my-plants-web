import {
  EARLY_WATER_REASONS,
  WATER_POSTPONE_REASONS,
  REPOT_POSTPONE_REASONS,
} from '@retaxmaster/my-plants-species-schema/feedback-reason-constants';

// The reason option sets, each slug paired with its i18n label. Consumed by the ReasonPicker on the Today
// list and the plant detail. Labels resolve from feedback.reason.<slug> (identical key trees per locale).
// The vocabularies themselves live once in the shared schema package — never re-declared here.
export function useFeedbackReasons() {
  const { t } = useI18n();
  const earlyWaterOptions = computed(() =>
    EARLY_WATER_REASONS.map((value) => ({ value, label: t(`feedback.reason.${value}`) })),
  );
  const postponeOptions = computed(() =>
    WATER_POSTPONE_REASONS.map((value) => ({ value, label: t(`feedback.reason.${value}`) })),
  );
  // REPOT is an INSPECTION (spec F): its three outcomes are what the owner actually saw when they looked at
  // the roots. Same picker component, different vocabulary — parameterised, never forked.
  const repotPostponeOptions = computed(() =>
    REPOT_POSTPONE_REASONS.map((value) => ({ value, label: t(`feedback.reason.${value}`) })),
  );
  return { earlyWaterOptions, postponeOptions, repotPostponeOptions };
}
