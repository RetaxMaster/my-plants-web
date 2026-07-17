<script setup lang="ts">
import { plantTitle } from '../../../utils/displayName.js';

const { t, locale } = useI18n();
const route = useRoute();
const api = useApi();
const id = route.params.id as string;

// The plant itself — proves ownership (the API 404s a plant this owner doesn't own) and gives the header its
// name. useAsyncData CAPTURES a thrown 404 into `error` instead of propagating it, so a nonexistent/foreign
// plant would otherwise render an empty diagnose workspace. Re-throw it as a real Nuxt error so the page
// 404s, per the "loads only when the plant is owned" contract (Spec 3 §5.1).
const { data: plant, error } = await useAsyncData(`diagnose-plant-${id}`, () => api.getPlant(id));
if (error.value) {
  throw createError({
    statusCode: (error.value as { statusCode?: number }).statusCode ?? 404,
    statusMessage: t('diagnose.notFound'),
    fatal: true,
  });
}

useHead(() => ({ title: t('meta.diagnose.title') }));
useSeoMeta({ description: () => t('meta.diagnose.description') });

// The injected scope: plant-pinned sessions/runs adapters + the doctor engine socket URL. The session
// list, selection, delete, panel, layout and its CSS all live in the SHARED <AgentChatWorkspace> (Task 7) —
// this page only supplies the dependencies + the plant-name header.
const sessionsApi = useDoctorChatSessions(id);
const runsApi = useDoctorChatRuns(id);
const socketUrl = useRuntimeConfig().public.plantDoctorSocketUrl;

const heading = computed(() =>
  plant.value ? t('diagnose.forPlant', { plant: plantTitle(plant.value, locale.value) }) : t('diagnose.title'),
);
</script>

<template>
  <AgentChatWorkspace
    :sessions="sessionsApi"
    :runs="runsApi"
    :socket-url="socketUrl"
    i18n-namespace="diagnose"
    theme-storage-key="crt-theme-diagnose"
    :scope-key="`diagnose-${id}`"
  >
    <template #header>
      <UiScreenHeader :eyebrow="$t('diagnose.eyebrow')" :title="heading" :subtitle="$t('diagnose.subtitle')" />
    </template>
  </AgentChatWorkspace>
</template>
