<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
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

// --- The overflow affordance -------------------------------------------------------------------------
//
// This banner sizes to its content whenever the column can hold it, and only scrolls when it genuinely
// cannot. But a scroll region the owner cannot SEE is a scroll region that does not exist: the change
// list, the destructive-delete warning and the doctor's note would sit below an unmarked fold on the one
// surface where "I didn't see it" is not an acceptable outcome. A rendered-but-invisible warning is worse
// than no warning, because it makes the record say the owner was told.
//
// So the overflow is announced explicitly rather than left to a scrollbar — scrollbars are hidden by
// default on macOS and on every touch device, i.e. exactly the mobile case where the clipping is worst.
// The three ACTION BUTTONS are deliberately outside this region (see the template) and are therefore
// always visible; this cue is only about the content above them.
const scrollRegion = ref<HTMLElement | null>(null);
const hasMoreBelow = ref(false);

function syncOverflow() {
  const el = scrollRegion.value;
  if (!el) { hasMoreBelow.value = false; return; }
  // 2px of slack: sub-pixel layout rounding otherwise leaves the cue stuck on at the very bottom, which
  // trains the owner to ignore it.
  hasMoreBelow.value = el.scrollHeight - el.clientHeight - el.scrollTop > 2;
}

// A ResizeObserver, not a one-shot measurement on mount: the content's height changes when the viewport
// rotates, when the column is re-flowed by a sibling appearing, and when a stale marker arrives on a
// refetch. Observing BOTH the region and its content is what catches the case where the region's own box
// is unchanged but what it holds grew.
let observer: ResizeObserver | null = null;
onMounted(() => {
  syncOverflow();
  if (typeof ResizeObserver === 'undefined') return;
  observer = new ResizeObserver(syncOverflow);
  const el = scrollRegion.value;
  if (el) {
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
  }
});
onBeforeUnmount(() => { observer?.disconnect(); observer = null; });

// A NEW proposal replaces the content wholesale, so the cue must be recomputed — and the region scrolled
// back to the top, or the owner would meet a different request already scrolled into its middle.
watch(() => props.proposal.id, async () => {
  await nextTick();
  scrollRegion.value?.scrollTo({ top: 0 });
  syncOverflow();
});
</script>

<template>
  <UiAlert
    :color="hasDestructive ? 'red' : 'amber'"
    icon="shield-exclamation"
    :title="tns('proposal.title')"
    class="mp-proposal"
  >
    <!-- The SCROLLING region holds everything the owner READS. The action buttons sit outside it, below,
         so a proposal too tall for the column can never hide the controls that resolve it — the failure
         this structure exists to prevent. `@scroll` keeps the cue honest as the owner moves through. -->
    <div ref="scrollRegion" class="mp-proposal__scroll" @scroll="syncOverflow">
      <div>
        <p class="mp-proposal__hint">{{ tns('proposal.reviewHint') }}</p>

        <!-- THE CONSENT SURFACE. Everything here is server-rendered: the operation labels, the target
             labels and the before/after values. The agent's prose is a caption below, never this. -->
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
            <!-- Attached to the OPERATION that destroys, not to the banner: a warning shown on proposals
                 that only edit fields would train the owner to scroll past it. -->
            <p v-if="op.destructive" class="mp-proposal__destructive">{{ tns('proposal.destructive') }}</p>
          </li>
        </ol>

        <p v-if="proposal.summary" class="mp-proposal__summary">
          <span class="mp-proposal__summary-label">{{ tns('proposal.agentSays') }}:</span>
          {{ proposal.summary }}
        </p>
      </div>
    </div>

    <!-- The cue. `data-scroll-affordance` is a stable test hook: the browser check asserts on it, because
         "the owner can tell there is more" is a claim no unit test can make. `aria-hidden` because the
         scroll region itself is already reachable and announced by the screen reader. -->
    <p v-if="hasMoreBelow" class="mp-proposal__more" data-scroll-affordance aria-hidden="true">
      {{ tns('proposal.moreBelow') }}
    </p>

    <!-- OUTSIDE the scroll region, and outside it deliberately: an error explaining that an approve just
         failed must not be something the owner has to scroll to find. -->
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
/* The banner lives inside a FIXED-HEIGHT, `overflow: hidden` chat panel, and a real proposal is tall —
 * measured at 692px against a 708px panel. `flex: none` therefore did not protect it, it protected the
 * WRONG thing: the column overflowed, and the composer below was pushed out of the panel and clipped
 * away completely.
 *
 * So the banner takes what it can and scrolls the REST internally rather than pushing anything out of the
 * card. `min-height: 0` is what actually permits the shrink (a flex item's automatic minimum size is its
 * content, so without it the item refuses to shrink and `overflow-y` never engages).
 *
 * Nothing about the consent decision is hidden by this: the operation list, the agent's caption, any
 * error line and all three buttons stay inside ONE scrollable region, so scrolling reaches every one of
 * them. What it removes is the previous behaviour, where the buttons were rendered outside the visible
 * card and could not be reached at all. */
/* The banner SIZES TO ITS CONTENT and only scrolls when the column genuinely cannot hold it —
 * `flex: 0 1 auto` is exactly that (take what you need, give it back only under pressure).
 *
 * What changed after the first attempt: the scrolling moved OFF this element and onto an inner region, so
 * the action buttons live outside anything that can clip them. The first version made the whole banner a
 * scroll box, which measured as: the simplest possible proposal (one nickname change) showing 203px of
 * 325px on a phone, with all three buttons — and on a multi-operation proposal the destructive-delete
 * warning — below an unmarked fold. A consent surface that can hide its own warning and its own controls
 * is not a consent surface.
 *
 * `overflow: hidden` here (not `visible`) is the same guard the console track needed: it stops the inner
 * region from painting outside the banner's own box when the flex shrink is severe. */
/* ⚠️ NO `min-height: 0` HERE, DELIBERATELY — and this is the subtle half of the degraded-path fix.
 *
 * `min-height: 0` waives a flex item's AUTOMATIC MINIMUM SIZE, i.e. its promise not to shrink below what
 * its own content needs. Combined with the `overflow: hidden` below, that let this banner be shrunk to
 * 203px while its content minimum was 302px — and the 99px it clipped were the action buttons. Measured
 * on the degraded path at 390x844: the reading region correctly held its 128px floor, and the buttons
 * were cut off anyway, because the floor was being enforced INSIDE a box that had been allowed to shrink
 * beneath it.
 *
 * ⚠️ AND NO `overflow: hidden` EITHER — the two are the same mistake wearing different clothes. A flex
 * item whose `overflow` is anything but `visible` ALSO gets an automatic minimum size of zero, by the
 * same rule. So clipping this box silently re-granted permission to shrink beneath its content: removing
 * `min-height: 0` alone changed nothing, and the buttons stayed cut off at exactly 203px of a 302px
 * minimum. Both had to go together.
 *
 * The clip was there to stop the inner region painting outside this box under a severe shrink. That job
 * now belongs to the floor on `.mp-proposal__scroll` plus this element's restored automatic minimum: the
 * box can no longer BE smaller than its content, so there is nothing to clip. The column overflows
 * instead, and `.mp-kchat`'s `overflow-y` turns that into a scroll — "it does not fit" must resolve to
 * "the owner scrolls", never to "the controls are silently cut off". */
.mp-proposal {
  flex: 0 1 auto;
}

/* UiAlert lays its icon and body out as a ROW. For the body to become the vertical scroll+footer chain,
 * it has to be a full-height flex column that is allowed to shrink — `min-height: 0` is what actually
 * permits that, since a flex item's automatic minimum size is its content. Overridden from here rather
 * than changed in UiAlert: this is a requirement of THIS banner, and every other alert in the app is a
 * short block that must keep sizing to its content. */
.mp-proposal :deep(.mp-alert) {
  min-height: 0;
  overflow: hidden;
}

/* Same reasoning as the banner root: NO `min-height: 0`. The body must carry its children's minimum
 * upward — reading floor + cue + actions — or the banner root's automatic minimum computes as zero and
 * the guard above is defeated one level down. */
.mp-proposal :deep(.mp-alert__body) {
  flex: 1 1 auto;
}

/* A FLOOR THAT IS NOT CURRENTLY LOAD-BEARING — kept deliberately, and labelled so nobody mistakes it for
 * the guard that is.
 *
 * Mutation-tested: setting this back to `min-height: 0` changes nothing today, because the banner root
 * above no longer shrinks below its content, so this region is never squeezed in the first place. What
 * actually fixed the degraded path was removing that root's `min-height: 0` AND its `overflow: hidden`.
 *
 * It stays because it is the floor for the failure that has now happened twice — a `min-height: 0` flex
 * item being the thing destroyed when the budget does not fit (round 1: the transcript console collapsed
 * to 0px; round 2: this region collapsed to 17px of 1018px, leaving the owner a live "Approve changes"
 * button and not one word of the change list). If anything ever constrains the banner root again, this is
 * what stops that from being total. It is insurance, not the mechanism — do not read its presence as
 * proof the surface is safe. */
.mp-proposal__scroll {
  flex: 1 1 auto;
  min-height: 8rem;
  overflow-y: auto;
  /* Keep the scrollbar's space reserved so the content does not reflow the moment the region becomes
     scrollable, and show a thin one where the platform draws them at all. The visible cue below is what
     carries the message on the platforms that hide scrollbars entirely. */
  scrollbar-width: thin;
  scrollbar-gutter: stable;
}

/* The cue. Sized and coloured to read as an instruction, not as decoration — it is the only thing telling
   the owner that the change they are approving may not be the only one on screen. */
.mp-proposal__more {
  flex: none;
  margin: var(--space-2) 0 0;
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  font-weight: var(--weight-semibold);
  color: var(--care-caution-text);
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
  flex: none;
  margin: var(--space-3) 0 0;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--care-poor-text);
}

.mp-proposal__actions {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
</style>
