/** Add / edit a staff login: name, role (built-in or custom), password reset, active switch and table assignment. */
import React, { useMemo, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { errorMessage } from '@/api/client';
import { teamApi, type AssignableTable, type RoleDef, type StaffAccount } from '@/api/access';
import { Badge, Button, Card, Input, Sheet, SwitchRow, Text, toast } from '@/components/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { Callout, FieldRow, copyText, shareText } from '../components';
import { fieldErrorsFrom, generatePassword, validateEmail, validatePassword, validatePhone } from '../validation';
import { canManageRole, roleIcon, roleTone, type StaffCtx } from './shared';

const newPassword = () => generatePassword(10, (n) => Crypto.getRandomBytes(n));

/** Most common first when adding someone; custom roles after the built-in front-line roles. */
const PICKER_FIRST = ['cashier', 'waiter', 'kitchen'];
const PICKER_LAST = ['manager', 'owner'];

export function sortRolesForPicker(roles: RoleDef[]): RoleDef[] {
  const rank = (r: RoleDef) => {
    const first = PICKER_FIRST.indexOf(r.key);
    if (first >= 0) return first;
    const last = PICKER_LAST.indexOf(r.key);
    return last >= 0 ? 100 + last : 50;
  };
  return [...roles].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Roles that take orders can be given tables. */
export function roleTakesOrders(roleKey: string, roles: RoleDef[] | null): boolean {
  if (roleKey === 'owner') return true;
  return !!roles?.find((r) => r.key === roleKey)?.permissions.includes('orders.create');
}

function RolePicker({ value, options, onChange, disabled }: { value: string; options: RoleDef[]; onChange: (key: string) => void; disabled?: boolean }) {
  const { colors, radius } = useTheme();
  return (
    <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel="Role">
      {options.map((r) => {
        const active = r.key === value;
        return (
          <Pressable
            key={r.key}
            disabled={disabled}
            onPress={() => onChange(r.key)}
            accessibilityRole="radio"
            accessibilityState={{ checked: active, disabled }}
            accessibilityLabel={`${r.name}. ${r.description ?? ''}`}
            style={({ hovered }: any) => [
              { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 12, borderWidth: 1.5, borderRadius: radius.md, minHeight: 56 },
              { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primarySoft : hovered ? colors.surfaceSunken : colors.surface },
              disabled && { opacity: 0.6 },
              Platform.OS === 'web' && !disabled ? ({ cursor: 'pointer' } as any) : null,
            ]}
          >
            <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={20} color={active ? colors.primary : colors.textSubtle} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Ionicons name={roleIcon(r.key)} size={15} color={active ? colors.primarySoftText : colors.textMuted} />
                <Text variant="bodyStrong" color={active ? colors.primarySoftText : colors.text}>{r.name}</Text>
                {!r.is_system ? <Badge label="Custom" tone={roleTone(r.key)} /> : null}
              </View>
              {r.description ? <Text variant="small" tone="muted">{r.description}</Text> : null}
              <Text variant="caption" tone="subtle">{r.key === 'owner' ? 'All permissions' : `${r.permissions.length} permission${r.permissions.length === 1 ? '' : 's'}`}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Tables grouped by section as toggle tiles. Tables owned by someone else show their name. */
function TablePicker({ tables, selected, onToggle, staffNames, memberId }: {
  tables: AssignableTable[]; selected: Set<string>; onToggle: (id: string) => void; staffNames: Map<string, string>; memberId: string | null;
}) {
  const { colors, radius } = useTheme();
  const sections = useMemo(() => {
    const map = new Map<string, AssignableTable[]>();
    for (const t of tables) {
      const key = t.section || 'Tables';
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    return [...map.entries()];
  }, [tables]);

  return (
    <View style={{ gap: 12 }}>
      {sections.map(([section, list]) => (
        <View key={section} style={{ gap: 8 }}>
          <Text variant="caption" tone="subtle" style={{ textTransform: 'uppercase' }}>{section}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {list.map((t) => {
              const on = selected.has(t.id);
              const other = !on && t.assigned_staff_id && t.assigned_staff_id !== memberId ? staffNames.get(t.assigned_staff_id) ?? 'Someone else' : null;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => onToggle(t.id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`Table ${t.table_number}${other ? `, assigned to ${other}` : ''}`}
                  style={({ hovered }: any) => [
                    { width: 92, minHeight: 56, paddingHorizontal: 8, paddingVertical: 6, borderRadius: radius.md, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', gap: 2 },
                    { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primarySoft : hovered ? colors.surfaceSunken : colors.surface },
                    Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null,
                  ]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    {on ? <Ionicons name="checkmark-circle" size={14} color={colors.primary} /> : null}
                    <Text variant="bodyStrong" color={on ? colors.primarySoftText : colors.text} numberOfLines={1}>{t.table_number}</Text>
                  </View>
                  <Text variant="caption" tone="subtle" numberOfLines={1}>{other ?? `${t.capacity} seats`}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

export function StaffSheet({ ctx, member, roles, tables, tableAssignSupported, staffNames, onClose, onSaved, onTablesChanged }: {
  ctx: StaffCtx;
  member?: StaffAccount;
  roles: RoleDef[];
  /** null when tables aren't used / the person can't manage them */
  tables: AssignableTable[] | null;
  tableAssignSupported: boolean;
  staffNames: Map<string, string>;
  onClose: () => void;
  onSaved: (m: StaffAccount, password: string | null, created: boolean) => void;
  onTablesChanged: () => void;
}) {
  const editing = !!member;
  const isSelf = !!member && (member.id === ctx.myStaffId || member.email.toLowerCase() === ctx.myEmail);
  const options = useMemo(() => {
    const allowed = sortRolesForPicker(roles.filter((r) => canManageRole(ctx.isOwner, ctx.canManageStaff, r.key)));
    if (member && !allowed.some((r) => r.key === member.role)) {
      const current = roles.find((r) => r.key === member.role);
      if (current) allowed.unshift(current);
    }
    return allowed;
  }, [roles, ctx.isOwner, ctx.canManageStaff, member]);
  const defaultRole = options.find((r) => r.key === 'cashier')?.key ?? options[0]?.key ?? 'cashier';

  const [name, setName] = useState(member?.full_name ?? '');
  const [email, setEmail] = useState(member?.email ?? '');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<string>(member?.role ?? defaultRole);
  const [password, setPassword] = useState(editing ? '' : newPassword());
  const [resetting, setResetting] = useState(!editing);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyActive, setBusyActive] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);

  const initialTables = useMemo(
    () => new Set((tables ?? []).filter((t) => member && t.assigned_staff_id === member.id).map((t) => t.id)),
    [tables, member],
  );
  const [selectedTables, setSelectedTables] = useState<Set<string>>(initialTables);
  const showTables = !!tables && tables.length > 0 && tableAssignSupported && roleTakesOrders(role, roles);
  const tableChanges = showTables ? (tables ?? []).filter((t) => selectedTables.has(t.id) !== initialTables.has(t.id)) : [];

  const errors = {
    full_name: !name.trim() ? 'Name is required.' : name.trim().length > 80 ? 'Use 80 characters or fewer.' : undefined,
    email: editing ? undefined : validateEmail(email, true),
    phone: editing ? undefined : validatePhone(phone),
    password: resetting ? validatePassword(password) : undefined,
  };
  const show = (k: keyof typeof errors) => serverErrors[k] || (submitted ? errors[k] : undefined);
  const invalid = Object.values(errors).some(Boolean);

  const applyTables = async (staffId: string): Promise<string | null> => {
    let failed = 0;
    let lastError = '';
    for (const t of tableChanges) {
      try {
        await teamApi.assignTable(t.id, selectedTables.has(t.id) ? staffId : null);
      } catch (e) {
        failed += 1;
        lastError = errorMessage(e);
      }
    }
    if (tableChanges.length) onTablesChanged();
    return failed ? `${failed} table${failed === 1 ? '' : 's'} could not be updated: ${lastError}` : null;
  };

  const submit = async () => {
    setSubmitted(true);
    setFormError(null);
    if (invalid) return;
    setSaving(true);
    try {
      if (!member) {
        const created = await teamApi.createStaff({
          full_name: name.trim(), email: email.trim().toLowerCase(), phone: phone.trim() ? phone.replace(/-/g, ' ').trim() : null, role, password,
        });
        const tableError = await applyTables(created.id);
        if (tableError) toast.warning(tableError);
        toast.success(`${created.full_name ?? created.email} can now sign in`);
        onSaved(created, password, true);
        return;
      }
      const body: { full_name?: string; role?: string; password?: string } = {};
      if (name.trim() !== (member.full_name ?? '')) body.full_name = name.trim();
      if (role !== member.role) body.role = role;
      if (resetting && password) body.password = password;
      if (Object.keys(body).length === 0 && tableChanges.length === 0) {
        onClose();
        return;
      }
      const saved = Object.keys(body).length ? await teamApi.updateStaff(member.id, body) : member;
      const tableError = await applyTables(member.id);
      if (tableError) toast.warning(tableError);
      else toast.success(body.password ? 'Password reset' : 'Staff details saved');
      onSaved(saved, body.password ?? null, false);
    } catch (e) {
      setServerErrors(fieldErrorsFrom(e));
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const setActive = async (active: boolean) => {
    if (!member) return;
    setBusyActive(true);
    try {
      const saved = await teamApi.updateStaff(member.id, { is_active: active });
      toast.success(active ? 'Login reactivated' : 'Login deactivated');
      setConfirmingDeactivate(false);
      onSaved(saved, null, false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyActive(false);
    }
  };

  const selectedRole = roles.find((r) => r.key === role);

  return (
    <Sheet
      visible
      onClose={onClose}
      title={editing ? member!.full_name || member!.email : 'Add staff'}
      subtitle={editing ? member!.email : 'They sign in with this email and the temporary password.'}
      width={640}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
          <Button title="Cancel" variant="secondary" onPress={onClose} disabled={saving} />
          <Button title={editing ? 'Save' : 'Add staff'} icon={editing ? 'checkmark' : 'person-add-outline'} onPress={submit} loading={saving} />
        </View>
      }
    >
      {formError ? <Callout tone="danger">{formError}</Callout> : null}
      <Input label="Full name" required value={name} onChangeText={(v) => { setName(v); setServerErrors((s) => ({ ...s, full_name: '' })); }}
        error={show('full_name')} maxLength={80} placeholder="e.g. Ravi Kumar" autoFocus={!editing} />
      {!editing ? (
        <FieldRow>
          <Input label="Email (used to sign in)" required value={email} onChangeText={(v) => { setEmail(v); setServerErrors((s) => ({ ...s, email: '' })); }}
            error={show('email')} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="ravi@yourshop.in" />
          <Input label="Phone (optional)" value={phone} onChangeText={(v) => { setPhone(v); setServerErrors((s) => ({ ...s, phone: '' })); }}
            error={show('phone')} keyboardType="phone-pad" maxLength={16} placeholder="98765 43210" />
        </FieldRow>
      ) : null}

      <View style={{ gap: 6 }}>
        <Text variant="smallStrong" tone="muted">Role</Text>
        {isSelf ? <Text variant="small" tone="subtle">You can't change your own role.</Text> : null}
        {!ctx.isOwner ? <Text variant="small" tone="subtle">Only the owner can make someone a manager or owner.</Text> : null}
        {roles.length === 0 ? <Callout tone="warning">Roles couldn't be loaded. Close this and pull down to refresh.</Callout> : (
          <RolePicker value={role} options={isSelf ? roles.filter((r) => r.key === role) : options} onChange={setRole} disabled={isSelf} />
        )}
        {role === 'owner' && !isSelf ? <Callout tone="warning">Owners have full access, including staff and closing the business account. Give this only to a business partner.</Callout> : null}
        {selectedRole && !selectedRole.is_system && selectedRole.permissions.includes('staff.manage') ? (
          <Callout tone="warning">This role can add and change staff logins.</Callout>
        ) : null}
      </View>

      {showTables ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <View style={{ flexShrink: 1 }}>
              <Text variant="smallStrong" tone="muted">Assigned tables</Text>
              <Text variant="small" tone="subtle">New orders on these tables are credited to {name.trim() || 'this person'}. Picking a table assigned to someone else moves it.</Text>
            </View>
            {selectedTables.size ? <Button title="Clear" size="sm" variant="ghost" onPress={() => setSelectedTables(new Set())} /> : null}
          </View>
          <TablePicker tables={tables!} selected={selectedTables} memberId={member?.id ?? null} staffNames={staffNames}
            onToggle={(id) => setSelectedTables((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })} />
        </View>
      ) : tables && tables.length > 0 && !tableAssignSupported && roleTakesOrders(role, roles) ? (
        <Callout tone="neutral" icon="information-circle-outline">Assigning tables to waiters needs the latest Tallyko server update.</Callout>
      ) : null}

      <View style={{ gap: 8 }}>
        {editing && !resetting ? (
          <Button title="Reset password" icon="key-outline" variant="secondary" onPress={() => { setResetting(true); setPassword(newPassword()); }} style={{ alignSelf: 'flex-start' }} />
        ) : (
          <>
            <Input label={editing ? 'New temporary password' : 'Temporary password'} required value={password} onChangeText={setPassword} error={show('password')}
              autoCapitalize="none" autoCorrect={false} maxLength={64}
              hint="At least 8 characters. Share it privately; they can change it in Settings → Account."
              right={<Button icon="refresh" size="sm" variant="ghost" accessibilityLabel="Generate a new password" onPress={() => setPassword(newPassword())} />} />
            {editing ? <Button title="Don't reset password" size="sm" variant="ghost" onPress={() => { setResetting(false); setPassword(''); }} style={{ alignSelf: 'flex-start' }} /> : null}
          </>
        )}
      </View>

      {editing && !isSelf ? (
        <Card style={{ gap: 8 }}>
          <SwitchRow title="Login active" value={member!.is_active && !confirmingDeactivate} disabled={busyActive}
            onValueChange={(next) => (next ? void setActive(true) : setConfirmingDeactivate(true))}
            subtitle={member!.is_active ? 'Turn off when someone leaves. Their past bills are kept.' : 'This person cannot sign in.'} />
          {confirmingDeactivate ? (
            // Inline confirmation: a confirm() dialog would open underneath this sheet on web.
            <Callout tone="danger" title={`Deactivate ${member!.full_name || member!.email}?`}
              action={<>
                <Button title="Deactivate" variant="danger" size="sm" onPress={() => setActive(false)} loading={busyActive} />
                <Button title="Keep active" variant="secondary" size="sm" onPress={() => setConfirmingDeactivate(false)} disabled={busyActive} />
              </>}>
              They can't sign in again. A device that is already signed in stays signed in until its session ends (up to 12 hours). Past bills and reports are kept, and you can reactivate them later.
            </Callout>
          ) : null}
        </Card>
      ) : null}
      {isSelf ? <Text variant="small" tone="subtle">You can't deactivate your own login. Change your password in Settings → Account.</Text> : null}
    </Sheet>
  );
}

export function ShareLoginSheet({ email, password, name, onClose }: { email: string; password: string; name: string; onClose: () => void }) {
  const message = `Tallyko login for ${name}\nEmail: ${email}\nTemporary password: ${password}\nPlease change it after signing in (Settings → Account).`;
  return (
    <Sheet visible onClose={onClose} title="Share login details" subtitle="This password is shown only once." width={480}
      footer={
        <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button title="Share" variant="secondary" icon="share-social-outline" onPress={() => shareText(message, 'Tallyko login')} />
          <Button title="Copy" variant="secondary" icon="copy-outline" onPress={() => copyText(message, 'Login details')} />
          <Button title="Done" onPress={onClose} />
        </View>
      }>
      <Callout tone="success" title={`${name} is ready to sign in`}>Give them these details in person or over a private message.</Callout>
      <Card style={{ gap: 8 }}>
        <Text variant="small" tone="muted">Email</Text>
        <Text variant="bodyStrong" selectable>{email}</Text>
        <Text variant="small" tone="muted" style={{ marginTop: 6 }}>Temporary password</Text>
        <Text variant="h2" selectable style={{ letterSpacing: 1 }}>{password}</Text>
      </Card>
    </Sheet>
  );
}
