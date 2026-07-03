<script setup lang="ts">
defineOptions({ inheritAttrs: false });

// @nuxtjs/i18n augments useI18n with setLocale (writes the persistence cookie and
// re-renders reactively) and a reactive `locale`. The cookie is read during SSR,
// so `locale` is already correct on first paint — no hydration mismatch, no flash.
const { locale, locales, setLocale } = useI18n();

// The configured locales (code + human name) drive the segments, so adding a locale
// later needs no change here. Narrowed to { code, name } for the template.
const options = computed(() =>
  (locales.value as { code: string; name: string }[]).map((l) => ({ code: l.code, name: l.name })),
);

function choose(code: string) {
  if (code !== locale.value) setLocale(code as 'en' | 'es');
}
</script>

<template>
  <div class="mp-locale" role="group" :aria-label="$t('nav.language')" v-bind="$attrs">
    <button
      v-for="opt in options"
      :key="opt.code"
      type="button"
      class="mp-locale__seg"
      :class="{ 'mp-locale__seg--active': opt.code === locale }"
      :aria-pressed="opt.code === locale"
      @click="choose(opt.code)"
    >
      {{ opt.code.toUpperCase() }}
    </button>
  </div>
</template>

<style scoped>
.mp-locale {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  background: var(--surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
}

.mp-locale__seg {
  min-width: 34px;
  padding: 3px 10px;
  border: none;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-muted);
  font: var(--weight-semibold) var(--text-xs) var(--font-sans);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.mp-locale__seg--active {
  background: var(--surface-card);
  color: var(--text-strong);
  box-shadow: var(--shadow-xs);
}

.mp-locale__seg:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}
</style>
