<script setup lang="ts">
const { t } = useI18n();

useHead(() => ({ title: t('meta.gardener.title') }));
useSeoMeta({ description: () => t('meta.gardener.description') });

// The injected scope: owner-anchored sessions/runs/proposals adapters + the gardener engine socket URL.
// The session list, selection, delete, panel, layout and CSS all live in the SHARED <AgentChatWorkspace>.
// NO chat UI is written here — this page only supplies the dependencies and the header.
//
// Unlike the doctor's shell, none of these adapters closes over a plant: the gardener is owner-scoped and
// garden-wide, which is exactly the distinction the two surfaces exist to keep apart. It diagnoses one
// plant; this one places, groups and equips the whole garden.
const sessionsApi = useGardenerChatSessions();
const runsApi = useGardenerChatRuns();
const proposalsApi = useGardenerChatProposals();
const socketUrl = useRuntimeConfig().public.gardenerSocketUrl;
</script>

<template>
  <AgentChatWorkspace
    :sessions="sessionsApi"
    :runs="runsApi"
    :proposals="proposalsApi"
    :socket-url="socketUrl"
    i18n-namespace="gardener"
    theme-storage-key="crt-theme-gardener"
    scope-key="gardener"
  >
    <template #header>
      <UiScreenHeader
        :eyebrow="$t('gardener.eyebrow')"
        :title="$t('gardener.title')"
        :subtitle="$t('gardener.subtitle')"
      />
    </template>
  </AgentChatWorkspace>
</template>
