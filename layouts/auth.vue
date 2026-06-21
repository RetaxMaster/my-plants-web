<template>
  <!-- Minimal chrome for the login wall: no app navigation, just the form centered. -->
  <UContainer class="min-h-screen flex items-center justify-center">
    <div class="w-full max-w-sm">
      <h1 class="text-2xl font-bold text-center mb-6">🌱 MyPlants</h1>
      <slot />
    </div>
  </UContainer>
</template>
