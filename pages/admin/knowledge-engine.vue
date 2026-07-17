<script setup lang="ts">
const { t } = useI18n();
const { user } = useUserSession();
if (user.value?.role !== 'ADMIN') {
  throw createError({ statusCode: 404, statusMessage: t('admin.pageNotFound') });
}

useHead(() => ({ title: t('meta.knowledgeEngine.title') }));
useSeoMeta({ description: () => t('meta.knowledgeEngine.description') });

// The session list, selection, delete, panel, layout and its CSS all live in the SHARED
// <AgentChatWorkspace> — this page only supplies the KE dependencies + its admin header.
const sessionsApi = useKnowledgeChatSessions();
const runsApi = useKnowledgeChatRuns();
const chatSocketUrl = useRuntimeConfig().public.knowledgeChatSocketUrl;
</script>

<template>
  <AgentChatWorkspace
    :sessions="sessionsApi"
    :runs="runsApi"
    :socket-url="chatSocketUrl"
    i18n-namespace="knowledgeEngine"
    theme-storage-key="crt-theme-knowledge"
    scope-key="knowledge"
  >
    <template #header>
      <UiScreenHeader :eyebrow="$t('admin.eyebrow')" :title="$t('admin.keTitle')" :subtitle="$t('admin.keSubtitle')" />
    </template>
  </AgentChatWorkspace>
</template>
