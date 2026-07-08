import {
  EARLY_WATER_REASONS,
  WATER_POSTPONE_REASONS,
} from '@retaxmaster/my-plants-species-schema/feedback-reason-constants';

// The two WATER reason option sets, each slug paired with its i18n label. Consumed by the ReasonPicker on
// the Today list and the plant detail. Labels resolve from feedback.reason.<slug> (identical key trees per
// locale). The vocabulary itself lives once in the shared schema package — never re-declared here.
export function useFeedbackReasons() {
  const { t } = useI18n();
  const earlyWaterOptions = computed(() =>
    EARLY_WATER_REASONS.map((value) => ({ value, label: t(`feedback.reason.${value}`) })),
  );
  const postponeOptions = computed(() =>
    WATER_POSTPONE_REASONS.map((value) => ({ value, label: t(`feedback.reason.${value}`) })),
  );
  return { earlyWaterOptions, postponeOptions };
}
