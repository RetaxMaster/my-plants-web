<script setup lang="ts">
import AppIcon from './AppIcon.vue';
import Badge from './Badge.vue';
import Button from './Button.vue';
import type { TaskCode } from '~/utils/tasks';
import { dueState } from '~/utils/tasks';
import { ymdToLocalDate } from '~/utils/localDate';
import { useTaskMeta } from '~/composables/useTaskMeta';

defineOptions({ inheritAttrs: false });

const { TASK_ICONS, taskLabel } = useTaskMeta();
const { t, d } = useI18n();

const props = withDefaults(
  defineProps<{
    task: TaskCode;
    status: 'overdue' | 'today' | 'upcoming';
    dueLabel: string;
    withDoneDate?: boolean;
    showInfo?: boolean;
    /** Optional one-line "why this date" explanation, rendered under the task label. */
    explanation?: string;
    /**
     * REPOT only, and DELIBERATELY UNDEFAULTED — see `showEvaluate` below. `undefined` (the prop simply
     * omitted by the caller) means that caller has NOT opted into the verdict-driven state machine and
     * gets the classic Done | Postpone unconditionally, exactly as before Task 27 — this is what keeps
     * `PlantDetail.vue`'s own REPOT card working unchanged until Task 28 explicitly wires it in. Only a
     * caller that EXPLICITLY passes `null` (no pending verdict yet) or a verdict string opts in: `null` ->
     * the card shows "time to evaluate"; `'REPOT'` -> the uncertainty is resolved and the classic
     * Done | Postpone returns, now correct: Done means "I repotted it" and Postpone means "yes, but I
     * can't right now".
     */
    pendingVerdict?: 'REPOT' | 'RE-EVALUATE' | null;
    /**
     * ADDITIVE, optional, and only meaningful alongside `pendingVerdict: 'RE-EVALUATE'` — the
     * `reevaluateOn` (YYYY-MM-DD) of that pending evaluation. V13: a RE-EVALUATE verdict means "come back
     * on this date", so `showEvaluate` must NOT offer the affordance again before that date arrives — the
     * server (`repot-evaluation.write-core.ts`) 409s a re-evaluation attempted before `reevaluateOn`, and
     * the card was inviting exactly that rejected action. Left undefined/null (should not happen for a
     * real RE-EVALUATE row, but data is data) the date is treated as ALREADY ARRIVED — see
     * `reevaluateArrived` below — so missing data never blocks the owner.
     */
    pendingReevaluateOn?: string | null;
  }>(),
  { withDoneDate: false, showInfo: false },
);

const emit = defineEmits<{
  done: [{ task: TaskCode; occurredOn?: string }];
  postpone: [{ task: TaskCode }];
  logProgress: [{ task: TaskCode }];
  info: [{ task: TaskCode }];
  evaluate: [{ task: TaskCode }];
}>();

const doneDate = ref('');

const badgeColor = computed(() =>
  props.status === 'overdue' ? 'red' : props.status === 'today' ? 'amber' : 'neutral',
);

// REPOT stops offering a bare Done/Postpone until a verdict exists — but ONLY for a caller that has
// explicitly opted in by passing `pendingVerdict` at all (even `null`). A caller that omits the prop
// entirely (`undefined`) has not migrated to the state machine yet and keeps today's behavior — this is
// what stops `PlantDetail.vue`'s own, not-yet-migrated REPOT card from silently losing its Done/Postpone
// buttons the moment this component's default changes (a real regression a code review caught: the old
// unconditional `pendingVerdict: null` default made EVERY consumer, migrated or not, show "time to
// evaluate" with no way to complete or postpone a repot from the plant-detail page).
// V13 fix: a pending 'RE-EVALUATE' verdict whose `reevaluateOn` has NOT arrived yet must not offer the
// evaluate affordance — the server 409s that exact attempt ("The re-evaluation date has not arrived
// yet."). "Arrived" is answered on the OWNER's local calendar day via `dueState` (the same helper
// `dueLabel`/`dueLabelLong` use elsewhere), never a UTC-derived comparison. Missing `reevaluateOn` (should
// not happen for a real RE-EVALUATE row) is treated as arrived — blocking the owner on absent data is the
// worse failure than occasionally re-offering the affordance a beat early.
const reevaluateArrived = computed(() => {
  if (!props.pendingReevaluateOn) return true;
  const kind = dueState(props.pendingReevaluateOn).kind;
  return kind === 'overdue' || kind === 'today';
});

const showEvaluate = computed(() => {
  if (props.task !== 'REPOT' || props.pendingVerdict === undefined) return false;
  if (props.pendingVerdict === null) return true;
  if (props.pendingVerdict === 'REPOT') return false;
  return reevaluateArrived.value; // 'RE-EVALUATE': only once its date has arrived
});

// The card's replacement affordance while a 'RE-EVALUATE' verdict is pending and not yet due: instead of a
// disabled button with no explanation, the owner sees what happened and when to look again.
const reevaluatePending = computed(
  () => props.task === 'REPOT' && props.pendingVerdict === 'RE-EVALUATE' && !reevaluateArrived.value,
);
const reevaluateNoticeDate = computed(() =>
  props.pendingReevaluateOn ? d(ymdToLocalDate(props.pendingReevaluateOn), 'short') : '',
);

const onDone = () => emit('done', { task: props.task, occurredOn: doneDate.value || undefined });
const onPostpone = () => emit('postpone', { task: props.task });
const onLogProgress = () => emit('logProgress', { task: props.task });
const onInfo = () => emit('info', { task: props.task });
const onEvaluate = () => emit('evaluate', { task: props.task });
</script>

<template>
  <div class="mp-taskrow" v-bind="$attrs">
    <div class="mp-taskrow__meta">
      <AppIcon :name="TASK_ICONS[task]" :size="18" class="mp-taskrow__icon" />
      <span class="mp-taskrow__label">{{ taskLabel(task) }}</span>
      <Badge :color="badgeColor" size="xs">{{ dueLabel }}</Badge>
      <button
        v-if="showInfo"
        type="button"
        class="mp-taskrow__info"
        :aria-label="t('taskInfo.aria')"
        @click="onInfo"
      >
        <AppIcon name="information-circle" :size="16" />
      </button>
    </div>
    <p v-if="explanation" class="mp-taskrow__explanation">{{ explanation }}</p>
    <div class="mp-taskrow__actions">
      <template v-if="task === 'PROGRESS'">
        <Button size="xs" color="primary" icon="camera" @click="onLogProgress">{{ taskLabel(task) }}</Button>
      </template>
      <template v-else-if="showEvaluate">
        <Button size="xs" color="primary" icon="magnifying-glass" @click="onEvaluate">
          {{ t('repotEval.cardAction') }}
        </Button>
      </template>
      <template v-else-if="reevaluatePending">
        <span class="mp-taskrow__pending-note">
          {{ t('repotEval.pendingReevaluateNote', { date: reevaluateNoticeDate }) }}
        </span>
      </template>
      <template v-else>
        <input
          v-if="withDoneDate"
          v-model="doneDate"
          type="date"
          class="mp-taskrow__date"
          :aria-label="t('progress.doneDateAria')"
        />
        <Button size="xs" color="primary" icon="check" @click="onDone">{{ t('common.done') }}</Button>
        <Button
          v-if="status !== 'upcoming'"
          size="xs"
          color="neutral"
          variant="ghost"
          icon="clock"
          @click="onPostpone"
        >
          {{ t('common.postpone') }}
        </Button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.mp-taskrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-3) 0;
  flex-wrap: wrap;
}

.mp-taskrow__meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.mp-taskrow__icon {
  color: var(--text-muted);
  flex: none;
}

.mp-taskrow__label {
  font-family: var(--font-sans);
  font-weight: var(--weight-semibold);
  font-size: var(--text-sm);
  color: var(--text-strong);
}

.mp-taskrow__explanation {
  flex-basis: 100%;
  margin: 0;
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.mp-taskrow__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.mp-taskrow__pending-note {
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.mp-taskrow__date {
  height: 28px;
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--text-strong);
  background: var(--surface-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 0 var(--space-2);
  outline: none;
}

.mp-taskrow__date:focus {
  border-color: var(--border-brand);
  box-shadow: var(--shadow-focus);
}

.mp-taskrow__info {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: none;
  padding: 0;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  transition: color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}

.mp-taskrow__info:hover {
  color: var(--text-muted);
  background: var(--surface-sunken);
}

.mp-taskrow__info:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
}
</style>
