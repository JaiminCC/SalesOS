'use client';
import React, { useEffect, useState } from 'react';
import { managementRequest, openNavigation, resolveNavigation } from '../../lib/auth-client';
import { recallNavigation, rememberNavigation } from '../../lib/navigation-context';
import {
  ConfirmDialog, DataTable, EmptyState, ErrorState, FilterPanel, FormActions, LoadingState,
  ManagementPageHeader, ManagementPageLayout, PageSizeSelector, PaginationControls, PermissionGate,
  RecordDetailsLayout, RecordFormLayout, SearchInput, StatusBadge, UnsavedChangesGuard,
} from './kit';

const emptyForm = { name: '', provider: 'fake', model: 'fake-1', baseUrl: '', apiKey: '', inputPriceMinorPerMillion: 0, outputPriceMinorPerMillion: 0, allowPrivateHttp: false, isDefault: false, enabled: true };

export default function ModelsDesk({ mode, organizationId, permissions = [], notify, onNavigate }) {
  const canManage = permissions.includes('agents.manage');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(mode === 'list');
  const [error, setError] = useState('');
  const [record, setRecord] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const result = await managementRequest('models/list', { q: query, page, pageSize });
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
  }, [mode, organizationId, query, page, pageSize]);

  useEffect(() => {
    if (mode === 'list' || mode === 'add') return undefined;
    const token = recallNavigation('model_configuration', mode);
    if (!token) { setError('Open this model from the list again.'); return undefined; }
    let cancelled = false;
    setLoading(true);
    resolveNavigation(token).then(async (context) => {
      const model = await managementRequest('models/get', { id: context.resourceId });
      if (cancelled) return;
      setRecord(model);
      setForm({ ...emptyForm, ...model, apiKey: '', baseUrl: model.baseUrl || '' });
      setLoading(false);
    }).catch((cause) => { if (!cancelled) { setError(cause.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [mode, organizationId]);

  async function openRecord(item, action) {
    const opened = await openNavigation({ resourceType: 'model_configuration', action, resourceId: item.id });
    rememberNavigation('model_configuration', action, opened.token);
    onNavigate('models', action);
  }

  function change(field, value) {
    setForm({ ...form, [field]: value });
    setDirty(true);
  }

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const body = { ...form, inputPriceMinorPerMillion: Number(form.inputPriceMinorPerMillion) || 0, outputPriceMinorPerMillion: Number(form.outputPriceMinorPerMillion) || 0 };
      if (!body.apiKey) delete body.apiKey;
      if (!body.baseUrl) delete body.baseUrl;
      if (mode === 'add') await managementRequest('models/create', body);
      else await managementRequest('models/update', { ...body, id: record.id });
      notify(mode === 'add' ? 'Model configuration saved.' : 'Model configuration updated.');
      setDirty(false);
      onNavigate('models', 'list');
    } catch (cause) {
      notify(cause.message);
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'add' || mode === 'edit') {
    return (
      <ManagementPageLayout>
        <PermissionGate allowed={canManage}>
          <RecordFormLayout title={mode === 'add' ? 'Add model' : 'Edit model'} onSubmit={save}>
            <UnsavedChangesGuard dirty={dirty} />
            <label>Name<input value={form.name} required onChange={(event) => change('name', event.target.value)} /></label>
            <label>Provider<select aria-label="Provider" value={form.provider} onChange={(event) => change('provider', event.target.value)}><option value="fake">Mock</option><option value="openai_compatible">OpenAI-compatible</option><option value="ollama">Ollama</option></select></label>
            <label>Model<input value={form.model} required onChange={(event) => change('model', event.target.value)} /></label>
            {form.provider !== 'fake' && <label>Endpoint<input value={form.baseUrl} onChange={(event) => change('baseUrl', event.target.value)} placeholder="https://example.com/v1" /></label>}
            {form.provider !== 'fake' && <label>API credential<input type="password" value={form.apiKey} autoComplete="off" onChange={(event) => change('apiKey', event.target.value)} placeholder={record?.configured ? 'Stored credential kept if blank' : 'Credential'} /></label>}
            <label>Input price per million tokens<input type="number" min="0" value={form.inputPriceMinorPerMillion} onChange={(event) => change('inputPriceMinorPerMillion', event.target.value)} /></label>
            <label>Output price per million tokens<input type="number" min="0" value={form.outputPriceMinorPerMillion} onChange={(event) => change('outputPriceMinorPerMillion', event.target.value)} /></label>
            <label><input type="checkbox" checked={Boolean(form.isDefault)} onChange={(event) => change('isDefault', event.target.checked)} /> Default model</label>
            {form.provider !== 'fake' && <label><input type="checkbox" checked={Boolean(form.allowPrivateHttp)} onChange={(event) => change('allowPrivateHttp', event.target.checked)} /> Allow loopback HTTP for this development endpoint</label>}
            <FormActions>
              <button className="btn" type="button" onClick={() => onNavigate('models', 'list')}>Cancel</button>
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
        {loading && <LoadingState label="Loading model…" />}
        {error && <ErrorState message={error} onRetry={() => onNavigate('models', 'list')} />}
        {record && (
          <RecordDetailsLayout title={record.name} actions={<>
            <button className="btn" type="button" onClick={() => onNavigate('models', 'list')}>Back</button>
            {canManage && <button className="btn" type="button" onClick={() => openRecord(record, 'edit')}>Edit</button>}
            {canManage && <button className="btn" type="button" disabled={busy} onClick={async () => { setBusy(true); try { const result = await managementRequest('models/test', { id: record.id }); notify(`Connection test succeeded for ${result.provider}.`); } catch (cause) { notify(cause.message); } finally { setBusy(false); } }}>Test connection</button>}
            {canManage && record.enabled && <button className="btn" type="button" onClick={() => setPending(true)}>Disable</button>}
          </>}>
            <p><StatusBadge>{record.provider === 'fake' ? 'MOCK' : 'LIVE'}</StatusBadge> <StatusBadge>{record.enabled ? 'ENABLED' : 'DISABLED'}</StatusBadge></p>
            <p>Provider {record.provider}. Model {record.model}. {record.isDefault ? 'Default.' : ''}</p>
            <p>{record.configured ? `Credential stored, ending ${record.credentialHint || 'hidden'}.` : 'No credential stored.'}</p>
            <p>Prices are minor currency units per million tokens: input {record.inputPriceMinorPerMillion}, output {record.outputPriceMinorPerMillion} {record.currency}.</p>
          </RecordDetailsLayout>
        )}
        {pending && <ConfirmDialog title="Disable model" body="Runs cannot start with a disabled model. Stored credentials stay encrypted." confirmLabel="Disable" busy={busy} onCancel={() => setPending(false)} onConfirm={async () => {
          setBusy(true);
          try {
            await managementRequest('models/update', { id: record.id, name: record.name, provider: record.provider, model: record.model, baseUrl: record.baseUrl || undefined, enabled: false, isDefault: false, inputPriceMinorPerMillion: record.inputPriceMinorPerMillion, outputPriceMinorPerMillion: record.outputPriceMinorPerMillion });
            notify('Model disabled.');
            setPending(false);
            onNavigate('models', 'list');
          } catch (cause) {
            notify(cause.message);
          } finally {
            setBusy(false);
          }
        }} />}
      </ManagementPageLayout>
    );
  }

  return (
    <ManagementPageLayout>
      <ManagementPageHeader eyebrow="MODEL GATEWAY" title="Model configurations" description="Secrets stay on the server. A mock provider is used only when it is explicitly selected." actions={canManage && <button className="btn btn-primary" type="button" onClick={async () => { const opened = await openNavigation({ resourceType: 'model_configuration', action: 'add' }); rememberNavigation('model_configuration', 'add', opened.token); onNavigate('models', 'add'); }}>Add model</button>} />
      <FilterPanel>
        <SearchInput id="model-search" label="Search models" value={query} onChange={(value) => { setQuery(value); setPage(1); }} />
        <PageSizeSelector value={pageSize} onChange={(size) => { setPageSize(size); setPage(1); }} />
      </FilterPanel>
      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && !rows.length && <EmptyState title="No model configurations" subtitle="Add a mock or provider configuration before starting a run." />}
      {!loading && !error && !!rows.length && (
        <DataTable label="Model configurations">
          <thead><tr><th>Name</th><th>Provider</th><th>Status</th></tr></thead>
          <tbody>{rows.map((item) => (
            <tr key={item.id}>
              <td><button type="button" className="linkish" onClick={() => openRecord(item, 'view').catch((cause) => notify(cause.message))}>{item.name}</button></td>
              <td>{item.provider === 'fake' ? 'MOCK' : item.provider}</td>
              <td><StatusBadge>{item.enabled ? 'ENABLED' : 'DISABLED'}</StatusBadge></td>
            </tr>
          ))}</tbody>
        </DataTable>
      )}
      <PaginationControls page={page} pageSize={pageSize} total={total} onPage={setPage} />
    </ManagementPageLayout>
  );
}
