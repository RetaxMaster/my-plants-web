import type { TaskCode } from '~/utils/tasks';
import { TASK_LABELS } from '~/utils/tasks';

/**
 * Icon aliases (AppIcon / heroicons names) for each care task.
 * Sourced from the design system's TASK_ICONS map. The labels come from
 * utils/tasks.ts — single source of truth, never forked here.
 */
export const TASK_ICONS: Record<TaskCode, string> = {
  WATER: 'beaker',
  FERTILIZE: 'sparkles',
  REPOT: 'archive-box',
  ROTATE: 'arrow-path',
  CLEAN_LEAVES: 'sun',
  MIST: 'cloud',
  PROGRESS: 'camera',
};

export function useTaskMeta() {
  return { TASK_LABELS, TASK_ICONS };
}
