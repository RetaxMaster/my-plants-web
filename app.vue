<script setup lang="ts">
// Reflect the active locale on <html lang> for accessibility + SEO. Binding the reactive
// `locale` ref (the locale CODE — 'en'/'es', not the BCP-47 language) means the attribute is
// resolved during SSR (so the first HTML paint already carries the right lang) AND updates live
// on a locale switch. useHead unwraps the ref reactively; no one-time literal.
const { locale } = useI18n();
useHead({ htmlAttrs: { lang: locale } });
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
