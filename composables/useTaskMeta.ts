import type { TaskCode, CareActionTask, DueState } from '~/utils/tasks';

/**
 * Icon aliases (AppIcon / heroicons names) for each care task. Icon names are not
 * user-facing copy, so they stay here as data (not in the i18n catalogues).
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

type HealthCode = 'SICK' | 'POOR' | 'GOOD' | 'EXCELLENT';

/**
 * Single source of task/health/due WORDING. Every label is produced from the i18n
 * catalogues via t(); no component holds an English label map (fork-proof, spec §6.2/§6.4).
 * Uses STATIC key roots + a code segment resolved by t() so the production build stays
 * CSP-clean (no runtime-compiled dynamic message strings).
 */
export function useTaskMeta() {
  const { t } = useI18n();

  const taskLabel = (code: TaskCode) => t(`tasks.labels.${code}`);
  const taskPastLabel = (code: CareActionTask) => t(`tasks.past.${code}`);
  const healthLabel = (code: HealthCode | string) => t(`health.${code}`);

  // Short, Today-page phrasing: Overdue / Today / Tomorrow / In N days.
  const dueLabel = (s: DueState): string => {
    if (s.kind === 'overdue') return t('due.short.overdue');
    if (s.kind === 'today') return t('due.short.today');
    if (s.kind === 'tomorrow') return t('due.short.tomorrow');
    return t('due.short.inDays', { n: s.days }, s.days);
  };

  // Long, detail-page phrasing: Overdue by N days / Due today / Due tomorrow / Due in N days.
  const dueLabelLong = (s: DueState): string => {
    if (s.kind === 'overdue') return t('due.long.overdue', { n: s.days }, s.days);
    if (s.kind === 'today') return t('due.long.today');
    if (s.kind === 'tomorrow') return t('due.long.tomorrow');
    return t('due.long.inDays', { n: s.days }, s.days);
  };

  return { TASK_ICONS, taskLabel, taskPastLabel, healthLabel, dueLabel, dueLabelLong };
}
