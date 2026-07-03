<script setup lang="ts">
const { user } = useUserSession();
if (user.value?.role !== 'ADMIN') {
  throw createError({ statusCode: 404, statusMessage: 'Page not found' });
}
</script>

<template>
  <div>
    <UiScreenHeader eyebrow="Admin" title="Admin tools" subtitle="Tools available to administrators." />
    <UiCardGrid :min="260" :gap="12">
      <UiCard padded>
        <div class="mp-admin-tile">
          <UiIconTile icon="sparkles" tone="cafe" :size="40" />
          <div class="mp-admin-tile__info">
            <div class="mp-admin-tile__title">Knowledge Engine</div>
            <p class="mp-admin-tile__desc">Chat with the research assistant to curate species records.</p>
          </div>
          <NuxtLink to="/admin/knowledge-engine" class="mp-admin-tile__cta">Open</NuxtLink>
        </div>
      </UiCard>
      <UiCard padded>
        <div class="mp-admin-tile">
          <UiIconTile icon="user-group" tone="cafe" :size="40" />
          <div class="mp-admin-tile__info">
            <div class="mp-admin-tile__title">Switch user</div>
            <p class="mp-admin-tile__desc">Act on behalf of another owner.</p>
          </div>
          <NuxtLink to="/admin/owners" class="mp-admin-tile__cta mp-admin-tile__cta--ghost">Open</NuxtLink>
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
