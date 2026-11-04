'use client';
import React, { useEffect, useState } from 'react';
import { managementRequest, openNavigation, productActivity, resolveNavigation } from '../../lib/auth-client';
import { recallNavigation, rememberNavigation } from '../../lib/navigation-context';
import {
  ConfirmDialog, DataTable, EmptyState, ErrorState, FilterPanel, FormActions, LoadingState,
  ManagementPageHeader, ManagementPageLayout, PageSizeSelector, PaginationControls, PermissionGate,
  RecordFormLayout, RowActionMenu, SearchInput, StatusBadge, UnsavedChangesGuard,
} from './kit';

const TYPES = ['SOFTWARE', 'PHYSICAL', 'PROFESSIONAL_SERVICE', 'SUBSCRIPTION', 'DIGITAL', 'CUSTOM', 'OTHER'];

async function remember(resourceType, action, extra = {}) {
  const opened = await openNavigation({ resourceType, action, ...extra });
  rememberNavigation(resourceType, action, opened.token);
  return opened;
}

export default function LiveDesk({ page, mode, permissions = [], notify, onNavigate }) {
  const canWrite = permissions.includes('products.write');
  const canManageOrg = permissions.includes('organizations.manage');
  const canAudit = permissions.includes('audit.read');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [query, setQuery] = useState('');
  const [sortDirection, setSortDirection] = useState('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [record, setRecord] = useState(null);
  const [activity, setActivity] = useState([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [form, setForm] = useState({});

  async function loadList() {
    setLoading(true);
    setError('');
    try {
      const path = { organizations: 'organizations/list', sessions: 'sessions/list', invitations: 'invitations/list', audit: 'audit/list' }[page];
      if (!path) { setLoading(false); return; }
      const result = await managementRequest(path, { q: query, page: pageNumber, pageSize, sortDirection, sortBy: page === 'organizations' ? 'name' : 'createdAt' });
      setRows(result.items);
      setTotal(result.total);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!['organizations', 'sessions', 'invitations', 'audit'].includes(page) || mode !== 'list') return undefined;
    const timer = setTimeout(() => { loadList(); }, 300);
    return () => clearTimeout(timer);
  }, [page, mode, query, pageNumber, pageSize, sortDirection]);

  useEffect(() => {
    if (mode === 'list' || page === 'audit') return undefined;
    const resourceType = { products: 'product', organizations: 'organization', icps: 'icp', knowledge: 'knowledge_document', defaults: 'product_defaults', sessions: 'session', invitations: 'invitation' }[page];
    const token = recallNavigation(resourceType, mode);
    if (!token) { setRecord(null); setLoading(false); return undefined; }
    let cancelled = false;
    setLoading(true);
    resolveNavigation(token).then(async (context) => {
      if (cancelled) return;
      if (mode === 'add') { setRecord(context); setLoading(false); return; }
      if (page === 'products') {
        const product = await managementRequest('products/get', { id: context.resourceId });
        const events = await productActivity(context.resourceId).catch(() => []);
        if (!cancelled) { setRecord(product); setForm(product); setActivity(events); }
      } else if (page === 'organizations') {
        const organization = await managementRequest('organizations/get', { id: context.resourceId });
        if (!cancelled) { setRecord(organization); setForm(organization); }
      } else if (page === 'icps') {
        const icp = await managementRequest('icps/get', { productId: context.parentId, id: context.resourceId });
        if (!cancelled) { setRecord({ ...icp, productId: context.parentId }); setForm({ ...icp, productId: context.parentId }); }
      } else if (page === 'knowledge') {
        const document = await managementRequest('knowledge/get', { productId: context.parentId, id: context.resourceId });
        if (!cancelled) setRecord({ ...document, productId: context.parentId });
      } else if (page === 'defaults') {
        const defaults = await managementRequest('defaults/get', {});
        if (!cancelled) { setRecord(defaults); setForm(defaults); }
      }
      if (!cancelled) setLoading(false);
    }).catch((cause) => { if (!cancelled) { setError(cause.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [page, mode]);

  async function saveProduct(event) {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === 'add') {
        const created = await managementRequest('products/create', { name: form.name, productType: form.productType || 'SOFTWARE', category: form.category || '', shortDescription: form.shortDescription || '', currency: form.currency || 'USD' });
        await remember('product', 'view', { resourceId: created.id });
        notify('Product created.');
        onNavigate('products', 'view');
      } else {
        await managementRequest('products/update', { id: record.id, name: form.name, productType: form.productType, category: form.category, shortDescription: form.shortDescription, detailedDescription: form.detailedDescription, currency: form.currency, expectedUpdatedAt: record.updatedAt });
        notify('Product saved.');
        setDirty(false);
        onNavigate('products', 'view');
      }
    } catch (cause) {
      notify(cause.message);
    } finally {
      setBusy(false);
    }
  }

  if (page === 'products' && (mode === 'add' || mode === 'edit')) {
    return (
      <ManagementPageLayout>
        <PermissionGate allowed={canWrite}>
          <RecordFormLayout title={mode === 'add' ? 'Add Product' : 'Edit Product'} onSubmit={saveProduct}>
            <UnsavedChangesGuard dirty={dirty} />
            {loading && mode === 'edit' && <LoadingState label="Loading product…" />}
            {error && <ErrorState message={error} />}
            {(mode === 'add' || record) && <>
              <label>Name <span className="required">*</span><input required value={form.name || ''} onChange={(event) => { setForm({ ...form, name: event.target.value }); setDirty(true); }} /></label>
              <label>Type<select value={form.productType || 'SOFTWARE'} onChange={(event) => { setForm({ ...form, productType: event.target.value }); setDirty(true); }}>{TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
              <label>Category<input value={form.category || ''} onChange={(event) => { setForm({ ...form, category: event.target.value }); setDirty(true); }} /></label>
              <label>Currency<input value={form.currency || 'USD'} maxLength={3} onChange={(event) => { setForm({ ...form, currency: event.target.value.toUpperCase() }); setDirty(true); }} /></label>
              <label className="wide">Short description<textarea value={form.shortDescription || ''} onChange={(event) => { setForm({ ...form, shortDescription: event.target.value }); setDirty(true); }} /></label>
              <FormActions>
                <button className="btn" type="button" onClick={() => onNavigate('products', 'list')}>Cancel</button>
                <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
              </FormActions>
            </>}
          </RecordFormLayout>
        </PermissionGate>
      </ManagementPageLayout>
    );
  }

  if (page === 'products' && mode === 'view') {
    return (
      <ManagementPageLayout>
        <ManagementPageHeader title="Product Details" actions={<button className="btn" type="button" onClick={() => onNavigate('products', 'list')}>Back to catalog</button>} />
        {loading && <LoadingState label="Loading product…" />}
        {error && <ErrorState message={error} />}
        {!loading && !record && <EmptyState title="Choose a product from the catalog" subtitle="Refresh keeps the product selected in this browser tab." />}
        {record && <section className="panel"><h3>{record.name}</h3><p><StatusBadge>{record.status}</StatusBadge> {record.productType} · {record.currency}</p><p>Updated {record.updatedAt}</p><RowActionMenu label="Product actions">{canWrite && <button className="btn" type="button" onClick={async () => { await remember('product', 'edit', { resourceId: record.id }); onNavigate('products', 'edit'); }}>Edit</button>}{canWrite && record.status === 'ACTIVE' && <button className="btn btn-danger" type="button" onClick={() => setConfirm(record)}>Archive</button>}</RowActionMenu><h3>Activity</h3>{activity.length ? <ul>{activity.slice(0, 12).map((event) => <li key={event.id}>{event.action} · {event.createdAt}</li>)}</ul> : <p>No activity is recorded yet.</p>}</section>}
        {confirm && <ConfirmDialog title="Archive product" body={`Archive ${confirm.name}? The catalog row can be restored. Published versions stay immutable.`} confirmLabel="Archive" busy={busy} onCancel={() => setConfirm(null)} onConfirm={async () => { setBusy(true); try { await managementRequest('products/archive', { id: confirm.id }); notify('Product archived.'); setConfirm(null); onNavigate('products', 'list'); } catch (cause) { notify(cause.message); } finally { setBusy(false); } }} />}
      </ManagementPageLayout>
    );
  }

  if (page === 'defaults') {
    return (
      <ManagementPageLayout>
        <PermissionGate allowed={canWrite || permissions.includes('products.read')}>
          <RecordFormLayout title="Edit Organization Defaults" onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            try {
              await managementRequest('defaults/update', { knowledgeRetentionDays: Number(form.knowledgeRetentionDays || 0), expectedUpdatedAt: record?.updatedAt || undefined });
              notify('Organization defaults saved.');
              setDirty(false);
            } catch (cause) { notify(cause.message); } finally { setBusy(false); }
          }}>
            <UnsavedChangesGuard dirty={dirty} />
            {loading && <LoadingState label="Loading defaults…" />}
            <label>Knowledge retention days<input type="number" min="0" max="3650" value={form.knowledgeRetentionDays ?? 0} onChange={(event) => { setForm({ ...form, knowledgeRetentionDays: event.target.value }); setDirty(true); }} disabled={!canWrite} /></label>
            <p className="product-note wide">Zero deletes stored bytes when a document is removed. A positive value keeps the bytes until the retention date. Published snapshots are not rewritten.</p>
            <FormActions><button className="btn" type="button" onClick={() => onNavigate('products', 'list')}>Cancel</button>{canWrite && <button className="btn btn-primary" type="submit" disabled={busy}>Save</button>}</FormActions>
          </RecordFormLayout>
        </PermissionGate>
      </ManagementPageLayout>
    );
  }

  if (page === 'icps') {
    return (
      <ManagementPageLayout>
        <RecordFormLayout title={mode === 'add' ? 'Add ICP' : mode === 'edit' ? 'Edit ICP' : 'ICP Details'} onSubmit={async (event) => {
          event.preventDefault();
          if (mode === 'view') return;
          setBusy(true);
          try {
            if (mode === 'add') await managementRequest('icps/create', { productId: record?.parentId, name: form.name, priority: Number(form.priority || 1), industries: String(form.industries || '').split('\n').map((item) => item.trim()).filter(Boolean) });
            else await managementRequest('icps/update', { productId: record.productId, id: record.id, name: form.name, priority: Number(form.priority || record.priority || 1) });
            notify(mode === 'add' ? 'ICP added.' : 'ICP saved.');
            onNavigate('products', 'list');
          } catch (cause) { notify(cause.message); } finally { setBusy(false); }
        }}>
          <UnsavedChangesGuard dirty={dirty} />
          {error && <ErrorState message={error} />}
          <label>Name <span className="required">*</span><input required value={form.name || ''} onChange={(event) => { setForm({ ...form, name: event.target.value }); setDirty(true); }} disabled={mode === 'view'} /></label>
          <label>Priority<input type="number" min="1" value={form.priority || 1} onChange={(event) => { setForm({ ...form, priority: event.target.value }); setDirty(true); }} disabled={mode === 'view'} /></label>
          {mode === 'add' && <label className="wide">Target industries<textarea value={form.industries || ''} onChange={(event) => { setForm({ ...form, industries: event.target.value }); setDirty(true); }} /></label>}
          <FormActions><button className="btn" type="button" onClick={() => onNavigate('products', 'list')}>Cancel</button>{mode !== 'view' && canWrite && <button className="btn btn-primary" type="submit" disabled={busy}>Save</button>}</FormActions>
        </RecordFormLayout>
      </ManagementPageLayout>
    );
  }

  if (page === 'knowledge') {
    return (
      <ManagementPageLayout>
        <ManagementPageHeader title={mode === 'add' ? 'Add Knowledge Document' : 'Knowledge Document Details'} actions={<button className="btn" type="button" onClick={() => onNavigate('products', 'list')}>Back to catalog</button>} />
        {mode === 'add' && <form className="panel" onSubmit={async (event) => {
          event.preventDefault();
          const file = event.currentTarget.elements.file.files?.[0];
          if (!file || !record?.parentId) return;
          const contentBase64 = await fileToBase64(file);
          setBusy(true);
          try {
            await managementRequest('knowledge/upload', { productId: record.parentId, fileName: file.name, contentBase64 });
            notify('Document uploaded and processed.');
            onNavigate('products', 'list');
          } catch (cause) { notify(cause.message); } finally { setBusy(false); }
        }}><label>Knowledge file<input name="file" type="file" required /></label><button className="btn btn-primary" type="submit" disabled={busy}>Upload document</button></form>}
        {mode !== 'add' && record && <section className="panel"><h3>{record.fileName}</h3><p><StatusBadge>{record.status}</StatusBadge></p><p>{record.failureReason || 'Processing state is stored on the document.'}</p>{canWrite && <button className="btn btn-danger" type="button" onClick={() => setConfirm(record)}>Delete</button>}</section>}
        {confirm && <ConfirmDialog title="Delete document" body={`Delete ${confirm.fileName}? Retention still applies, and this does not rewrite a published version.`} confirmLabel="Delete document" busy={busy} onCancel={() => setConfirm(null)} onConfirm={async () => { setBusy(true); try { await managementRequest('knowledge/delete', { productId: confirm.productId, id: confirm.id }); notify('Document deleted.'); onNavigate('products', 'list'); } catch (cause) { notify(cause.message); } finally { setBusy(false); } }} />}
      </ManagementPageLayout>
    );
  }

  const title = { organizations: mode === 'add' ? 'Add Organization' : mode === 'edit' ? 'Edit Organization' : mode === 'view' ? 'Organization Details' : 'Organizations', sessions: 'Sessions', invitations: 'Invitations', audit: 'Security and activity events' }[page] || 'Records';
  return (
    <ManagementPageLayout>
      <ManagementPageHeader title={title} description={page === 'audit' ? 'Audit records are append-only.' : page === 'sessions' ? 'Revoke a session. Sessions are not hard-deleted.' : page === 'invitations' ? 'Pending invitations can be revoked. Email addresses stay hashed.' : 'Organizations you can access.'} actions={page === 'organizations' && <button className="btn btn-primary" type="button" onClick={async () => { await remember('organization', 'add'); onNavigate('organizations', 'add'); }}>Add Organization</button>} />
      {page === 'organizations' && mode === 'add' && <RecordFormLayout title="Add Organization" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { const created = await managementRequest('organizations/create', { name: form.name }); notify('Organization created and selected.'); await remember('organization', 'view', { resourceId: created.id }); onNavigate('organizations', 'view'); } catch (cause) { notify(cause.message); } finally { setBusy(false); } }}><label>Name <span className="required">*</span><input required value={form.name || ''} onChange={(event) => setForm({ name: event.target.value })} /></label><FormActions><button className="btn" type="button" onClick={() => onNavigate('settings', 'list')}>Cancel</button><button className="btn btn-primary" disabled={busy}>Save</button></FormActions></RecordFormLayout>}
      {page === 'organizations' && mode === 'edit' && <PermissionGate allowed={canManageOrg}><RecordFormLayout title="Edit Organization" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { await managementRequest('organizations/update', { id: record.id, name: form.name, status: form.status }); notify('Organization saved.'); setDirty(false); } catch (cause) { notify(cause.message); } finally { setBusy(false); } }}><UnsavedChangesGuard dirty={dirty} /><label>Name<input value={form.name || ''} onChange={(event) => { setForm({ ...form, name: event.target.value }); setDirty(true); }} /></label><label>Status<select value={form.status || 'ACTIVE'} onChange={(event) => { setForm({ ...form, status: event.target.value }); setDirty(true); }}><option>ACTIVE</option><option>SUSPENDED</option></select></label><FormActions><button className="btn" type="button" onClick={() => onNavigate('organizations', 'view')}>Cancel</button><button className="btn btn-primary" disabled={busy}>Save changes</button></FormActions></RecordFormLayout></PermissionGate>}
      {page === 'organizations' && mode === 'view' && record && <section className="panel"><h3>{record.name}</h3><p><StatusBadge>{record.status}</StatusBadge> {record.slug}</p>{canManageOrg && <button className="btn" type="button" onClick={async () => { await remember('organization', 'edit', { resourceId: record.id }); onNavigate('organizations', 'edit'); }}>Edit</button>}</section>}
      {['organizations', 'sessions', 'invitations', 'audit'].includes(page) && mode === 'list' && <>
        {page === 'audit' && !canAudit && <ErrorState message="You do not have permission to read the audit log." />}
        <FilterPanel>
          <SearchInput id={`${page}-search`} label="Search" value={query} onChange={(value) => { setQuery(value); setPageNumber(1); }} />
          <PageSizeSelector value={pageSize} onChange={(size) => { setPageSize(size); setPageNumber(1); }} />
          <button className="btn" type="button" onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}>Sort {sortDirection === 'asc' ? 'ascending' : 'descending'}</button>
          <button className="btn" type="button" onClick={loadList}>Refresh</button>
        </FilterPanel>
        {loading && <LoadingState />}
        {error && <ErrorState message={error} onRetry={loadList} />}
        {!loading && !error && !rows.length && <EmptyState title="Nothing to show" subtitle="Records appear here when this organization has them." />}
        {!loading && !error && !!rows.length && <DataTable label={title}><thead><tr><th>Record</th><th>Status</th><th></th></tr></thead><tbody>{rows.map((item) => <tr key={item.id || item.userId}><td>{item.name || item.roleName || item.action || item.userAgent || 'Session'}</td><td>{item.status || item.entityType || (item.current ? 'Current' : 'Active')}</td><td>{page === 'sessions' && !item.current && <button className="btn" type="button" onClick={() => setConfirm({ kind: 'session', id: item.id })}>Revoke</button>}{page === 'invitations' && item.status === 'PENDING' && <button className="btn" type="button" onClick={() => setConfirm({ kind: 'invitation', id: item.id })}>Revoke</button>}{page === 'organizations' && <button className="btn" type="button" onClick={async () => { await remember('organization', 'view', { resourceId: item.id }); setRecord(item); onNavigate('organizations', 'view'); }}>View</button>}</td></tr>)}</tbody></DataTable>}
        <PaginationControls page={pageNumber} pageSize={pageSize} total={total} onPage={setPageNumber} />
      </>}
      {confirm && <ConfirmDialog title="Confirm revoke" body="This revokes access. It does not erase the audit history." confirmLabel="Revoke" busy={busy} onCancel={() => setConfirm(null)} onConfirm={async () => { setBusy(true); try { await managementRequest(confirm.kind === 'session' ? 'sessions/revoke' : 'invitations/revoke', { id: confirm.id }); notify('Revoked.'); setConfirm(null); await loadList(); } catch (cause) { notify(cause.message); } finally { setBusy(false); } }} />}
    </ManagementPageLayout>
  );
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
