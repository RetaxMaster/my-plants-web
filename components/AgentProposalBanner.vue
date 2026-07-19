<script setup lang="ts">
import type { DoctorProposal, DoctorProposalOperationType } from '../types/api';

// THE CONSENT SURFACE (spec §5.4).
//
// The rule that governs every line below: the owner consents to the SERVER's operation list, never to the
// agent's prose. `summary` is displayed as an attributed caption and has no influence on what is shown —
// a proposal whose summary says "just a nickname tweak" over an operation that deletes an entry renders
// exactly the same list as an honest one. If prose could shape this surface, the platform's approval gate
// would collapse into a prompt gate, which is the failure the whole feature exists to prevent.
//
// This component performs NO I/O. It emits intent and the parent owns every request, which is what keeps
// the consent surface a pure function of server data.
const props = defineProps<{
  proposal: DoctorProposal;
  // The consumer's i18n namespace ('diagnose'); every string resolves as `${ns}.<suffix>`, exactly like
  // the shared <AgentChat> and <AgentChatWorkspace> do.
  i18nNamespace: string;
  // True while a resolution request is in flight — the actions lock so a double-click cannot fire twice.
  busy?: boolean;
  // A translated failure line (an expired/already-resolved conflict, or a network failure). Rendered
  // INSIDE the banner: an approve click that does nothing visible is exactly the silent no-op §5.3.1 forbids.
  errorMessage?: string | null;
}>();

defineEmits<{
  (e: 'approve'): void;
  (e: 'decline'): void;
  (e: 'dismiss'): void;
}>();

const { t } = useI18n();
const tns = (key: string) => t(`${props.i18nNamespace}.${key}`);

// The wire discriminant carries a dot ('profile.update'), and a dot inside an i18n leaf key is read by
// vue-i18n as a nesting separator — so it would never resolve. Map to flat camelCase keys instead.
// The locale parity test pins this map's key set against the API's operation union: a ninth operation
// type fails a test rather than reaching the owner as a raw key path.
const OP_TYPE_KEY: Record<DoctorProposalOperationType, string> = {
  'profile.update': 'profileUpdate',
  'plant.update': 'plantUpdate',
  'progress.create': 'progressCreate',
  'progress.update': 'progressUpdate',
  'progress.delete': 'progressDelete',
  'frequency.set': 'frequencySet',
  'frequency.clear': 'frequencyClear',
  'care.done': 'careDone',
};

// A proposal that destroys something is a stronger warning than one that only edits fields. The colour is
// a signal, not decoration — the two cases must not look alike.
const hasDestructive = computed(() => props.proposal.operations.some((op) => op.destructive));
</script>

<template>
  <UiAlert
    :color="hasDestructive ? 'red' : 'amber'"
    icon="shield-exclamation"
    :title="tns('proposal.title')"
    class="mp-proposal"
  >
    <p class="mp-proposal__hint">{{ tns('proposal.reviewHint') }}</p>

    <!-- THE CONSENT SURFACE. Everything here is server-rendered: the operation labels, the target labels
         and the before/after values. The agent's prose is a caption below, never this. -->
    <ol class="mp-proposal__ops">
      <li v-for="(op, i) in proposal.operations" :key="`${op.type}-${i}`" class="mp-proposal__op">
        <div class="mp-proposal__op-head">
          <span class="mp-proposal__op-type">{{ tns(`proposal.opType.${OP_TYPE_KEY[op.type]}`) }}</span>
          <span class="mp-proposal__op-target">{{ op.targetLabel }}</span>
        </div>
        <UiChangeList
          v-if="op.changes.length"
          :changes="op.changes"
          :empty-value="tns('proposal.emptyValue')"
          :stale-label="tns('proposal.staleNote')"
        />
        <!-- Attached to the OPERATION that destroys, not to the banner: a warning shown on proposals that
             only edit fields would train the owner to scroll past it. -->
        <p v-if="op.destructive" class="mp-proposal__destructive">{{ tns('proposal.destructive') }}</p>
      </li>
    </ol>

    <p v-if="proposal.summary" class="mp-proposal__summary">
      <span class="mp-proposal__summary-label">{{ tns('proposal.agentSays') }}:</span>
      {{ proposal.summary }}
    </p>

    <p v-if="errorMessage" class="mp-proposal__error" role="alert">{{ errorMessage }}</p>

    <div class="mp-proposal__actions">
      <UiButton size="sm" variant="solid" color="neutral" :disabled="busy" @click="$emit('approve')">
        {{ busy ? tns('proposal.applying') : tns('proposal.approve') }}
      </UiButton>
      <UiButton size="sm" variant="soft" color="neutral" :disabled="busy" @click="$emit('decline')">
        {{ tns('proposal.decline') }}
      </UiButton>
      <!-- Dismiss is NOT a decline (§5.3): it only closes the banner. The proposal stays PENDING and the
           server expires it when the next run starts. Nothing is sent here. -->
      <UiButton size="sm" variant="ghost" color="neutral" :disabled="busy" @click="$emit('dismiss')">
        {{ tns('proposal.dismiss') }}
      </UiButton>
    </div>
  </UiAlert>
</template>

<style scoped>
.mp-proposal {
  flex: none;
}

.mp-proposal__hint {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--text-body);
}

.mp-proposal__ops {
  list-style: none;
  margin: var(--space-3) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.mp-proposal__op {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding-left: var(--space-3);
  border-left: 2px solid var(--border-subtle);
  min-width: 0;
}

.mp-proposal__op-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}

.mp-proposal__op-type {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-strong);
}

.mp-proposal__op-target {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.mp-proposal__destructive {
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--care-poor-text);
}

.mp-proposal__summary {
  margin: var(--space-3) 0 0;
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--text-muted);
  font-style: italic;
  overflow-wrap: anywhere;
}

.mp-proposal__summary-label {
  font-style: normal;
  font-weight: var(--weight-semibold);
}

.mp-proposal__error {
  margin: var(--space-3) 0 0;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--care-poor-text);
}

.mp-proposal__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
</style>
