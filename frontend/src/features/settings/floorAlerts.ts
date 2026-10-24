/**
 * Settings → Floor alerts: the minutes after which Tables, Kitchen and Online orders turn amber / red
 * (business setting `ops_thresholds`, backend app/api/admin.py). Pure form logic, unit-tested.
 */
import type { OpsThresholds } from '@/api/types';

export const OPS_DEFAULTS: OpsThresholds = {
  table_amber_min: 45, table_red_min: 75, kitchen_amber_min: 10, kitchen_red_min: 20, online_wait_min: 3,
};

export type OpsKey = keyof OpsThresholds;
export type OpsForm = Record<OpsKey, string>;
export type OpsErrors = Partial<Record<OpsKey, string>>;

export const OPS_KEYS: OpsKey[] = ['table_amber_min', 'table_red_min', 'kitchen_amber_min', 'kitchen_red_min', 'online_wait_min'];

export function opsFormOf(t: Partial<OpsThresholds> | null | undefined): OpsForm {
  const merged = { ...OPS_DEFAULTS, ...(t ?? {}) };
  return Object.fromEntries(OPS_KEYS.map((k) => [k, String(merged[k])])) as OpsForm;
}

const num = (v: string): number | null => (/^\d{1,3}$/.test(v.trim()) ? Number(v.trim()) : null);

/** Same rules as the server: whole minutes 1–600, red after amber. */
export function validateOps(form: OpsForm): OpsErrors {
  const errors: OpsErrors = {};
  for (const k of OPS_KEYS) {
    const n = num(form[k]);
    if (n === null || n < 1 || n > 600) errors[k] = 'Enter 1 to 600 minutes';
  }
  for (const [amber, red] of [['table_amber_min', 'table_red_min'], ['kitchen_amber_min', 'kitchen_red_min']] as const) {
    if (errors[amber] || errors[red]) continue;
    if (num(form[red])! <= num(form[amber])!) errors[red] = 'Red must come after amber';
  }
  return errors;
}

export function opsValues(form: OpsForm): OpsThresholds {
  return Object.fromEntries(OPS_KEYS.map((k) => [k, Number(form[k].trim())])) as unknown as OpsThresholds;
}
