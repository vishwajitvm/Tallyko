/**
 * Staff, roles & permissions, staff performance, audit log and plan modules.
 * Shapes mirror backend/app/api/access.py, admin.py (staff + modules), reports.py (/reports/staff, /reports/me).
 */
import { api } from './client';
import type { TableInfo } from './types';

// --- Permissions & roles -----------------------------------------------------------------------------------

export interface PermissionDef {
  code: string;
  description: string;
  /** Module the permission belongs to (null = always available) */
  feature: string | null;
  /** False when the business's plan lacks (or the owner hid) that module */
  available: boolean;
}

export interface PermissionGroup {
  group: string;
  permissions: PermissionDef[];
}

export interface RoleDef {
  id: string;
  key: string;
  name: string;
  description: string | null;
  permissions: string[];
  is_system: boolean;
  /** False only for the owner role (always full access) */
  editable: boolean;
  /** Active staff with this role */
  staff_count: number;
}

export interface RoleInput {
  name: string;
  description?: string | null;
  permissions: string[];
}

// --- Staff --------------------------------------------------------------------------------------------------

export interface StaffAccount {
  id: string;
  email: string;
  full_name: string | null;
  /** Any role key: built-in (owner, manager, cashier, waiter, kitchen) or a custom role */
  role: string;
  role_name: string;
  is_active: boolean;
  location_id: string | null;
}

export interface StaffCreateInput {
  full_name: string;
  email: string;
  phone?: string | null;
  role: string;
  password: string;
}

export interface StaffUpdateInput {
  full_name?: string;
  role?: string;
  is_active?: boolean;
  password?: string;
}

// --- Performance --------------------------------------------------------------------------------------------

export interface StaffPerformance {
  staff_id: string;
  name: string;
  role?: string | null;
  /** Completed orders taken (waiter on the bill) */
  orders: number;
  sales: number;
  average_bill: number;
  tables_served: number;
  covers: number;
  items: number;
  /** Bills this person closed (collected payment) */
  bills_settled: number;
  collected: number;
  cancelled: number;
}

// --- Audit log ----------------------------------------------------------------------------------------------

export interface AuditEntry {
  id: string;
  action: string;
  label: string;
  actor_name: string | null;
  actor_staff_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  summary: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditPage {
  total: number;
  items: AuditEntry[];
}

export interface AuditQuery {
  action?: string;
  staff_id?: string;
  /** ISO timestamps in UTC (the server compares them without converting time zones) */
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}

// --- Plan modules -------------------------------------------------------------------------------------------

export interface ModuleInfo {
  key: string;
  name: string;
  in_plan: boolean;
  hidden: boolean;
  enabled: boolean;
}

export interface ModulesInfo {
  plan_key: string;
  plan_name: string;
  limits: Record<string, number | null>;
  modules: ModuleInfo[];
}

// --- Tables (waiter assignment) -----------------------------------------------------------------------------

export interface AssignableTable extends TableInfo {
  /** Waiter / captain who looks after this table. Undefined when the server doesn't support assignment yet. */
  assigned_staff_id?: string | null;
}

const enc = encodeURIComponent;

/** Named `teamApi` so it doesn't clash with `accessApi.me()` in endpoints.ts. */
export const teamApi = {
  permissions: () => api.get<PermissionGroup[]>('/access/permissions'),

  roles: () => api.get<RoleDef[]>('/roles'),
  createRole: (body: RoleInput) => api.post<RoleDef>('/roles', body),
  updateRole: (key: string, body: Partial<RoleInput>) => api.put<RoleDef>(`/roles/${enc(key)}`, body),
  resetRole: (key: string) => api.post<RoleDef>(`/roles/${enc(key)}/reset`),
  deleteRole: (key: string) => api.delete<{ success: boolean }>(`/roles/${enc(key)}`),

  staff: () => api.get<StaffAccount[]>('/staff'),
  createStaff: (body: StaffCreateInput) => api.post<StaffAccount>('/staff', body),
  updateStaff: (id: string, body: StaffUpdateInput) => api.put<StaffAccount>(`/staff/${enc(id)}`, body),

  staffPerformance: (date_from?: string, date_to?: string) => api.get<StaffPerformance[]>('/reports/staff', { query: { date_from, date_to } }),
  myPerformance: (date_from?: string, date_to?: string) => api.get<StaffPerformance>('/reports/me', { query: { date_from, date_to } }),

  audit: (q: AuditQuery = {}) => api.get<AuditPage>('/audit', { query: { ...q } }),

  modules: () => api.get<ModulesInfo>('/modules'),
  updateModules: (hidden: string[]) => api.put<ModulesInfo>('/modules', { hidden }),

  tables: () => api.get<AssignableTable[]>('/tables'),
  assignTable: (tableId: string, staffId: string | null) => api.put<AssignableTable>(`/tables/${enc(tableId)}`, { assigned_staff_id: staffId }),
};
