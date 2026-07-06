<script setup lang="ts">
// Responsive, auth-aware app shell — recreates the prototype's app.jsx:
// sticky top bar (wordmark + desktop nav + theme toggle + account menu),
// a centered main column, and a sticky mobile bottom nav. BOTH navs render
// in the DOM; CSS media queries (not JS) decide which is visible, so SSR and
// the first client render agree (no hydration mismatch / FOUC).
import BrandMark from '../components/ui/BrandMark.vue';
import ThemeToggle from '../components/ui/ThemeToggle.vue';
import NavTabs from '../components/ui/NavTabs.vue';
import AppIcon from '../components/ui/AppIcon.vue';
import AccountMenu from '../components/AccountMenu.vue';

const { loggedIn, user } = useUserSession();
const { actingAs, stop: stopActingAs } = useActingAs();
const { t } = useI18n();

const route = useRoute();

// Every nav item carries the destination route + which protected/public bucket
// it belongs to. Logged-out visitors only see the public Blog (mirrors AppNav),
// so they never click a protected link that just bounces back to /login.
interface NavItem {
  key: string;
  label: string;
  icon: string;
  to: string;
  public: boolean;
}

// Top row (desktop): Today/Plants/Places/Cities/Moving/Blog. Labels are reactive
// translations so a locale switch re-renders the nav without a reload (spec §6.3).
const topItemsAll = computed<NavItem[]>(() => [
  { key: 'today', label: t('nav.today'), icon: 'sun', to: '/', public: false },
  { key: 'plants', label: t('nav.plants'), icon: 'sparkles', to: '/plants', public: false },
  { key: 'places', label: t('nav.places'), icon: 'home', to: '/places', public: false },
  { key: 'cities', label: t('nav.cities'), icon: 'map-pin', to: '/cities', public: false },
  { key: 'moving', label: t('nav.moving'), icon: 'truck', to: '/moving', public: false },
  { key: 'blog', label: t('nav.blog'), icon: 'book-open', to: '/blog', public: true },
]);

// Bottom bar (mobile): Today/Plants/Places/Blog/More. Cities & Moving fold into
// the More page on mobile; on desktop they live in the top row.
const bottomItemsAll = computed<NavItem[]>(() => [
  { key: 'today', label: t('nav.today'), icon: 'sun', to: '/', public: false },
  { key: 'plants', label: t('nav.plants'), icon: 'sparkles', to: '/plants', public: false },
  { key: 'places', label: t('nav.places'), icon: 'home', to: '/places', public: false },
  { key: 'blog', label: t('nav.blog'), icon: 'book-open', to: '/blog', public: true },
  { key: 'more', label: t('nav.more'), icon: 'ellipsis-horizontal', to: '/more', public: false },
]);

const topItems = computed(() => {
  const base = loggedIn.value ? topItemsAll.value : topItemsAll.value.filter((i) => i.public);
  // Admins get an extra desktop tab to the admin area. Role-gating a nav item is display-only; the
  // hard gate is each admin page's createError(404) + the API RolesGuard (403).
  if (loggedIn.value && user.value?.role === 'ADMIN') {
    return [...base, { key: 'admin', label: t('nav.admin'), icon: 'sparkles', to: '/admin', public: false }];
  }
  return base;
});
const bottomItems = computed(() =>
  loggedIn.value ? bottomItemsAll.value : bottomItemsAll.value.filter((i) => i.public),
);

// Map the current route path → the active nav key. Detail/sub routes resolve to
// their parent tab (a plant detail/new highlights Plants, an article highlights
// Blog). On the bottom bar, Cities/Moving/More all light up "More".
function tabForPath(path: string): string {
  if (path === '/') return 'today';
  if (path.startsWith('/plants')) return 'plants';
  if (path.startsWith('/places')) return 'places';
  if (path.startsWith('/cities')) return 'cities';
  if (path.startsWith('/moving')) return 'moving';
  if (path.startsWith('/admin')) return 'admin';
  if (path.startsWith('/blog')) return 'blog';
  if (path.startsWith('/more')) return 'more';
  return 'today';
}

const topActive = computed(() => tabForPath(route.path));
const bottomActive = computed(() => {
  const key = tabForPath(route.path);
  return key === 'cities' || key === 'moving' || key === 'more' ? 'more' : key;
});
</script>

<template>
  <div class="mp-shell">
    <!-- top bar -->
    <header class="mp-topbar">
      <div class="mp-topbar-inner">
        <BrandMark to="/" />

        <div class="mp-shell__topnav">
          <NavTabs
            :items="topItems"
            :active="topActive"
            variant="top"
            class="mp-shell__topnav-tabs"
          />
        </div>

        <div class="mp-shell__actions">
          <ThemeToggle />
          <NuxtLink v-if="!loggedIn" to="/login" class="mp-menu-item mp-shell__signin">
            <AppIcon name="arrow-right-on-rectangle" :size="16" color="currentColor" />
            {{ $t('nav.signIn') }}
          </NuxtLink>
          <AccountMenu v-else />
        </div>
      </div>
    </header>

    <div v-if="actingAs" class="mp-actingas" role="status">
      <AppIcon name="user" :size="16" color="currentColor" />
      <span class="mp-actingas__text">
        <i18n-t keypath="actingAs.banner" tag="span">
          <template #label><strong>{{ actingAs.label }}</strong></template>
        </i18n-t>
      </span>
      <button type="button" class="mp-actingas__stop" @click="stopActingAs">{{ $t('actingAs.stop') }}</button>
    </div>

    <!-- content -->
    <main class="mp-shell__main">
      <slot />
    </main>

    <!-- bottom nav (mobile) -->
    <div class="mp-bottomnav mp-shell__bottomnav">
      <NavTabs
        :items="bottomItems"
        :active="bottomActive"
        variant="bottom"
      />
    </div>
  </div>
</template>

<style scoped>
.mp-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--surface-page);
}

.mp-actingas {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 22px;
  background: var(--care-caution-bg);
  border-bottom: 1px solid color-mix(in oklch, var(--care-caution) 35%, transparent);
  color: var(--care-caution-text);
  font: 13px var(--font-sans);
}
.mp-actingas__text strong {
  font-weight: var(--weight-semibold);
}
.mp-actingas__stop {
  margin-left: auto;
  background: none;
  border: 1px solid currentColor;
  border-radius: var(--radius-sm);
  padding: 3px 10px;
  font: 600 12px var(--font-sans);
  color: inherit;
  cursor: pointer;
}

.mp-shell__topnav {
  flex: 1;
  min-width: 0;
  margin-left: 8px;
}

.mp-shell__topnav-tabs {
  border: none;
  padding: 0;
}

.mp-shell__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-left: auto;
}

.mp-shell__signin {
  width: auto;
  text-decoration: none;
}

.mp-shell__main {
  flex: 1;
  width: 100%;
  max-width: 1120px;
  margin: 0 auto;
  padding: 26px 22px 40px;
  box-sizing: border-box;
}

/* Responsive via CSS only: top nav ≥880px, bottom nav <880px. Both stay in the
   DOM so SSR and hydration agree. */
.mp-shell__topnav {
  display: none;
}

.mp-shell__bottomnav {
  display: block;
}

@media (min-width: 880px) {
  .mp-shell__topnav {
    display: block;
  }

  .mp-shell__bottomnav {
    display: none;
  }
}
</style>
