<script setup lang="ts">
import Badge from './Badge.vue';

defineOptions({ inheritAttrs: false });

// `plant` is part of the contract (the caller passes the plant it describes),
// but the rendered state is derived purely from `dueCount` — the number of
// that plant's entries in the owner's single `todaysTasks()` result. The
// `Plant` list type carries no per-task status, so there is no overdue/today
// distinction here (that needs per-plant `getPlantCare`, out of scope).
const props = withDefaults(
  defineProps<{
    plant?: unknown;
    dueCount?: number;
    class?: unknown;
  }>(),
  {
    dueCount: 0,
  },
);

const hasDue = computed(() => props.dueCount > 0);
</script>

<template>
  <Badge v-if="hasDue" color="amber" size="xs" :class="props.class" v-bind="$attrs">
    {{ $t('plantStatus.due', { n: dueCount }, dueCount) }}
  </Badge>
  <Badge v-else color="green" size="xs" dot :class="props.class" v-bind="$attrs">
    {{ $t('plantStatus.upToDate') }}
  </Badge>
</template>
