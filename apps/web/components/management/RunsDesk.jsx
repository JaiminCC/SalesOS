'use client';
import React, { useEffect, useState } from 'react';
import { managementRequest, openNavigation, resolveNavigation } from '../../lib/auth-client';
import { recallNavigation, rememberNavigation } from '../../lib/navigation-context';
import {
  BulkActionToolbar, ConfirmDialog, DataTable, EmptyState, ErrorState, FilterPanel, LoadingState,
  ManagementPageHeader, ManagementPageLayout, PageSizeSelector, PaginationControls, RecordDetailsLayout,
  SearchInput, SelectionCheckbox, SortableColumnHeader, StatusBadge,
} from './kit';

export default function RunsDesk({ mode, organizationId, permissions = [], notify, onNavigate }) {
  const canManage = permissions.includes('agents.manage');
  const canPause = permissions.includes('automation.pause');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortDirection, setSortDirection] = useState('desc');
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
  const [goal, setGoal] = useState('Research the published product and draft a message');
  const [productId, setProductId] = useState('');
  const [modelId, setModelId] = useState('');
  const [products, setProducts] = useState([]);
  const [models, setModels] = useState([]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const result = await managementRequest('runs/list', { q: query, status: status || undefined, sortBy, sortDirection, page, pageSize });
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
    managementRequest('products/list', { page: 1, pageSize: 100 }).then((result) => setProducts(result.items || [])).catch(() => setProducts([]));
    managementRequest('models/list', { page: 1, pageSize: 100 }).then((result) => setModels(result.items || [])).catch(() => setModels([]));
  }, [mode, organizationId]);

  useEffect(() => {
    if (mode !== 'list' || !organizationId) return undefined;
    const timer = setTimeout(() => { load(); }, 250);
    return () => clearTimeout(timer);
  }, [mode, organizationId, query, status, sortBy, sortDirection, page, pageSize]);

  useEffect(() => {
    if (mode !== 'view') return undefined;
    const token = recallNavigation('agent_run', 'view');
    if (!token) { setError('Open this run from the list again.'); return undefined; }
    let cancelled = false;
    setLoading(true);
    resolveNavigation(token).then(async (context) => {
      const run = await managementRequest('runs/get', { id: context.resourceId });
      if (!cancelled) { setRecord(run); setLoading(false); }
    }).catch((cause) => { if (!cancelled) { setError(cause.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [mode, organizationId]);

  async function openRun(item) {
    const opened = await openNavigation({ resourceType: 'agent_run', action: 'view', resourceId: item.id });
    rememberNavigation('agent_run', 'view', opened.token);
    onNavigate('inspector', 'view');
  }

  async function startRun(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const run = await managementRequest('runs/create', { triggerType: 'TEST', goal, productId, modelConfigurationId: modelId });
      notify(`Run finished as ${run.state}. No outbound message was sent.`);
      await openRun(run);
    } catch (cause) {
      notify(cause.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmPending() {
    setBusy(true);
    try {
      const path = { cancel: 'runs/cancel', archive: 'runs/archive', pause: 'runs/pause', resume: 'runs/resume', 'bulk-cancel': 'runs/bulk-cancel', 'bulk-archive': 'runs/bulk-archive' }[pending.kind];
      await managementRequest(path, pending.ids ? { ids: pending.ids } : { id: pending.id });
      notify('The run was updated. Its steps were kept.');
      setPending(null);
      setSelected([]);
      if (mode === 'list') await load();
      else onNavigate('inspector', 'list');
    } catch (cause) {
      notify(cause.message);
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'view') {
    return (
      <ManagementPageLayout>
        {loading && <LoadingState label="Loading run…" />}
        {error && <ErrorState message={error} onRetry={() => onNavigate('inspector', 'list')} />}
        {record && (
          <RecordDetailsLayout title={`${record.triggerType} run`} actions={<>
            <button className="btn" type="button" onClick={() => onNavigate('inspector', 'list')}>Back</button>
            {canPause && ['QUEUED', 'RUNNING', 'WAITING_APPROVAL'].includes(record.state) && <button className="btn" type="button" onClick={() => setPending({ kind: 'pause', id: record.id })}>Pause</button>}
            {canPause && record.state === 'PAUSED' && <button className="btn" type="button" onClick={() => setPending({ kind: 'resume', id: record.id })}>Resume</button>}
            {canPause && ['QUEUED', 'RUNNING', 'PAUSED', 'WAITING_APPROVAL', 'FAILED_RETRYABLE'].includes(record.state) && <button className="btn" type="button" onClick={() => setPending({ kind: 'cancel', id: record.id })}>Cancel</button>}
            {canManage && !record.archivedAt && <button className="btn" type="button" onClick={() => setPending({ kind: 'archive', id: record.id })}>Archive</button>}
          </>}>
            <p><StatusBadge>{record.state}</StatusBadge> <StatusBadge>{record.modelProvider === 'fake' ? 'MOCK MODEL' : 'LIVE MODEL'}</StatusBadge></p>
            <p>{record.goal}</p>
            {record.errorCode && <p>Failure: {record.errorCode}</p>}
            {record.report?.summary && <p>Report: {record.report.summary}</p>}
            <h3>Plan</h3>
            {!!record.plan?.length && <DataTable label="Execution plan"><thead><tr><th>Tool</th></tr></thead><tbody>{record.plan.map((step) => <tr key={step.tool}><td>{step.tool}</td></tr>)}</tbody></DataTable>}
            <h3>Tool calls</h3>
            {!record.tools?.length && <EmptyState title="No tool calls yet" subtitle="The supervisor records each tool after it runs." />}
            {!!record.tools?.length && <DataTable label="Tool calls"><thead><tr><th>Tool</th><th>Status</th></tr></thead><tbody>{record.tools.map((tool) => <tr key={tool.id}><td>{tool.toolName}</td><td>{tool.status}</td></tr>)}</tbody></DataTable>}
            <h3>Citations</h3>
            {!record.citations?.length && <EmptyState title="No citations" subtitle="Approved knowledge excerpts are pinned when the published version has them." />}
            {!!record.citations?.length && <DataTable label="Citations"><thead><tr><th>Source</th></tr></thead><tbody>{record.citations.map((item) => <tr key={item.chunkId}><td>{item.fileName} {item.section || ''}</td></tr>)}</tbody></DataTable>}
            <h3>Usage</h3>
            {!record.usage?.length && <EmptyState title="No model usage" subtitle="Usage appears after a model step." />}
            {!!record.usage?.length && <DataTable label="Model usage"><thead><tr><th>Model</th><th>Tokens</th><th>Estimated cost</th><th>Source</th></tr></thead><tbody>{record.usage.map((item) => <tr key={item.id}><td>{item.provider} {item.model}</td><td>{item.inputTokens}/{item.outputTokens}</td><td>{item.costMinor}</td><td>{item.usageSource}</td></tr>)}</tbody></DataTable>}
            <h3>Steps</h3>
            {!record.steps?.length && <EmptyState title="No steps yet" subtitle="The worker writes steps. They are not typed in here." />}
            {!!record.steps?.length && <DataTable label="Run steps"><thead><tr><th>Step</th><th>Status</th></tr></thead><tbody>{record.steps.map((step) => <tr key={step.id}><td>{step.position}. {step.name}</td><td>{step.status}</td></tr>)}</tbody></DataTable>}
            <h3>Actions</h3>
            {!record.actions?.length && <EmptyState title="No actions" subtitle="Policy decisions appear here after the run executes." />}
            {!!record.actions?.length && <DataTable label="Run actions"><thead><tr><th>Action</th><th>Decision</th><th>State</th></tr></thead><tbody>{record.actions.map((action) => <tr key={action.id}><td>{action.actionType}</td><td>{action.policyDecision || '—'}</td><td>{action.state}</td></tr>)}</tbody></DataTable>}
          </RecordDetailsLayout>
        )}
        {pending && <ConfirmDialog title={pending.kind === 'archive' ? 'Archive run' : pending.kind === 'pause' ? 'Pause run' : pending.kind === 'resume' ? 'Resume run' : 'Cancel run'} body="Steps and actions stay in the database. This does not hard-delete history." confirmLabel={pending.kind === 'archive' ? 'Archive' : pending.kind === 'pause' ? 'Pause' : pending.kind === 'resume' ? 'Resume' : 'Cancel run'} busy={busy} onCancel={() => setPending(null)} onConfirm={confirmPending} />}
      </ManagementPageLayout>
    );
  }

  const pageIds = rows.map((item) => item.id);
  return (
    <ManagementPageLayout>
      <ManagementPageHeader eyebrow="LIVE EXECUTION" title="Execution Inspector" description="Runs, steps, and policy decisions come from the server. History is archived, not deleted." />
      {canManage && (
        <form className="mgmt-toolbar" onSubmit={startRun}>
          <label>Goal<input aria-label="Goal" value={goal} onChange={(event) => setGoal(event.target.value)} required /></label>
          <label>Product<select aria-label="Product" value={productId} onChange={(event) => setProductId(event.target.value)} required><option value="">Select a product</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Model<select aria-label="Model" value={modelId} onChange={(event) => setModelId(event.target.value)} required><option value="">Select a model</option>{models.filter((item) => item.enabled).map((item) => <option key={item.id} value={item.id}>{item.name}{item.provider === 'fake' ? ' (MOCK)' : ''}</option>)}</select></label>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Starting…' : 'Start run'}</button>
        </form>
      )}
      <FilterPanel>
        <SearchInput id="run-search" label="Search runs" value={query} onChange={(value) => { setQuery(value); setPage(1); }} />
        <label>State<select aria-label="Filter by state" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">Current runs</option>{['QUEUED', 'RUNNING', 'SUCCEEDED', 'WAITING_APPROVAL', 'PAUSED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'CANCELLED'].map((item) => <option key={item}>{item}</option>)}</select></label>
        <PageSizeSelector value={pageSize} onChange={(size) => { setPageSize(size); setPage(1); }} />
      </FilterPanel>
      <BulkActionToolbar count={selected.length}>
        {canPause && <button className="btn" type="button" onClick={() => setPending({ kind: 'bulk-cancel', ids: selected })}>Cancel selected</button>}
        {canManage && <button className="btn" type="button" onClick={() => setPending({ kind: 'bulk-archive', ids: selected })}>Archive selected</button>}
      </BulkActionToolbar>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && !rows.length && <EmptyState title="No runs match" subtitle="Start a test run to record a real execution." />}
      {!loading && !error && !!rows.length && (
        <DataTable label="Execution runs">
          <thead><tr>
            <th><SelectionCheckbox label="Select all runs on this page" checked={pageIds.length > 0 && pageIds.every((id) => selected.includes(id))} onChange={(checked) => setSelected(checked ? pageIds : [])} /></th>
            <SortableColumnHeader label="Trigger" active={sortBy === 'triggerType'} direction={sortDirection} onSort={() => { setSortDirection(sortBy === 'triggerType' && sortDirection === 'asc' ? 'desc' : 'asc'); setSortBy('triggerType'); setPage(1); }} />
            <SortableColumnHeader label="State" active={sortBy === 'state'} direction={sortDirection} onSort={() => { setSortDirection(sortBy === 'state' && sortDirection === 'asc' ? 'desc' : 'asc'); setSortBy('state'); setPage(1); }} />
            <SortableColumnHeader label="Created" active={sortBy === 'createdAt'} direction={sortDirection} onSort={() => { setSortDirection(sortBy === 'createdAt' && sortDirection === 'asc' ? 'desc' : 'asc'); setSortBy('createdAt'); setPage(1); }} />
          </tr></thead>
          <tbody>{rows.map((item) => (
            <tr key={item.id}>
              <td><SelectionCheckbox label={`Select ${item.triggerType} run`} checked={selected.includes(item.id)} onChange={(checked) => setSelected(checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))} /></td>
              <td><button type="button" className="linkish" onClick={() => openRun(item).catch((cause) => notify(cause.message))}>{item.goal || item.triggerType}</button></td>
              <td><StatusBadge>{item.state}</StatusBadge></td>
              <td>{new Date(item.createdAt).toLocaleString()}</td>
            </tr>
          ))}</tbody>
        </DataTable>
      )}
      <PaginationControls page={page} pageSize={pageSize} total={total} onPage={setPage} />
      {pending && <ConfirmDialog title={pending.kind.includes('archive') ? 'Archive runs' : pending.kind.includes('pause') ? 'Pause runs' : 'Cancel runs'} body="Historical steps stay stored." confirmLabel={pending.kind.includes('archive') ? 'Archive' : pending.kind.includes('pause') ? 'Pause' : 'Cancel runs'} busy={busy} onCancel={() => setPending(null)} onConfirm={confirmPending} />}
    </ManagementPageLayout>
  );
}
