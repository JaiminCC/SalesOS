'use client';
import React, { useEffect, useState } from 'react';
import { managementRequest, openNavigation, resolveNavigation } from '../../lib/auth-client';
import { recallNavigation, rememberNavigation } from '../../lib/navigation-context';
import { RoleMatrix } from '../Enterprise';
import {
  BulkActionToolbar, ConfirmBulkActionDialog, ConfirmDialog, DataTable, EmptyState, ErrorState, FilterPanel,
  FormActions, LoadingState, ManagementPageHeader, ManagementPageLayout, PageSizeSelector, PaginationControls,
  PermissionGate, RecordFormLayout, RowActionMenu, SearchInput, SelectionCheckbox, SortableColumnHeader, StatusBadge,
  UnsavedChangesGuard,
} from './kit';

const ROLES = ['ADMIN', 'SALES_MANAGER', 'SALES_AGENT', 'VIEWER'];

export default function MembersDesk({ mode, organizationId, permissions = [], notify, onNavigate }) {
  const canInvite = permissions.includes('users.invite') || permissions.includes('users.manage');
  const canManage = permissions.includes('users.manage');
  const canRoles = permissions.includes('roles.manage') || canManage;
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [sortBy, setSortBy] = useState('displayName');
  const [sortDirection, setSortDirection] = useState('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState([]);
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('SALES_AGENT');
  const [editRole, setEditRole] = useState('VIEWER');
  const [dirty, setDirty] = useState(false);
  const [record, setRecord] = useState(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const result = await managementRequest('members/list', { q: query, role: role || undefined, status: status || undefined, sortBy, sortDirection, page, pageSize });
      setRows(result.items);
      setTotal(result.total);
      setSelected((current) => current.filter((id) => result.items.some((item) => item.userId === id)));
    } catch (cause) {
      setError(cause.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (mode !== 'list' || !organizationId) return undefined;
    const timer = setTimeout(() => { load(); }, 300);
    return () => clearTimeout(timer);
  }, [mode, organizationId, query, role, status, sortBy, sortDirection, page, pageSize]);

  useEffect(() => {
    if (mode === 'list') return undefined;
    const token = recallNavigation('member', mode);
    if (!token) { setRecord(null); return undefined; }
    let cancelled = false;
    resolveNavigation(token).then(async (context) => {
      if (cancelled || mode === 'add' || !context.resourceId) return;
      const member = await managementRequest('members/get', { id: context.resourceId });
      if (!cancelled) { setRecord(member); setEditRole(member.roles[0] || 'VIEWER'); }
    }).catch((cause) => { if (!cancelled) setError(cause.message); });
    return () => { cancelled = true; };
  }, [mode, organizationId]);

  async function openRecord(item, action) {
    const opened = await openNavigation({ resourceType: 'member', action, resourceId: item.userId });
    rememberNavigation('member', action, opened.token);
    setRecord(item);
    setEditRole(item.roles[0] || 'VIEWER');
    onNavigate('users', action);
  }

  async function openAdd() {
    const opened = await openNavigation({ resourceType: 'member', action: 'add' });
    rememberNavigation('member', 'add', opened.token);
    onNavigate('users', 'add');
  }

  async function confirmRemove(ids) {
    setBusy(true);
    try {
      if (ids.length === 1) {
        await managementRequest('members/remove', { id: ids[0] });
        notify('Member removed from this organization.');
      } else {
        const result = await managementRequest('members/bulk-remove', { ids });
        const failed = result.results.filter((item) => !item.ok);
        notify(failed.length ? `${result.results.length - failed.length} removed. ${failed.length} could not be removed.` : 'Selected members were removed.');
      }
      setPending(null);
      setSelected([]);
      if (mode !== 'list') onNavigate('users', 'list');
      else await load();
    } catch (cause) {
      notify(cause.message);
    } finally {
      setBusy(false);
    }
  }

  function sort(next) {
    setSortDirection(sortBy === next && sortDirection === 'asc' ? 'desc' : 'asc');
    setSortBy(next);
    setPage(1);
  }

  if (mode === 'add') {
    return (
      <ManagementPageLayout>
        <PermissionGate allowed={canInvite}>
          <RecordFormLayout title="Add User" onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              await managementRequest('members/invite', { email, role: inviteRole });
              notify('Invitation captured locally. No external email was sent.');
              onNavigate('users', 'list');
            } catch (cause) {
              notify(cause.message);
            } finally {
              setBusy(false);
            }
          }}>
            <UnsavedChangesGuard dirty={dirty} />
            <label className="wide">Email <span className="required">*</span><input required type="email" value={email} onChange={(event) => { setEmail(event.target.value); setDirty(true); }} /></label>
            <label>Role<select value={inviteRole} onChange={(event) => { setInviteRole(event.target.value); setDirty(true); }}>{ROLES.map((item) => <option key={item}>{item}</option>)}</select></label>
            <p className="product-note wide">This sends an invitation. It does not create a password or a platform account.</p>
            <FormActions>
              <button className="btn" type="button" onClick={() => onNavigate('users', 'list')}>Cancel</button>
              <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send invitation'}</button>
            </FormActions>
          </RecordFormLayout>
        </PermissionGate>
      </ManagementPageLayout>
    );
  }

  if (mode === 'view' || mode === 'edit') {
    const current = record;
    return (
      <ManagementPageLayout>
        <ManagementPageHeader eyebrow="ACTIVE ORGANIZATION · LIVE DIRECTORY" title={mode === 'edit' ? 'Edit User' : 'User Details'} description="Membership stays inside this organization. The platform account is not deleted." actions={<button className="btn" type="button" onClick={() => onNavigate('users', 'list')}>Back to members</button>} />
        {!current && <EmptyState title="Choose a member from the list" subtitle="This page restores the member selected in this tab. Open the list if this tab has no selection." />}
        {current && mode === 'view' && (
          <section className="panel">
            <h3>{current.displayName}</h3>
            <p>{current.email}</p>
            <p><StatusBadge>{current.status}</StatusBadge> {current.roles.join(', ')}</p>
            <p>Joined {current.createdAt}</p>
            <RowActionMenu label="Member actions">
              {canRoles && <button className="btn" type="button" onClick={() => onNavigate('users', 'edit')}>Edit</button>}
              {canManage && <button className="btn btn-danger" type="button" onClick={() => setPending({ ids: [current.userId], name: current.displayName })}>Remove</button>}
            </RowActionMenu>
          </section>
        )}
        {current && mode === 'edit' && (
          <PermissionGate allowed={canRoles}>
            <RecordFormLayout title="Edit User" onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              try {
                await managementRequest('members/update', { userId: current.userId, role: editRole });
                notify('Role updated. That member’s sessions were revoked.');
                setDirty(false);
                onNavigate('users', 'list');
              } catch (cause) {
                notify(cause.message || 'This record changed since you opened it. Reload and try again.');
              } finally {
                setBusy(false);
              }
            }}>
              <UnsavedChangesGuard dirty={dirty} />
              <p className="wide">{current.displayName} · {current.email}</p>
              <label>Role<select aria-label={`Role for ${current.displayName}`} value={editRole} onChange={(event) => { setEditRole(event.target.value); setDirty(true); }}>{['OWNER', ...ROLES].map((item) => <option key={item}>{item}</option>)}</select></label>
              <FormActions>
                <button className="btn" type="button" onClick={() => onNavigate('users', 'view')}>Cancel</button>
                <button className="btn btn-primary" type="submit" disabled={busy}>Save changes</button>
              </FormActions>
            </RecordFormLayout>
          </PermissionGate>
        )}
        {pending && <ConfirmDialog title="Remove member" body={`Remove ${pending.name} from this organization? Their platform account remains, and their sessions for this organization are revoked.`} confirmLabel="Remove member" busy={busy} onCancel={() => setPending(null)} onConfirm={() => confirmRemove(pending.ids)} />}
      </ManagementPageLayout>
    );
  }

  const pageIds = rows.map((item) => item.userId);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));
  return (
    <ManagementPageLayout>
      <ManagementPageHeader eyebrow="ACTIVE ORGANIZATION · LIVE DIRECTORY" title="Users, Roles & Permissions" description="Members, roles, and permission grants come from the active organization." actions={canInvite && <button className="btn btn-primary" type="button" onClick={() => openAdd().catch((cause) => notify(cause.message))}>Add User</button>} />
      <section className="panel">
        <h3>Workspace members</h3>
        <p>Members loaded from the active organization. Role changes and invitations are saved on the server.</p>
        <FilterPanel>
          <SearchInput id="member-search" label="Search members" value={query} onChange={(value) => { setQuery(value); setPage(1); }} />
          <label>Role<select aria-label="Filter by role" value={role} onChange={(event) => { setRole(event.target.value); setPage(1); }}><option value="">All roles</option>{['OWNER', ...ROLES].map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Status<select aria-label="Filter by status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">Current members</option><option>ACTIVE</option><option>INVITED</option><option>SUSPENDED</option></select></label>
          <PageSizeSelector value={pageSize} onChange={(size) => { setPageSize(size); setPage(1); }} />
          <button className="btn" type="button" onClick={() => load()}>Refresh</button>
        </FilterPanel>
        <BulkActionToolbar count={selected.length}>
          {canManage && <button className="btn btn-danger" type="button" onClick={() => setPending({ ids: selected, name: `${selected.length} members` })}>Delete</button>}
        </BulkActionToolbar>
        {loading && <LoadingState />}
        {error && <ErrorState message={error} onRetry={load} />}
        {!loading && !error && !rows.length && <EmptyState title="No members match" subtitle="Change the search or filters." />}
        {!loading && !error && !!rows.length && (
          <DataTable label="Workspace members">
            <thead>
              <tr>
                <th><SelectionCheckbox label="Select all members on this page" checked={allSelected} onChange={(checked) => setSelected(checked ? pageIds : [])} /></th>
                <SortableColumnHeader label="Name" active={sortBy === 'displayName'} direction={sortDirection} onSort={() => sort('displayName')} />
                <SortableColumnHeader label="Email" active={sortBy === 'email'} direction={sortDirection} onSort={() => sort('email')} />
                <SortableColumnHeader label="Role" active={sortBy === 'role'} direction={sortDirection} onSort={() => sort('role')} />
                <SortableColumnHeader label="Status" active={sortBy === 'status'} direction={sortDirection} onSort={() => sort('status')} />
                <SortableColumnHeader label="Joined" active={sortBy === 'createdAt'} direction={sortDirection} onSort={() => sort('createdAt')} />
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((item) => (
                <tr key={item.userId}>
                  <td><SelectionCheckbox label={`Select ${item.displayName}`} checked={selected.includes(item.userId)} onChange={(checked) => setSelected(checked ? [...selected, item.userId] : selected.filter((id) => id !== item.userId))} /></td>
                  <td><button type="button" className="linkish" onClick={() => openRecord(item, 'view').catch((cause) => notify(cause.message))}>{item.displayName}</button></td>
                  <td>{item.email} · Live membership</td>
                  <td>
                    <select aria-label={`Role for ${item.displayName}`} value={item.roles[0] || 'VIEWER'} disabled={!canRoles} onChange={async (event) => {
                      try {
                        await managementRequest('members/update', { userId: item.userId, role: event.target.value });
                        notify('Role updated. That member’s sessions were revoked.');
                        await load();
                      } catch (cause) {
                        notify(cause.message);
                      }
                    }}>{['OWNER', ...ROLES].map((itemRole) => <option key={itemRole}>{itemRole}</option>)}</select>
                  </td>
                  <td><StatusBadge>{item.status}</StatusBadge></td>
                  <td>{item.createdAt.slice(0, 10)}</td>
                  <td>
                    <RowActionMenu label={`Actions for ${item.displayName}`}>
                      <button className="btn" type="button" onClick={() => openRecord(item, 'view').catch((cause) => notify(cause.message))}>View</button>
                      {canRoles && <button className="btn" type="button" onClick={() => openRecord(item, 'edit').catch((cause) => notify(cause.message))}>Edit</button>}
                      {canManage && <button className="btn btn-danger" type="button" onClick={() => setPending({ ids: [item.userId], name: item.displayName })}>Remove</button>}
                    </RowActionMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
        <PaginationControls page={page} pageSize={pageSize} total={total} onPage={setPage} />
        <form className="mgmt-toolbar" onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const input = form.elements.email.value;
            try {
              await managementRequest('members/invite', { email: input, role: 'SALES_AGENT' });
              form.reset();
              notify('Invitation captured locally. No external email was sent.');
              await load();
            } catch (cause) {
              notify(cause.message);
            }
          }}>
            <label>Invite email<input name="email" type="email" required /></label>
            <button className="btn btn-primary" type="submit">Invite user</button>
          </form>
      </section>
      <RoleMatrix organizationId={organizationId} refreshKey={total} />
      <div className="mgmt-actions">
        <button className="btn" type="button" onClick={() => onNavigate('invitations', 'list')}>Invitations</button>
        <button className="btn" type="button" onClick={() => onNavigate('sessions', 'list')}>Sessions</button>
      </div>
      {pending && (pending.ids.length > 1
        ? <ConfirmBulkActionDialog title="Remove members" body={`Remove ${pending.ids.length} members from this organization? Accounts stay on the platform. The last owner is protected.`} confirmLabel="Remove members" busy={busy} onCancel={() => setPending(null)} onConfirm={() => confirmRemove(pending.ids)} />
        : <ConfirmDialog title="Remove member" body={`Remove ${pending.name} from this organization? This does not delete the platform account.`} confirmLabel="Remove member" busy={busy} onCancel={() => setPending(null)} onConfirm={() => confirmRemove(pending.ids)} />)}
    </ManagementPageLayout>
  );
}
