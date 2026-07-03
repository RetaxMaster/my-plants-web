<script setup lang="ts">
const { t } = useI18n();
const { user } = useUserSession();

// Admin-only: a non-admin session 404s, so the view never renders for a USER (the global auth
// middleware already requires a session). GET /owners is the hard backend gate (403).
if (user.value?.role !== 'ADMIN') {
  throw createError({ statusCode: 404, statusMessage: t('admin.pageNotFound') });
}

const api = useApi();
const { data: owners } = await useAsyncData('admin-owners', () => api.listOwners(), { default: () => [] });

const { start, pending } = useActingAs();
</script>

<template>
  <div>
    <UiScreenHeader
      :eyebrow="$t('admin.eyebrow')"
      :title="$t('admin.ownersTitle')"
      :subtitle="$t('admin.ownersSubtitle')"
    />

    <UiCard v-if="!owners?.length" padded>
      <UiEmptyState>{{ $t('admin.noOwners') }}</UiEmptyState>
    </UiCard>

    <UiCardGrid v-else :min="260" :gap="12">
      <UiCard v-for="o in owners" :key="o.ownerId" padded>
        <div class="mp-owner-row">
          <UiIconTile icon="user" tone="cafe" :size="40" />
          <div class="mp-owner-row__info">
            <div class="mp-owner-row__name-line">
              <span class="mp-owner-row__name">{{ o.username }}</span>
              <UiBadge v-if="o.role" color="green" size="xs">{{ o.role }}</UiBadge>
            </div>
          </div>
          <UiBadge v-if="o.ownerId === user?.ownerId" color="green" size="xs">{{ $t('admin.you') }}</UiBadge>
          <UiButton v-else size="xs" variant="ghost" color="neutral" :disabled="pending" @click="start(o.ownerId)">
            {{ $t('admin.actAs') }}
          </UiButton>
        </div>
      </UiCard>
    </UiCardGrid>
  </div>
</template>

<style scoped>
.mp-owner-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.mp-owner-row__info {
  flex: 1;
  min-width: 0;
}
.mp-owner-row__name-line {
  display: flex;
  align-items: center;
  gap: 8px;
}
.mp-owner-row__name {
  font: 700 15px var(--font-sans);
  color: var(--text-strong);
}
</style>
