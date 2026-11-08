'use client';
import React, { useEffect, useState } from 'react';
import { managementRequest, openNavigation, resolveNavigation } from '../../lib/auth-client';
import { recallNavigation, rememberNavigation } from '../../lib/navigation-context';
import {
  DataTable, EmptyState, ErrorState, FilterPanel, FormActions, LoadingState, ManagementPageHeader,
  ManagementPageLayout, PageSizeSelector, PaginationControls, PermissionGate, RecordFormLayout, SearchInput, StatusBadge,
} from './kit';

const SECTIONS = ['overview', 'connections', 'phones', 'conversations', 'templates', 'alerts'];

export default function WhatsAppDesk({ mode, permissions = [], notify, onNavigate }) {
  const [section, setSection] = useState('overview');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [overview, setOverview] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ displayName: '', wabaId: '', providerPhoneId: '', displayNumber: '', name: '', body: 'Hello {{contact_first_name}}' });
  const canManage = permissions.includes('whatsapp.connections.manage');

  useEffect(() => { void load(); }, [section, page, pageSize, query, mode]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      setOverview(await managementRequest('whatsapp/overview', {}));
      if (section === 'conversations' && mode === 'view') {
        const token = recallNavigation('whatsapp_conversation');
        const resolved = token ? await resolveNavigation(token) : null;
        setDetail(resolved?.resourceId ? await managementRequest('whatsapp/conversations/get', { id: resolved.resourceId }) : null);
      } else if (section !== 'overview') {
        const path = section === 'connections' ? 'whatsapp/connections/list' : section === 'phones' ? 'whatsapp/phones/list' : section === 'templates' ? 'whatsapp/templates/list' : section === 'alerts' ? 'whatsapp/alerts/list' : 'whatsapp/conversations/list';
        const result = await managementRequest(path, { page, pageSize, query });
        const items = Array.isArray(result) ? result : result.rows || [];
        setRows(items);
        setTotal(Array.isArray(result) ? items.length : result.total || 0);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'WhatsApp records could not be loaded');
    } finally {
      setLoading(false);
    }
  }

  async function submit(event, path, body, message) {
    event.preventDefault();
    setError('');
    try {
      await managementRequest(path, body);
      notify(message);
      onNavigate('whatsapp', 'list');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The change was rejected');
    }
  }

  async function openRow(row, type) {
    const opened = await openNavigation({ resourceType: type, resourceId: row.id, action: 'view' });
    rememberNavigation(type, opened.token);
    if (type === 'whatsapp_conversation') { setSection('conversations'); onNavigate('whatsapp', 'view'); }
  }

  async function act(path, body, message) {
    try {
      await managementRequest(path, body);
      notify(message);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The change was rejected');
    }
  }

  return (
    <ManagementPageLayout>
      <ManagementPageHeader eyebrow="WHATSAPP" title="WhatsApp" description="LIVE WHATSAPP SENDING DISABLED. Local records and signed fixtures do not send a message." />
      <FilterPanel>
        {SECTIONS.map((id) => <button type="button" key={id} className={section === id ? 'btn btn-primary' : 'btn'} onClick={() => { setSection(id); setPage(1); if (mode !== 'list') onNavigate('whatsapp', 'list'); }}>{id[0].toUpperCase() + id.slice(1)}</button>)}
      </FilterPanel>
      {error && <ErrorState message={error} onRetry={load} />}
      {loading && <LoadingState />}
      {!loading && section === 'overview' && overview && (
        <div className="kpi-grid">
          {[['Meta', overview.liveMeta], ['Webhook', overview.realWebhook], ['Sending', overview.sending], ['App', overview.appReadiness], ['Connections', overview.connections], ['Phones', overview.phones], ['Unverified phones', overview.unverified], ['Conversations', overview.conversations], ['Unread', overview.unread], ['Pending drafts', overview.pendingDrafts], ['Human owned', overview.humanOwned], ['Opted out', overview.optedOut], ['Provider errors', overview.providerErrors], ['Provider-approved templates', overview.providerApprovedTemplates], ['Fixture statuses', overview.fixtureStatuses], ['Real provider statuses', overview.realProviderStatuses]].map(([label, value]) => <article className="kpi" key={label}><small>{label}</small><strong>{String(value)}</strong></article>)}
        </div>
      )}
      {!loading && mode === 'add' && section === 'connections' && (
        <PermissionGate allowed={canManage}>
          <RecordFormLayout title="Add WhatsApp connection" onSubmit={(event) => {
            if (!form.displayName.trim() || !form.wabaId.trim()) { event.preventDefault(); setError('A display name and WABA id are required.'); return; }
            return submit(event, 'whatsapp/connections/create', { displayName: form.displayName, wabaId: form.wabaId, mode: 'MANUAL' }, 'Connection saved. It is not verified with Meta, and sending stays disabled.');
          }}>
            <label>Display name<input aria-label="Display name" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>
            <label>WABA id<input aria-label="WABA id" value={form.wabaId} onChange={(event) => setForm({ ...form, wabaId: event.target.value })} /></label>
            <FormActions><button className="btn btn-primary" type="submit">Save connection</button></FormActions>
          </RecordFormLayout>
        </PermissionGate>
      )}
      {!loading && mode === 'add' && section === 'phones' && (
        <RecordFormLayout title="Add phone number" onSubmit={async (event) => {
          event.preventDefault();
          const list = await managementRequest('whatsapp/connections/list', { page: 1, pageSize: 1 });
          if (!list.rows?.[0]?.id) { setError('Add a connection before a phone number.'); return; }
          await submit({ preventDefault() {} }, 'whatsapp/phones/create', { connectionId: list.rows[0].id, providerPhoneId: form.providerPhoneId, displayNumber: form.displayNumber }, 'Phone number saved as unverified. Outbound remains disabled.');
        }}>
          <label>Provider phone id<input aria-label="Provider phone id" value={form.providerPhoneId} onChange={(event) => setForm({ ...form, providerPhoneId: event.target.value })} /></label>
          <label>Display number<input aria-label="Display number" value={form.displayNumber} onChange={(event) => setForm({ ...form, displayNumber: event.target.value })} /></label>
          <FormActions><button className="btn btn-primary" type="submit">Save phone</button></FormActions>
        </RecordFormLayout>
      )}
      {!loading && mode === 'add' && section === 'templates' && (
        <RecordFormLayout title="Add local template" onSubmit={(event) => submit(event, 'whatsapp/templates/create', { name: form.name, language: 'en', category: 'UTILITY', body: form.body }, 'Local template draft saved. Provider approval is unknown.')}>
          <label>Template name<input aria-label="Template name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>Body<textarea aria-label="Template body" value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} /></label>
          <FormActions><button className="btn btn-primary" type="submit">Save template</button></FormActions>
        </RecordFormLayout>
      )}
      {!loading && mode === 'view' && detail && (
        <article className="panel">
          <h2>{detail.conversation.customerE164}</h2>
          <StatusBadge>{detail.conversation.state}</StatusBadge>
          <p>Window {detail.conversation.windowState}. Intent {detail.conversation.intent} is a prediction.</p>
          <p>{detail.sending}</p>
          {detail.messages.map((message) => <p key={message.id}>{message.type}: {message.body || 'No text'} · {message.status || 'no provider status'} · {message.origin}</p>)}
          <button type="button" className="btn" onClick={() => act('whatsapp/drafts/prepare', { id: detail.conversation.id }, 'A reviewable suggestion was stored. It was not sent.')}>Generate suggestion</button>
          <button type="button" className="btn" onClick={() => act('whatsapp/conversations/assign', { id: detail.conversation.id, action: 'TAKE_OVER', reason: 'Owner review' }, 'Human takeover recorded.')}>Take over</button>
          <button type="button" className="btn" onClick={() => act('whatsapp/conversations/assign', { id: detail.conversation.id, action: 'RELEASE', reason: 'Released' }, 'Human takeover released.')}>Release</button>
        </article>
      )}
      {!loading && mode === 'list' && section !== 'overview' && (
        <>
          <SearchInput id="whatsapp-search" label="Search" value={query} onChange={(value) => { setQuery(value); setPage(1); }} />
          <PageSizeSelector value={pageSize} onChange={(value) => { setPageSize(value); setPage(1); }} />
          {section === 'connections' && <button type="button" className="btn" onClick={() => { setSection('connections'); onNavigate('whatsapp', 'add'); }}>Add connection</button>}
          {section === 'phones' && <button type="button" className="btn" onClick={() => { setSection('phones'); onNavigate('whatsapp', 'add'); }}>Add phone</button>}
          {section === 'templates' && <button type="button" className="btn" onClick={() => { setSection('templates'); onNavigate('whatsapp', 'add'); }}>Add template</button>}
          {section === 'alerts' && <button type="button" className="btn" onClick={() => act('whatsapp/events/process', {}, 'Received events were processed. Nothing was sent.')}>Process received events</button>}
          {rows.length === 0 ? <EmptyState title="Nothing here yet" subtitle="Records appear after a connection, phone, or signed webhook is stored." /> : (
            <DataTable label={section}>
              <thead><tr><th>Record</th><th>Status</th><th></th></tr></thead>
              <tbody>{rows.map((row) => <tr key={row.id}><td>{row.displayName || row.displayNumber || row.name || row.customerE164 || row.code}</td><td>{row.readiness || row.verificationState || row.providerStatus || row.state || row.summary}</td><td>{section !== 'alerts' && section !== 'phones' && <button type="button" className="btn" onClick={() => openRow(row, section === 'connections' ? 'whatsapp_connection' : section === 'templates' ? 'whatsapp_template' : 'whatsapp_conversation')}>View</button>}</td></tr>)}</tbody>
            </DataTable>
          )}
          <PaginationControls page={page} pageSize={pageSize} total={total} onPage={setPage} />
        </>
      )}
    </ManagementPageLayout>
  );
}
