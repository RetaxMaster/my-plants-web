<script setup lang="ts">
// Thin entry point over the shared detail body (Plant Lifecycle feature, Task 28): PlantDetail.vue owns
// the ONE implementation of the markup, reused verbatim by /pantheon/:id and /gifted/:id — never forked.
const route = useRoute();
const id = route.params.id as string;
</script>

<template>
  <PlantDetail :id="id" />
</template>
