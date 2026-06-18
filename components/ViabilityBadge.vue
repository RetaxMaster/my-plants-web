<script setup lang="ts">
import type { ViabilityLevel } from '../types/api.js';

const props = defineProps<{ level: ViabilityLevel; reasons?: string[] }>();

const color = computed(() => ({ good: 'green', caution: 'amber', poor: 'red' } as const)[props.level]);
const label = computed(() => ({ good: 'Good fit', caution: 'Caution', poor: 'Poor fit' }[props.level]));
</script>

<template>
  <div class="flex flex-col gap-1">
    <UBadge :color="color" variant="subtle">{{ label }}</UBadge>
    <ul v-if="reasons?.length" class="text-xs text-gray-500 list-disc pl-4">
      <li v-for="reason in reasons" :key="reason">{{ reason }}</li>
    </ul>
  </div>
</template>
