<script setup lang="ts">
// Chrome-free layout for the login wall: no app navigation, just the centered
// slot plus the theme toggle pinned top-right (mirrors the prototype's
// logged-out shell).
import BrandMark from '../components/ui/BrandMark.vue';
import ThemeToggle from '../components/ui/ThemeToggle.vue';
</script>

<template>
  <div class="mp-auth">
    <div class="mp-auth__toggle">
      <ThemeToggle />
    </div>
    <div class="mp-auth__center">
      <div class="mp-login">
        <div class="mp-auth__brand">
          <BrandMark to="/" />
        </div>
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.mp-auth {
  position: relative;
  min-height: 100vh;
  display: flex;
  background: var(--surface-page);
}

.mp-auth__toggle {
  position: absolute;
  top: 18px;
  right: 18px;
}

.mp-auth__center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.mp-auth__brand {
  display: flex;
  justify-content: center;
  margin-bottom: 24px;
}
</style>
