'use client';

import { BRANCH_SCOPED_ROLES, ROLE_LABELS, type Role } from '@jobbank/shared';
import { MailPlus, ShieldOff, Trash2, UserCheck, UserMinus, UserX } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Input, Select } from '@/components/atoms';
import { ConfirmDialog, FormField, KeyValue, toast } from '@/components/molecules';
import type { StaffDetail } from '@/domains/user';
import { ApiClientError, apiFetch } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format/date';
import type { BranchOption } from './InviteStaffDialog';

const message = (err: unknown) =>
  err instanceof ApiClientError ? err.message : 'Something went wrong';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-border bg-surface shadow-card grid gap-4 rounded-xl border p-5">
      <h2 className="text-fg text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function StaffDetailView({
  staff,
  branches,
  listPath,
}: {
  staff: StaffDetail;
  branches: BranchOption[];
  listPath: string;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState({ name: staff.name, title: staff.title ?? '' });
  const [savingProfile, setSavingProfile] = useState(false);
  const [newRole, setNewRole] = useState<{ role: Role | ''; branchId: string }>({
    role: '',
    branchId: '',
  });
  const [addingRole, setAddingRole] = useState(false);
  const manage = staff.can.manage;
  const roleNeedsBranch = newRole.role !== '' && BRANCH_SCOPED_ROLES.includes(newRole.role);

  const refresh = () => router.refresh();

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setSavingProfile(true);
    try {
      await apiFetch(`/api/v1/users/${staff.id}`, {
        method: 'PATCH',
        body: { name: profile.name, title: profile.title || null },
      });
      toast.success('Profile saved');
      refresh();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setSavingProfile(false);
    }
  };

  const addRole = async (event: FormEvent) => {
    event.preventDefault();
    if (!newRole.role) return;
    setAddingRole(true);
    try {
      await apiFetch(`/api/v1/users/${staff.id}/roles`, {
        method: 'POST',
        body: { role: newRole.role, branchId: roleNeedsBranch ? newRole.branchId : null },
      });
      toast.success(`${ROLE_LABELS[newRole.role]} role added`);
      setNewRole({ role: '', branchId: '' });
      refresh();
    } catch (err) {
      toast.error(message(err));
    } finally {
      setAddingRole(false);
    }
  };

  return (
    <div className="grid gap-6">
      {!manage && staff.can.reason && (
        <p className="bg-surface-muted text-fg-muted rounded-lg px-4 py-3 text-sm">
          {staff.can.reason}
        </p>
      )}

      <Card title="Account">
        <KeyValue
          items={[
            { label: 'Email', value: staff.email },
            { label: 'Two-factor', value: staff.twoFactorEnabled ? 'On' : 'Off' },
            {
              label: 'Last sign-in',
              value: staff.lastLoginAt ? formatDateTime(staff.lastLoginAt) : 'Never',
            },
            { label: 'Added', value: formatDateTime(staff.createdAt) },
            ...(staff.status === 'INVITED'
              ? [
                  {
                    label: 'Invitation expires',
                    value: staff.invitationExpiresAt
                      ? formatDateTime(staff.invitationExpiresAt)
                      : 'Expired — resend it',
                  },
                ]
              : []),
          ]}
        />
        {manage && (
          <div className="border-border flex flex-wrap gap-2 border-t pt-4">
            {staff.status === 'INVITED' && (
              <Button
                variant="secondary"
                leftIcon={<MailPlus />}
                onClick={async () => {
                  try {
                    const { data } = await apiFetch<{ emailSent: boolean }>(
                      `/api/v1/users/${staff.id}/invitation`,
                      { method: 'POST' },
                    );
                    if (data.emailSent) toast.success('A new invitation was sent');
                    else toast.warning('Could not send the email. Try again shortly.');
                    refresh();
                  } catch (err) {
                    toast.error(message(err));
                  }
                }}
              >
                Resend invitation
              </Button>
            )}
            {staff.status !== 'INVITED' && (
              <ConfirmDialog
                title={
                  staff.status === 'ACTIVE' ? `Disable ${staff.name}?` : `Re-enable ${staff.name}?`
                }
                description={
                  staff.status === 'ACTIVE'
                    ? 'They are signed out everywhere immediately and cannot sign in until re-enabled. Their records stay.'
                    : 'They will be able to sign in again with their existing password.'
                }
                tone={staff.status === 'ACTIVE' ? 'danger' : 'primary'}
                confirmLabel={staff.status === 'ACTIVE' ? 'Disable account' : 'Re-enable account'}
                requireReason={{
                  label: 'Reason',
                  minLength: 5,
                  placeholder: 'Recorded in the audit log',
                }}
                onConfirm={async (reason) => {
                  await apiFetch(`/api/v1/users/${staff.id}/status`, {
                    method: 'PATCH',
                    body: { status: staff.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE', reason },
                  });
                  toast.success(
                    staff.status === 'ACTIVE' ? 'Account disabled' : 'Account re-enabled',
                  );
                  refresh();
                }}
                trigger={
                  <Button
                    variant={staff.status === 'ACTIVE' ? 'danger' : 'primary'}
                    leftIcon={staff.status === 'ACTIVE' ? <UserX /> : <UserCheck />}
                  >
                    {staff.status === 'ACTIVE' ? 'Disable account' : 'Re-enable account'}
                  </Button>
                }
              />
            )}
            {staff.twoFactorEnabled && (
              <ConfirmDialog
                title="Reset two-factor authentication?"
                description="Use this when someone lost their phone. They are signed out, and must set up an authenticator app again at their next sign-in."
                tone="danger"
                confirmLabel="Reset two-factor"
                requireReason={{ label: 'Reason', minLength: 5 }}
                onConfirm={async (reason) => {
                  await apiFetch(`/api/v1/users/${staff.id}/two-factor/reset`, {
                    method: 'POST',
                    body: { reason },
                  });
                  toast.success('Two-factor reset');
                  refresh();
                }}
                trigger={
                  <Button variant="secondary" leftIcon={<ShieldOff />}>
                    Reset two-factor
                  </Button>
                }
              />
            )}
            <ConfirmDialog
              title={`Delete ${staff.name}?`}
              description="This permanently removes the account and all its data. It cannot be undone."
              tone="danger"
              confirmLabel="Delete account"
              requireReason={{
                label: 'Reason',
                minLength: 5,
                placeholder: 'Recorded in the audit log',
              }}
              onConfirm={async (reason) => {
                await apiFetch(`/api/v1/users/${staff.id}`, {
                  method: 'DELETE',
                  body: { reason },
                });
                toast.success('Account deleted');
                router.push(listPath);
              }}
              trigger={
                <Button variant="danger" leftIcon={<UserMinus />}>
                  Delete account
                </Button>
              }
            />
          </div>
        )}
      </Card>

      <Card title="Roles">
        <ul className="grid gap-2">
          {staff.roles.map((assignment) => (
            <li
              key={assignment.id}
              className="border-border flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  tone={
                    assignment.role === 'SUPER_ADMIN' || assignment.role === 'BRANCH_ADMIN'
                      ? 'accent'
                      : 'neutral'
                  }
                >
                  {ROLE_LABELS[assignment.role]}
                </Badge>
                {assignment.branchName && (
                  <span className="text-fg-muted text-sm">{assignment.branchName}</span>
                )}
              </div>
              {manage &&
                staff.roles.length > 1 &&
                staff.can.grantableRoles.includes(assignment.role) && (
                  <ConfirmDialog
                    title={`Remove ${ROLE_LABELS[assignment.role]} role?`}
                    description={
                      assignment.branchName ? `From ${assignment.branchName}.` : undefined
                    }
                    tone="danger"
                    confirmLabel="Remove role"
                    onConfirm={async () => {
                      await apiFetch(`/api/v1/users/${staff.id}/roles/${assignment.id}`, {
                        method: 'DELETE',
                      });
                      toast.success('Role removed');
                      refresh();
                    }}
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`Remove ${ROLE_LABELS[assignment.role]} role`}
                      >
                        <Trash2 />
                      </Button>
                    }
                  />
                )}
            </li>
          ))}
        </ul>
        {manage && staff.can.grantableRoles.length > 0 && (
          <form
            className="border-border grid gap-3 border-t pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            onSubmit={addRole}
          >
            <FormField label="Add role">
              <Select
                value={newRole.role}
                placeholder="Choose a role"
                onChange={(e) => setNewRole({ role: e.target.value as Role, branchId: '' })}
                options={staff.can.grantableRoles.map((role) => ({
                  value: role,
                  label: ROLE_LABELS[role],
                }))}
              />
            </FormField>
            {roleNeedsBranch ? (
              <FormField label="Branch">
                <Select
                  value={newRole.branchId}
                  placeholder="Choose a branch"
                  onChange={(e) => setNewRole((r) => ({ ...r, branchId: e.target.value }))}
                  options={branches.map((b) => ({ value: b.id, label: b.name }))}
                />
              </FormField>
            ) : (
              <div className="hidden sm:block" />
            )}
            <Button
              type="submit"
              variant="secondary"
              loading={addingRole}
              disabled={!newRole.role || (roleNeedsBranch && !newRole.branchId)}
            >
              Add
            </Button>
          </form>
        )}
      </Card>

      {manage && (
        <Card title="Profile">
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={saveProfile}>
            <FormField label="Full name" required>
              <Input
                value={profile.name}
                onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
              />
            </FormField>
            <FormField label="Job title">
              <Input
                value={profile.title}
                onChange={(e) => setProfile((p) => ({ ...p, title: e.target.value }))}
              />
            </FormField>
            <Button
              type="submit"
              variant="secondary"
              loading={savingProfile}
              className="justify-self-start"
            >
              Save profile
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
