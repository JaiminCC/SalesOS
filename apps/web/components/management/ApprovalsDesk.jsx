'use client';
import React, { useEffect, useState } from 'react';
import { managementRequest, openNavigation, resolveNavigation } from '../../lib/auth-client';
import { recallNavigation, rememberNavigation } from '../../lib/navigation-context';
import {
  ConfirmDialog, DataTable, EmptyState, ErrorState, FilterPanel, LoadingState, ManagementPageHeader,
  ManagementPageLayout, PageSizeSelector, PaginationControls, PermissionGate, RecordDetailsLayout, SearchInput, StatusBadge,
} from './kit';

export default function ApprovalsDesk({ mode, organizationId, permissions = [], notify, onNavigate }) {
  const canReview = permissions.includes('approvals.manage') || permissions.includes('approvals.review');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(mode === 'list');
  const [error, setError] = useState('');
  const [record, setRecord] = useState(null);
  const [pending, setPending] = useState(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const result = await managementRequest('approvals/list', { q: query, status: status || undefined, page, pageSize });
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
  }, [mode, organizationId, query, status, page, pageSize]);

  useEffect(() => {
    if (mode !== 'view') return undefined;
    const token = recallNavigation('agent_approval', 'view');
    if (!token) { setError('Open this approval from the list again.'); return undefined; }
    let cancelled = false;
    setLoading(true);
    resolveNavigation(token).then(async (context) => {
      const approval = await managementRequest('approvals/get', { id: context.resourceId });
      if (!cancelled) { setRecord(approval); setLoading(false); }
    }).catch((cause) => { if (!cancelled) { setError(cause.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [mode, organizationId]);

  async function openRecord(item) {
    const opened = await openNavigation({ resourceType: 'agent_approval', action: 'view', resourceId: item.id });
    rememberNavigation('agent_approval', 'view', opened.token);
    onNavigate('approvals', 'view');
  }

  async function decide() {
    setBusy(true);
    try {
      const saved = await managementRequest('approvals/decide', { id: record.id, decision: pending, payloadSha256: record.payloadSha256, comment });
      notify(saved.decision === 'APPROVED' ? 'Approved. The proposal was not sent.' : `Decision recorded: ${saved.decision}.`);
      setPending(null);
      onNavigate('approvals', 'list');
    } catch (cause) {
      notify(cause.message);
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'view') {
    return (
      <ManagementPageLayout>
        {loading && <LoadingState label="Loading approval…" />}
        {error && <ErrorState message={error} onRetry={() => onNavigate('approvals', 'list')} />}
        {record && (
          <RecordDetailsLayout title={record.actionType} actions={<>
            <button className="btn" type="button" onClick={() => onNavigate('approvals', 'list')}>Back</button>
            {canReview && record.decision === 'PENDING' && <button className="btn btn-primary" type="button" onClick={() => setPending('APPROVED')}>Approve</button>}
            {canReview && record.decision === 'PENDING' && <button className="btn" type="button" onClick={() => setPending('REJECTED')}>Reject</button>}
            {canReview && record.decision === 'PENDING' && <button className="btn" type="button" onClick={() => setPending('CHANGES_REQUESTED')}>Request changes</button>}
          </>}>
            <p><StatusBadge>{record.decision}</StatusBadge> <StatusBadge>{record.riskLevel}</StatusBadge></p>
            <p>This approval is bound to the proposed payload. Approving it does not send an email or WhatsApp message.</p>
            <p>Requested {new Date(record.requestedAt).toLocaleString()}. Expires {new Date(record.expiresAt).toLocaleString()}.</p>
            {record.decidedAt && <p>Decided {new Date(record.decidedAt).toLocaleString()}. {record.comment || ''}</p>}
            <label>Comment<textarea value={comment} onChange={(event) => setComment(event.target.value)} /></label>
          </RecordDetailsLayout>
        )}
        {pending && <ConfirmDialog title={pending === 'APPROVED' ? 'Approve proposal' : pending === 'REJECTED' ? 'Reject proposal' : 'Request changes'} body="The decision is stored once. Approval does not send the proposal." confirmLabel={pending === 'APPROVED' ? 'Approve' : pending === 'REJECTED' ? 'Reject' : 'Request changes'} busy={busy} onCancel={() => setPending(null)} onConfirm={decide} />}
      </ManagementPageLayout>
    );
  }

  return (
    <ManagementPageLayout>
      <PermissionGate allowed={canReview || permissions.includes('agents.read')}>
        <ManagementPageHeader eyebrow="LIVE APPROVALS" title="Approval Center" description="Decisions are stored for this organization. An approved external proposal is not sent." />
        <FilterPanel>
          <SearchInput id="approval-search" label="Search approvals" value={query} onChange={(value) => { setQuery(value); setPage(1); }} />
          <label>Decision<select aria-label="Filter by decision" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All</option>{['PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'EXPIRED'].map((item) => <option key={item}>{item}</option>)}</select></label>
          <PageSizeSelector value={pageSize} onChange={(size) => { setPageSize(size); setPage(1); }} />
        </FilterPanel>
        {loading && <LoadingState />}
        {error && <ErrorState message={error} onRetry={load} />}
        {!loading && !error && !rows.length && <EmptyState title="No approvals" subtitle="A draft proposal creates an approval. Nothing is sent automatically." />}
        {!loading && !error && !!rows.length && (
          <DataTable label="Approvals">
            <thead><tr><th>Action</th><th>Decision</th><th>Requested</th></tr></thead>
            <tbody>{rows.map((item) => (
              <tr key={item.id}>
                <td><button type="button" className="linkish" onClick={() => openRecord(item).catch((cause) => notify(cause.message))}>{item.actionType}</button></td>
                <td><StatusBadge>{item.decision}</StatusBadge></td>
                <td>{new Date(item.requestedAt).toLocaleString()}</td>
              </tr>
            ))}</tbody>
          </DataTable>
        )}
        <PaginationControls page={page} pageSize={pageSize} total={total} onPage={setPage} />
      </PermissionGate>
    </ManagementPageLayout>
  );
}
