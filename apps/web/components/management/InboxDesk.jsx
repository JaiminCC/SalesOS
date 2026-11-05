'use client';
import React, { useEffect, useState } from 'react';
import { managementRequest, openNavigation, resolveNavigation } from '../../lib/auth-client';
import { recallNavigation, rememberNavigation } from '../../lib/navigation-context';
import { ConfirmDialog, DataTable, EmptyState, ErrorState, FormActions, LoadingState, ManagementPageHeader, ManagementPageLayout, PageSizeSelector, PaginationControls, RecordDetailsLayout, RecordFormLayout, SearchInput } from './kit';

const SECTIONS = [
  ['connections', 'Mailboxes', 'mailbox_connection'],
  ['threads', 'Inbox', 'mailbox_thread'],
  ['drafts', 'Drafts', 'mailbox_draft'],
  ['approvals', 'Approvals', 'mailbox_draft'],
  ['delivery', 'Delivery', 'mailbox_draft'],
  ['sending', 'Sending', 'mailbox_draft'],
];

export default function InboxDesk({ mode, permissions = [], notify, onNavigate }) {
  const [section, setSection] = useState('connections');
  const [sectionReady, setSectionReady] = useState(false);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [query, setQuery] = useState('');
  const [record, setRecord] = useState(null);
  const [form, setForm] = useState({ address: '', subject: '', body: '', recipients: '', cc: '', bcc: '', connectionId: '', text: '' });
  const [providers, setProviders] = useState([]);
  const [mailboxes, setMailboxes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [choices, setChoices] = useState({ contacts: [], leads: [], members: [] });
  const [linkForm, setLinkForm] = useState({ subjectType: 'contact', subjectId: '', ownerUserId: '' });
  const current = SECTIONS.find((item) => item[0] === section) ?? SECTIONS[0];
  const canConnect = permissions.includes('mailbox.connect');
  const canDraft = permissions.includes('mailbox.draft');
  const canSend = permissions.includes('mailbox.send');
  const canReview = permissions.includes('mailbox.review');
  const canInvestigate = permissions.includes('mailbox.send.review');
  const [confirm, setConfirm] = useState('');
  const [quota, setQuota] = useState(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    const saved = window.sessionStorage.getItem('salesos-inbox-section');
    if (saved && SECTIONS.some((item) => item[0] === saved)) setSection(saved);
    setSectionReady(true);
  }, []);

  function chooseSection(next) {
    window.sessionStorage.setItem('salesos-inbox-section', next);
    setSection(next);
    setPage(1);
  }

  useEffect(() => {
    if (mode !== 'list') return undefined;
    let cancelled = false;
    setLoading(true);
    const path = section === 'threads' ? 'threads/list' : section === 'drafts' || section === 'approvals' ? 'drafts/list' : section === 'delivery' || section === 'sending' ? 'delivery/list' : 'mailboxes/list';
    Promise.all([
      managementRequest('mailboxes/providers', {}),
      managementRequest(path, { q: query, page, pageSize, sortBy: 'createdAt', sortDirection: 'desc' }),
      managementRequest('email-sending/status', {}),
    ]).then(([sources, result, sending]) => {
      if (cancelled) return;
      setQuota(sending);
      setProviders(sources.providers || []);
      setRows(result.items || []);
      setTotal(result.total || 0);
      if (section === 'connections') setMailboxes(result.items || []);
      setLoading(false);
    }).catch((cause) => { if (!cancelled) { setError(cause.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [mode, section, page, pageSize, query]);

  useEffect(() => {
    if (mode === 'list' || section === 'connections') return undefined;
    let cancelled = false;
    managementRequest('mailboxes/list', { page: 1, pageSize: 100 }).then((result) => {
      if (!cancelled) setMailboxes(result.items || []);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [mode, section]);

  useEffect(() => {
    if (!sectionReady || mode === 'list' || mode === 'add') return undefined;
    const token = recallNavigation(current[2], 'view');
    if (!token) { setError('Open this record from the list again.'); return undefined; }
    let cancelled = false;
    resolveNavigation(token).then(async (context) => {
      const loaded = section === 'threads'
      ? await managementRequest('threads/get', { id: context.resourceId })
      : section === 'drafts' || section === 'approvals'
        ? await managementRequest('drafts/get', { id: context.resourceId })
        : section === 'sending' || section === 'delivery'
          ? await managementRequest('delivery/get', { id: context.resourceId })
          : await managementRequest('mailboxes/get', { id: context.resourceId });
      if (!cancelled) { setRecord(loaded); setError(''); setLoading(false); }
    }).catch((cause) => { if (!cancelled) setError(cause.message); });
    return () => { cancelled = true; };
  }, [mode, section, current, sectionReady]);

  useEffect(() => {
    if (mode !== 'edit' || !record) return;
    setForm((currentForm) => ({
      ...currentForm,
      connectionId: record.connectionId || currentForm.connectionId,
      subject: record.subject || '',
      body: record.body || '',
      recipients: Array.isArray(record.recipients) ? record.recipients.join(', ') : currentForm.recipients,
      cc: Array.isArray(record.cc) ? record.cc.join(', ') : currentForm.cc,
      bcc: Array.isArray(record.bcc) ? record.bcc.join(', ') : currentForm.bcc,
    }));
  }, [mode, record]);

  useEffect(() => {
    if (mode !== 'view' || section !== 'threads') return undefined;
    let cancelled = false;
    Promise.all([
      managementRequest('contacts/list', { page: 1, pageSize: 50 }),
      managementRequest('leads/list', { page: 1, pageSize: 50 }),
      managementRequest('members/list', { page: 1, pageSize: 50, sortBy: 'displayName', sortDirection: 'asc' }),
    ]).then(([contacts, leads, members]) => {
      if (!cancelled) setChoices({ contacts: contacts.items || [], leads: leads.items || [], members: members.items || [] });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [mode, section, record]);

  async function openRow(item, action = 'view') {
    const opened = await openNavigation({ resourceType: current[2], action, resourceId: item.id });
    rememberNavigation(current[2], action, opened.token);
    onNavigate('inbox', action);
  }

  return (
    <ManagementPageLayout>
      <ManagementPageHeader eyebrow="SEND DISABLED" title="Inbox" description="Capture mailboxes and drafts. Live providers and live sending stay unconfigured." actions={mode === 'list' && canConnect && section === 'connections' ? <button className="btn btn-primary" type="button" onClick={() => onNavigate('inbox', 'add')}>Add mailbox</button> : mode === 'list' && section === 'threads' && canConnect ? <button className="btn btn-primary" type="button" onClick={() => onNavigate('inbox', 'add')}>Import</button> : mode === 'list' && (section === 'drafts' || section === 'approvals') && canDraft ? <button className="btn btn-primary" type="button" onClick={() => onNavigate('inbox', 'add')}>Add draft</button> : null} />
      {mode === 'list' && SECTIONS.map(([id, label]) => <button key={id} type="button" className={section === id ? 'btn btn-primary' : 'btn'} onClick={() => chooseSection(id)}>{label}</button>)}
      {loading && <LoadingState label="Loading mailbox…" />}
      {error && <ErrorState message={error} onRetry={() => setQuery(query)} />}
      {mode === 'list' && !loading && (
        <>
          <p>{providers.map((item) => `${item.label}: ${item.availability}`).join(' · ')} · LIVE SEND NOT CONFIGURED</p>
          <p>Read-only mailbox. Approval does not send. Capture stays unsent.</p>
          {section === 'sending' && <p>SEND DISABLED · READ ONLY · SEND SCOPE REQUIRED · Attachments NOT SUPPORTED · DELIVERY UNKNOWN is not retried. Hourly cap {quota?.hourlyCap ?? 20}. Daily cap {quota?.dailyCap ?? 100}. Recipient limit {quota?.maxRecipients ?? 5}. Reserved {quota?.reserved ?? 0}. Accepted {quota?.accepted ?? 0}. Uncertain {quota?.uncertain ?? 0}.</p>}
          <SearchInput id="inbox-search" label="Search" value={query} onChange={(value) => { setQuery(value); setPage(1); }} />
          <PageSizeSelector value={pageSize} onChange={(value) => { setPageSize(value); setPage(1); }} />
          {!rows.length ? <EmptyState title="No mailbox records" subtitle="Add a capture mailbox to import messages you provide. External mailboxes are not configured." /> : (
            <DataTable label={current[1]}>
              <thead><tr><th>Record</th><th>Status</th><th /></tr></thead>
              <tbody>{rows.map((item) => <tr key={item.id}><td>{item.address || item.subject || item.state || 'Record'}</td><td>{item.label || item.status || item.state || ''}</td><td><button type="button" className="btn" onClick={() => openRow(item)}>View</button>{(section === 'drafts' || section === 'approvals') && canDraft ? <button type="button" className="btn" onClick={() => openRow(item, 'edit')}>Edit</button> : null}</td></tr>)}</tbody>
            </DataTable>
          )}
          <PaginationControls page={page} pageSize={pageSize} total={total} onPage={setPage} />
        </>
      )}
      {mode === 'add' && section === 'connections' && (
        <RecordFormLayout title="Add capture mailbox" onSubmit={(event) => { event.preventDefault(); managementRequest('mailboxes/capture', { address: form.address }).then((saved) => { setForm({ ...form, connectionId: saved.id }); notify('Capture mailbox created. It is not a live provider.'); onNavigate('inbox', 'list'); }).catch((cause) => setError(cause.message)); }}>
          <label htmlFor="address">Mailbox address<input id="address" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} required /></label>
          <p>Google Workspace and Microsoft 365 are NOT CONFIGURED.</p>
          <FormActions><button className="btn" type="button" onClick={() => onNavigate('inbox', 'list')}>Cancel</button><button className="btn btn-primary" type="submit">Save</button></FormActions>
        </RecordFormLayout>
      )}
      {mode === 'add' && section === 'threads' && (
        <RecordFormLayout title="Import a message" onSubmit={(event) => { event.preventDefault(); const connectionId = form.connectionId || mailboxes[0]?.id; managementRequest('mailbox-sync/import', { connectionId, messages: [{ providerMessageId: `local-${Date.now()}`, internetMessageId: `<${Date.now()}@example>`, sender: 'buyer@example.com', subject: 'Question', text: form.text || 'Can you share the published details?', provenance: 'USER PROVIDED MAIL' }] }).then(() => { notify('Message imported. No mailbox was contacted.'); chooseSection('threads'); onNavigate('inbox', 'list'); }).catch((cause) => setError(cause.message)); }}>
          <label htmlFor="connection">Capture mailbox<select id="connection" value={form.connectionId} onChange={(event) => setForm({ ...form, connectionId: event.target.value })} required><option value="">Choose a mailbox</option>{mailboxes.map((item) => <option key={item.id} value={item.id}>{item.address}</option>)}</select></label>
          <label htmlFor="text">Message<textarea id="text" value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} /></label>
          <FormActions><button className="btn" type="button" onClick={() => onNavigate('inbox', 'list')}>Cancel</button><button className="btn btn-primary" type="submit">Import</button></FormActions>
        </RecordFormLayout>
      )}
      {(mode === 'add' || mode === 'edit') && (section === 'drafts' || section === 'approvals') && canDraft && (
        <RecordFormLayout title={mode === 'edit' ? 'Edit draft' : 'Add draft'} onSubmit={(event) => { event.preventDefault(); const connectionId = form.connectionId || record?.connectionId || mailboxes[0]?.id; const revoked = record?.status === 'APPROVED'; const split = (value) => value.split(',').map((item) => item.trim()).filter(Boolean); managementRequest('drafts/save', { id: mode === 'edit' ? record?.id : undefined, connectionId, subject: form.subject, body: form.body, recipients: split(form.recipients), cc: split(form.cc), bcc: split(form.bcc) }).then(() => { notify(revoked ? 'Approval revoked. The draft was not sent.' : 'Draft saved. It was not sent.'); onNavigate('inbox', 'list'); }).catch((cause) => setError(cause.message)); }}>
          {mode === 'add' && <label htmlFor="draft-connection">Mailbox<select id="draft-connection" value={form.connectionId} onChange={(event) => setForm({ ...form, connectionId: event.target.value })} required><option value="">Choose a mailbox</option>{mailboxes.map((item) => <option key={item.id} value={item.id}>{item.address}</option>)}</select></label>}
          <label htmlFor="subject">Subject<input id="subject" value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} required /></label>
          <label htmlFor="body">Body<textarea id="body" value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} required /></label>
          <label htmlFor="recipients">To<input id="recipients" value={form.recipients} onChange={(event) => setForm({ ...form, recipients: event.target.value })} /></label>
          <label htmlFor="cc">Cc<input id="cc" value={form.cc} onChange={(event) => setForm({ ...form, cc: event.target.value })} /></label>
          <label htmlFor="bcc">Bcc<input id="bcc" value={form.bcc} onChange={(event) => setForm({ ...form, bcc: event.target.value })} /></label>
          <FormActions><button className="btn" type="button" onClick={() => onNavigate('inbox', 'list')}>Cancel</button><button className="btn btn-primary" type="submit">Save draft</button></FormActions>
        </RecordFormLayout>
      )}
      {mode === 'view' && record && (
        <RecordDetailsLayout title={record.subject || record.address || 'Mailbox'} actions={<button className="btn" type="button" onClick={() => onNavigate('inbox', 'list')}>Back</button>}>
          {record.label && <p>{record.label} · live {String(record.live)}</p>}
          {record.status && <p>Status {record.status}</p>}
          {record.body && <p>{record.body}</p>}
          {record.ownerUserId && <p>Human owner</p>}
          {record.links?.map((item) => <p key={item.id}>Linked {item.subjectType}{canDraft ? <button type="button" className="btn" onClick={() => managementRequest('threads/unlink', { id: record.id, linkId: item.id }).then(() => managementRequest('threads/get', { id: record.id }).then(setRecord)).catch((cause) => setError(cause.message))}>Unlink</button> : null}</p>)}
          {section === 'threads' && canDraft && (
            <form onSubmit={(event) => { event.preventDefault(); managementRequest('threads/link', { id: record.id, subjectType: linkForm.subjectType, subjectId: linkForm.subjectId }).then(() => managementRequest('threads/get', { id: record.id }).then(setRecord)).catch((cause) => setError(cause.message)); }}>
              <label htmlFor="link-type">CRM record<select id="link-type" value={linkForm.subjectType} onChange={(event) => setLinkForm({ ...linkForm, subjectType: event.target.value, subjectId: '' })}><option value="contact">Contact</option><option value="lead">Lead</option></select></label>
              <label htmlFor="link-record">Record<select id="link-record" value={linkForm.subjectId} onChange={(event) => setLinkForm({ ...linkForm, subjectId: event.target.value })} required><option value="">Choose</option>{(linkForm.subjectType === 'lead' ? choices.leads : choices.contacts).map((item) => <option key={item.id} value={item.id}>{item.name || item.account?.displayName || item.subject || 'Record'}</option>)}</select></label>
              <button className="btn" type="submit">Link</button>
            </form>
          )}
          {section === 'threads' && canDraft && (
            <form onSubmit={(event) => { event.preventDefault(); managementRequest('threads/assign', { id: record.id, ownerUserId: linkForm.ownerUserId }).then(() => managementRequest('threads/get', { id: record.id }).then((loaded) => { setRecord(loaded); notify('Human owner assigned. Nothing was sent.'); })).catch((cause) => setError(cause.message)); }}>
              <label htmlFor="owner">Conversation owner<select id="owner" value={linkForm.ownerUserId} onChange={(event) => setLinkForm({ ...linkForm, ownerUserId: event.target.value })} required><option value="">Choose a member</option>{choices.members.map((item) => <option key={item.userId} value={item.userId}>{item.displayName}</option>)}</select></label>
              <button className="btn" type="submit">Assign owner</button>
            </form>
          )}
          {record.messages?.map((item) => <article key={item.id}><p>{item.sender}</p><p>{item.text}</p></article>)}
          {record.analyses?.map((item) => <article key={item.summary}><p>AI summary</p><p>{item.summary}</p><p>{item.modelProvider ? `${item.modelProvider} ${item.modelName ?? ''}` : 'MOCK'}</p></article>)}
          {record.versions?.map((item) => <p key={item.version}>Version {item.version}</p>)}
          {section === 'connections' && canConnect && <button className="btn" type="button" onClick={() => setConfirm('disconnect')}>Disconnect</button>}
          {(section === 'drafts' || section === 'approvals') && canDraft && record.id && <button className="btn" type="button" onClick={() => managementRequest('drafts/submit', { id: record.id }).then(() => notify('Submitted for review. Nothing was sent.')).catch((cause) => setError(cause.message))}>Submit for review</button>}
          {section === 'approvals' && canReview && record.id && <button className="btn" type="button" onClick={() => managementRequest('email-approvals/decide', { id: record.id, decision: 'APPROVED' }).then(() => notify('Approved. Nothing was sent.')).catch((cause) => setError(cause.message))}>Approve</button>}
          {section === 'drafts' && canSend && record.id && <p>SEND DISABLED. No SEND NOW action while live sending is off. Approval does not dispatch.</p>}
          {(section === 'sending' || section === 'delivery') && record.state && <p>State {record.state}. Reservation {record.reservation || 'none'}. Sent {String(record.sent)}. Reconciliation {record.reconciliation || 'none'}.</p>}
          {(section === 'sending' || section === 'delivery') && record.events?.map((item) => <p key={`${item.kind}-${item.createdAt}`}>{item.kind}</p>)}
          {(section === 'sending' || section === 'delivery') && canInvestigate && record.id && (
            <form onSubmit={(event) => { event.preventDefault(); setConfirm('investigate'); }}>
              <label htmlFor="investigation">Investigation note<textarea id="investigation" value={note} onChange={(event) => setNote(event.target.value)} required /></label>
              <button className="btn" type="submit">Record investigation</button>
            </form>
          )}
        </RecordDetailsLayout>
      )}
      {confirm === 'disconnect' && record && <ConfirmDialog title="Disconnect mailbox" body="Stored tokens are cleared. This does not send email." confirmLabel="Disconnect" onCancel={() => setConfirm('')} onConfirm={() => managementRequest('mailboxes/disconnect', { id: record.id }).then(() => { setConfirm(''); notify('Mailbox disconnected.'); onNavigate('inbox', 'list'); })} />}
      {confirm === 'investigate' && record && <ConfirmDialog title="Record investigation" body="This note does not mark the message delivered and does not change the provider result." confirmLabel="Record note" onCancel={() => setConfirm('')} onConfirm={() => managementRequest('delivery/investigate', { id: record.id, note }).then(() => managementRequest('delivery/get', { id: record.id })).then((loaded) => { setRecord(loaded); setConfirm(''); notify('Investigation recorded. Provider state was not changed.'); }).catch((cause) => setError(cause.message))} />}
    </ManagementPageLayout>
  );
}
