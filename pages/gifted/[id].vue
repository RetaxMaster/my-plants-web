<script setup lang="ts">
// Frozen-plant detail entry point for a GIFTED plant (Plant Lifecycle feature, Task 28). Thin wrapper
// over the SAME shared detail body /plants/:id uses — no forked markup. PlantDetail.vue itself derives
// read-only + snapshot-label + doctor-consultable behavior from the plant's lifecycleState.
const route = useRoute();
const id = route.params.id as string;
</script>

<template>
  <PlantDetail :id="id" />
</template>
