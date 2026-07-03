<script setup lang="ts">
// The EN/ES switcher, now built on the shared SegmentedControl (one segmented implementation). Reads
// the reactive locale from @nuxtjs/i18n; setLocale writes the persistence cookie and re-renders.
defineOptions({ inheritAttrs: false });

const { locale, locales, setLocale } = useI18n();

const options = computed(() =>
  (locales.value as { code: string; name: string }[]).map((l) => ({ key: l.code, label: l.code.toUpperCase() })),
);

const current = computed<string>({
  get: () => locale.value as string,
  set: (code: string) => {
    if (code !== locale.value) setLocale(code as 'en' | 'es');
  },
});
</script>

<template>
  <UiSegmentedControl
    v-model="current"
    :options="options"
    size="sm"
    :aria-label="$t('nav.language')"
    v-bind="$attrs"
  />
</template>
