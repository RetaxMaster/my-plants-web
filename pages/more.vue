<script setup lang="ts">
// Mobile "More" page: groups the secondary destinations (Cities, Moving) that
// don't fit the bottom bar, plus Sign out. On desktop these live in the top row,
// so `more` simply isn't in the top nav. The global auth middleware already gates
// this route, so we can assume a session here.
import Card from '../components/ui/Card.vue';
import IconTile from '../components/ui/IconTile.vue';
import ScreenHeader from '../components/ui/ScreenHeader.vue';
import AppIcon from '../components/ui/AppIcon.vue';

const { user, clear } = useUserSession();

const rows = [
  { to: '/cities', icon: 'map-pin', label: 'Cities', sub: 'Your home & saved cities' },
  { to: '/moving', icon: 'truck', label: 'Moving', sub: 'Simulate a move' },
];

// Mirror AccountMenu / AppNav logout exactly.
async function logout() {
  await $fetch('/api/auth/logout', { method: 'POST' });
  await clear();
  await navigateTo('/login');
}
</script>

<template>
  <div>
    <ScreenHeader title="More" :subtitle="`Signed in as ${user?.username ?? ''}`" />

    <div class="mp-more">
      <Card v-for="row in rows" :key="row.to" :to="row.to">
        <div class="mp-more__row">
          <IconTile :icon="row.icon" tone="cafe" :size="44" />
          <div class="mp-more__text">
            <div class="mp-more__label">{{ row.label }}</div>
            <div class="mp-more__sub">{{ row.sub }}</div>
          </div>
          <AppIcon name="chevron-right" :size="18" color="var(--text-faint)" />
        </div>
      </Card>

      <Card clickable @click="logout">
        <div class="mp-more__row">
          <IconTile icon="arrow-right-on-rectangle" tone="green" :size="44" />
          <div class="mp-more__text mp-more__label">Sign out</div>
        </div>
      </Card>
    </div>
  </div>
</template>

<style scoped>
.mp-more {
  display: grid;
  gap: 12px;
}

.mp-more__row {
  display: flex;
  align-items: center;
  gap: 14px;
}

.mp-more__text {
  flex: 1;
}

.mp-more__label {
  font: 700 15px var(--font-sans);
  color: var(--text-strong);
}

.mp-more__sub {
  font: 13px var(--font-sans);
  color: var(--text-muted);
}
</style>
