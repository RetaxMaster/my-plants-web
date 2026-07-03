<script setup lang="ts">
const { t } = useI18n();
const { user } = useUserSession();
if (user.value?.role !== 'ADMIN') {
  throw createError({ statusCode: 404, statusMessage: t('admin.pageNotFound') });
}
</script>

<template>
  <div>
    <UiScreenHeader :eyebrow="$t('admin.eyebrow')" :title="$t('admin.toolsTitle')" :subtitle="$t('admin.toolsSubtitle')" />
    <UiCardGrid :min="260" :gap="12">
      <UiCard padded>
        <div class="mp-admin-tile">
          <UiIconTile icon="sparkles" tone="cafe" :size="40" />
          <div class="mp-admin-tile__info">
            <div class="mp-admin-tile__title">{{ $t('admin.keTitle') }}</div>
            <p class="mp-admin-tile__desc">{{ $t('admin.keDesc') }}</p>
          </div>
          <NuxtLink to="/admin/knowledge-engine" class="mp-admin-tile__cta">{{ $t('common.open') }}</NuxtLink>
        </div>
      </UiCard>
      <UiCard padded>
        <div class="mp-admin-tile">
          <UiIconTile icon="user-group" tone="cafe" :size="40" />
          <div class="mp-admin-tile__info">
            <div class="mp-admin-tile__title">{{ $t('admin.switchTitle') }}</div>
            <p class="mp-admin-tile__desc">{{ $t('admin.switchDesc') }}</p>
          </div>
          <NuxtLink to="/admin/owners" class="mp-admin-tile__cta mp-admin-tile__cta--ghost">{{ $t('common.open') }}</NuxtLink>
        </div>
      </UiCard>
    </UiCardGrid>
  </div>
</template>

<style scoped>
.mp-admin-tile { display: flex; align-items: center; gap: 12px; }
.mp-admin-tile__info { flex: 1; min-width: 0; }
.mp-admin-tile__title { font: 700 15px var(--font-sans); color: var(--text-strong); }
.mp-admin-tile__desc { margin: 2px 0 0; font: 13px var(--font-sans); color: var(--text-muted); }
/* `UiButton` (components/ui/Button.vue) renders a <button> and has NO `to`/router prop, and a <button>
   inside an <a> is invalid — so navigation CTAs are styled <NuxtLink>s built from design tokens. */
.mp-admin-tile__cta {
  flex-shrink: 0;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  background: var(--accent-cafe-ink);
  color: var(--surface-page);
  font: 600 13px var(--font-sans);
  text-decoration: none;
}
.mp-admin-tile__cta--ghost {
  background: transparent;
  color: var(--text-strong);
  border: 1px solid var(--border-subtle);
}
</style>
