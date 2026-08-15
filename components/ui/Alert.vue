<script setup lang="ts">
import AppIcon from './AppIcon.vue';

defineOptions({ inheritAttrs: false });

type Color = 'amber' | 'red' | 'green';

const props = withDefaults(
  defineProps<{
    color?: Color;
    title?: string;
    description?: string;
    icon?: string;
    /** Opt-in: renders `role="alert" aria-live="assertive"` on the root so screen readers announce this
     * instance the moment it appears. Defaults to false so every PRE-EXISTING call site of this shared
     * primitive keeps rendering with neither attribute, byte-identical to before this prop existed — only
     * the few call sites that are genuinely a standalone, non-nested announcement (never wrapping
     * interactive controls or another live region) should opt in. */
    announce?: boolean;
  }>(),
  {
    color: 'amber',
    announce: false,
  },
);

const defaultIcons: Record<Color, string> = {
  green: 'check-circle',
  amber: 'exclamation-triangle',
  red: 'x-circle',
};

// icon === '' explicitly hides the icon; undefined uses the per-color default.
const resolvedIcon = computed(() =>
  props.icon === undefined ? defaultIcons[props.color] : props.icon || undefined,
);
</script>

<template>
  <div
    :class="['mp-alert', `mp-alert--${color}`]"
    :role="announce ? 'alert' : undefined"
    :aria-live="announce ? 'assertive' : undefined"
    v-bind="$attrs"
  >
    <AppIcon v-if="resolvedIcon" :name="resolvedIcon" :size="20" class="mp-alert__icon" />
    <div class="mp-alert__body">
      <div v-if="title" class="mp-alert__title">{{ title }}</div>
      <div v-if="description" class="mp-alert__description">{{ description }}</div>
      <slot />
    </div>
  </div>
</template>

<style scoped>
.mp-alert {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid transparent;
}

.mp-alert__icon {
  margin-top: 1px;
  flex: none;
}

.mp-alert__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  /* CROSS-AXIS: CONTENT WIDTH, NEVER FULL WIDTH (2026-08-15).
     `stretch` is the flex default, and it made every control a call site puts in this slot span the whole
     alert: measured on the running plant page, two "Reintentar" buttons stretched to 650px and 412px
     against an 84px label. A full-bleed, soft-filled button reads as a disabled input rather than an action,
     and a full-bleed `<a>` (the `tooSlowLink` finding) hands the owner a click target the width of the
     page. Fixed HERE, once, because every alert on every surface inherits it — that is what the shared
     component is for.
     Text is unaffected: a paragraph's max-content already exceeds the alert, so `flex-start` still resolves
     to the full width and wraps exactly where it did. The one slot child that genuinely IS a viewport —
     `AgentProposalBanner`'s scroll region — says so locally with its own `align-self: stretch`. */
  align-items: flex-start;
}

.mp-alert__title {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
}

.mp-alert__description {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--text-body);
  line-height: var(--leading-snug);
}

.mp-alert--green {
  background: var(--care-good-bg);
  border-color: color-mix(in oklch, var(--care-good) 35%, transparent);
}
.mp-alert--green .mp-alert__icon {
  color: var(--care-good);
}
.mp-alert--green .mp-alert__title {
  color: var(--care-good-text);
}

.mp-alert--amber {
  background: var(--care-caution-bg);
  border-color: color-mix(in oklch, var(--care-caution) 35%, transparent);
}
.mp-alert--amber .mp-alert__icon {
  color: var(--care-caution);
}
.mp-alert--amber .mp-alert__title {
  color: var(--care-caution-text);
}

.mp-alert--red {
  background: var(--care-poor-bg);
  border-color: color-mix(in oklch, var(--care-poor) 35%, transparent);
}
.mp-alert--red .mp-alert__icon {
  color: var(--care-poor);
}
.mp-alert--red .mp-alert__title {
  color: var(--care-poor-text);
}
</style>
