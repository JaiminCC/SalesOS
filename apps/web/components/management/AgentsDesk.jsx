'use client';
import React, { useEffect, useState } from 'react';
import { managementRequest, openNavigation, resolveNavigation } from '../../lib/auth-client';
import { recallNavigation, rememberNavigation } from '../../lib/navigation-context';
import {
  BulkActionToolbar, ConfirmBulkActionDialog, ConfirmDialog, DataTable, EmptyState, ErrorState, FilterPanel,
  FormActions, LoadingState, ManagementPageHeader, ManagementPageLayout, PageSizeSelector, PaginationControls,
  PermissionGate, RecordDetailsLayout, RecordFormLayout, SearchInput, SelectionCheckbox, SortableColumnHeader, StatusBadge,
  UnsavedChangesGuard,
} from './kit';

export default function AgentsDesk({ mode, organizationId, permissions = [], notify, onNavigate }) {
  const canManage = permissions.includes('agents.manage');
  const canPause = permissions.includes('automation.pause');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(mode === 'list');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState([]);
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [record, setRecord] = useState(null);
  const [form, setForm] = useState({ name: '', role: '', instructions: '', modelConfigurationId: '', defaultProductId: '' });
  const [models, setModels] = useState([]);
  const [products, setProducts] = useState([]);
  const [dirty, setDirty] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const result = await managementRequest('agents/list', { q: query, status: status || undefined, sortBy, sortDirection, page, pageSize });
      setRows(result.items);
      setTotal(result.total);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (mode !== 'list' || !organizationId) return undefined;
    const timer = setTimeout(() => { load(); }, 250);
    return () => clearTimeout(timer);
  }, [mode, organizationId, query, status, sortBy, sortDirection, page, pageSize]);

  useEffect(() => {
    if (mode === 'list' || mode === 'add') return undefined;
    const token = recallNavigation('agent', mode);
    if (!token) { setRecord(null); setError('Open this agent from the list again.'); return undefined; }
    let cancelled = false;
    setLoading(true);
    resolveNavigation(token).then(async (context) => {
      const agent = await managementRequest('agents/get', { id: context.resourceId });
      if (cancelled) return;
      setRecord(agent);
      setForm({ name: agent.name, role: agent.role, instructions: agent.instructions || '', modelConfigurationId: agent.modelConfigurationId || '', defaultProductId: agent.defaultProductId || '' });
      setLoading(false);
    }).catch((cause) => { if (!cancelled) { setError(cause.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [mode, organizationId]);

  async function openRecord(item, action) {
    const opened = await openNavigation({ resourceType: 'agent', action, resourceId: item.id });
    rememberNavigation('agent', action, opened.token);
    onNavigate('agents', action);
  }

  async function openAdd() {
    const opened = await openNavigation({ resourceType: 'agent', action: 'add' });
    rememberNavigation('agent', 'add', opened.token);
    onNavigate('agents', 'add');
  }

  function sort(next) {
    setSortDirection(sortBy === next && sortDirection === 'asc' ? 'desc' : 'asc');
    setSortBy(next);
    setPage(1);
  }

  async function confirmPending() {
    setBusy(true);
    try {
      if (pending.kind === 'archive') await managementRequest('agents/archive', { id: pending.id });
      if (pending.kind === 'pause') await managementRequest('agents/pause', { id: pending.id });
      if (pending.kind === 'resume') await managementRequest('agents/resume', { id: pending.id });
      if (pending.kind === 'bulk-pause') await managementRequest('agents/bulk-pause', { ids: pending.ids });
      if (pending.kind === 'bulk-archive') await managementRequest('agents/bulk-archive', { ids: pending.ids });
      notify('Agent access was updated. History was kept.');
      setPending(null);
      setSelected([]);
      if (mode === 'list') await load();
      else onNavigate('agents', 'list');
    } catch (cause) {
      notify(cause.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if ((mode !== 'add' && mode !== 'edit' && mode !== 'view') || !organizationId) return undefined;
    managementRequest('models/list', { page: 1, pageSize: 100 }).then((result) => setModels(result.items || [])).catch(() => setModels([]));
    managementRequest('products/list', { page: 1, pageSize: 100 }).then((result) => setProducts(result.items || [])).catch(() => setProducts([]));
    return undefined;
  }, [mode, organizationId]);

  if (mode === 'add' || mode === 'edit') {
    return (
      <ManagementPageLayout>
        <PermissionGate allowed={canManage}>
          <RecordFormLayout title={mode === 'add' ? 'Add agent' : 'Edit agent'} onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              const body = { ...form };
              if (!body.modelConfigurationId) delete body.modelConfigurationId;
              if (!body.defaultProductId) delete body.defaultProductId;
              if (mode === 'add') await managementRequest('agents/create', body);
              else await managementRequest('agents/update', { id: record.id, ...body, enabled: record.enabled });
              notify(mode === 'add' ? 'Agent saved.' : 'Agent updated.');
              setDirty(false);
              onNavigate('agents', 'list');
            } catch (cause) {
              notify(cause.message);
            } finally {
              setBusy(false);
            }
          }}>
            <UnsavedChangesGuard dirty={dirty} />
            <label>Name<input value={form.name} required onChange={(event) => { setForm({ ...form, name: event.target.value }); setDirty(true); }} /></label>
            <label>Role<input value={form.role} required onChange={(event) => { setForm({ ...form, role: event.target.value }); setDirty(true); }} /></label>
            <label>Instructions<textarea value={form.instructions} onChange={(event) => { setForm({ ...form, instructions: event.target.value }); setDirty(true); }} /></label>
            <label>Model<select aria-label="Model" value={form.modelConfigurationId} onChange={(event) => { setForm({ ...form, modelConfigurationId: event.target.value }); setDirty(true); }}><option value="">No default model</option>{models.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Product<select aria-label="Default product" value={form.defaultProductId} onChange={(event) => { setForm({ ...form, defaultProductId: event.target.value }); setDirty(true); }}><option value="">No default product</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <FormActions>
              <button className="btn" type="button" onClick={() => onNavigate('agents', 'list')}>Cancel</button>
              <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </FormActions>
          </RecordFormLayout>
        </PermissionGate>
      </ManagementPageLayout>
    );
  }

  if (mode === 'view') {
    return (
      <ManagementPageLayout>
        {loading && <LoadingState label="Loading agent…" />}
        {error && <ErrorState message={error} onRetry={() => onNavigate('agents', 'list')} />}
        {record && (
          <RecordDetailsLayout title={record.name} actions={<>
            {canManage && <button className="btn" type="button" onClick={() => openRecord(record, 'edit')}>Edit</button>}
            {canPause && record.status === 'ACTIVE' && <button className="btn" type="button" onClick={() => setPending({ kind: 'pause', id: record.id, name: record.name })}>Pause</button>}
            {canPause && record.status === 'PAUSED' && <button className="btn" type="button" onClick={() => setPending({ kind: 'resume', id: record.id, name: record.name })}>Resume</button>}
            {canManage && record.status !== 'ARCHIVED' && <button className="btn btn-danger" type="button" onClick={() => setPending({ kind: 'archive', id: record.id, name: record.name })}>Archive</button>}
          </>}>
            <p>{record.role}</p>
            <p>{record.instructions || 'No instructions saved.'}</p>
            <p>Model: {models.find((item) => item.id === record.modelConfigurationId)?.name || 'None selected'}</p>
            <p>Product: {products.find((item) => item.id === record.defaultProductId)?.name || 'None selected'}</p>
            <StatusBadge>{record.status}</StatusBadge>
          </RecordDetailsLayout>
        )}
        {pending && <ConfirmDialog title={pending.kind === 'archive' ? 'Archive agent' : pending.kind === 'pause' ? 'Pause agent' : 'Resume agent'} body={`${pending.kind === 'archive' ? 'Archive' : pending.kind === 'pause' ? 'Pause' : 'Resume'} ${pending.name}? Past runs stay in the inspector.`} confirmLabel={pending.kind === 'archive' ? 'Archive' : pending.kind === 'pause' ? 'Pause' : 'Resume'} busy={busy} onCancel={() => setPending(null)} onConfirm={confirmPending} />}
      </ManagementPageLayout>
    );
  }

  const pageIds = rows.map((item) => item.id);
  return (
    <ManagementPageLayout>
      <ManagementPageHeader eyebrow="LIVE AGENTS" title="AI Agents" description="Agents are stored for this organization. Archiving keeps their runs." actions={canManage && <button className="btn btn-primary" type="button" onClick={() => openAdd().catch((cause) => notify(cause.message))}>Add agent</button>} />
      <FilterPanel>
        <SearchInput id="agent-search" label="Search agents" value={query} onChange={(value) => { setQuery(value); setPage(1); }} />
        <label>Status<select aria-label="Filter by status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">Current agents</option><option>ACTIVE</option><option>PAUSED</option><option>ARCHIVED</option></select></label>
        <PageSizeSelector value={pageSize} onChange={(size) => { setPageSize(size); setPage(1); }} />
      </FilterPanel>
      <BulkActionToolbar count={selected.length}>
        {canPause && <button className="btn" type="button" onClick={() => setPending({ kind: 'bulk-pause', ids: selected })}>Pause selected</button>}
        {canManage && <button className="btn btn-danger" type="button" onClick={() => setPending({ kind: 'bulk-archive', ids: selected })}>Archive selected</button>}
      </BulkActionToolbar>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && !rows.length && <EmptyState title="No agents match" subtitle="Add an agent or change the filters." />}
      {!loading && !error && !!rows.length && (
        <DataTable label="Agents">
          <thead><tr>
            <th><SelectionCheckbox label="Select all agents on this page" checked={pageIds.length > 0 && pageIds.every((id) => selected.includes(id))} onChange={(checked) => setSelected(checked ? pageIds : [])} /></th>
            <SortableColumnHeader label="Name" active={sortBy === 'name'} direction={sortDirection} onSort={() => sort('name')} />
            <th>Role</th>
            <SortableColumnHeader label="Status" active={sortBy === 'status'} direction={sortDirection} onSort={() => sort('status')} />
          </tr></thead>
          <tbody>{rows.map((item) => (
            <tr key={item.id}>
              <td><SelectionCheckbox label={`Select ${item.name}`} checked={selected.includes(item.id)} onChange={(checked) => setSelected(checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))} /></td>
              <td><button type="button" className="linkish" onClick={() => openRecord(item, 'view').catch((cause) => notify(cause.message))}>{item.name}</button></td>
              <td>{item.role}</td>
              <td><StatusBadge>{item.status}</StatusBadge></td>
            </tr>
          ))}</tbody>
        </DataTable>
      )}
      <PaginationControls page={page} pageSize={pageSize} total={total} onPage={setPage} />
      {pending && <ConfirmBulkActionDialog title={pending.kind === 'bulk-archive' || pending.kind === 'archive' ? 'Archive agents' : 'Pause agents'} body="This keeps run history. It does not delete the agent." confirmLabel={pending.kind === 'bulk-archive' || pending.kind === 'archive' ? 'Archive' : 'Pause'} busy={busy} onCancel={() => setPending(null)} onConfirm={confirmPending} />}
    </ManagementPageLayout>
  );
}
