'use client';
import React, { useEffect, useState } from 'react';
import { currentSession, listProducts, managementRequest, openNavigation, resolveNavigation } from '../../lib/auth-client';
import { recallNavigation, rememberNavigation } from '../../lib/navigation-context';
import {
  BulkActionToolbar, ConfirmDialog, DataTable, EmptyState, ErrorState, FilterPanel, FormActions,
  LoadingState, ManagementPageHeader, ManagementPageLayout, PageSizeSelector, PaginationControls,
  PermissionGate, RecordDetailsLayout, RecordFormLayout, SearchInput, SelectionCheckbox, StatusBadge, UnsavedChangesGuard,
} from './kit';

const SECTIONS = [
  ['accounts', 'Companies', 'crm_account', 'crm.accounts.write'],
  ['contacts', 'Contacts', 'crm_contact', 'crm.contacts.write'],
  ['leads', 'Leads', 'crm_lead', 'crm.leads.write'],
  ['imports', 'Import', 'crm_import', 'crm.leads.import'],
  ['discovery', 'Discovery', 'crm_discovery', 'crm.leads.discover'],
  ['suppression', 'Suppression', 'crm_suppression', 'crm.suppression.manage'],
  ['duplicates', 'Duplicates', 'crm_duplicate', 'crm.leads.merge'],
  ['policy', 'Contact windows', 'crm_policy', 'crm.contact_policy.manage'],
];

const emptyAccount = { legalName: '', website: '', industry: '', country: '', sizeRange: '', description: '' };
const emptyContact = { name: '', jobTitle: '', email: '', accountId: '' };
const emptyLead = { accountId: '', productId: '', icpName: '', sourceType: 'manual' };

export default function LeadsDesk({ mode, organizationId, permissions = [], notify, onNavigate }) {
  const [section, setSection] = useState('accounts');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortBy, setSortBy] = useState('createdAt');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [record, setRecord] = useState(null);
  const [form, setForm] = useState(emptyAccount);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState([]);
  const [confirm, setConfirm] = useState(null);
  const [products, setProducts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [csv, setCsv] = useState('companyName,website,industry,country,contactName,jobTitle,email,phone,source\n');
  const [providers, setProviders] = useState([]);
  const [externalDiscovery, setExternalDiscovery] = useState('EXTERNAL DISCOVERY — NOT CONFIGURED');
  const [userId, setUserId] = useState('');
  const current = SECTIONS.find((item) => item[0] === section) ?? SECTIONS[0];

  function choose(next) {
    setSection(next);
    setPage(1);
    setSelected([]);
    setQuery('');
    setSortBy('createdAt');
    sessionStorage.setItem('salesos.crm.section', next);
    if (mode !== 'list') onNavigate('leads', 'list');
  }

  async function loadList() {
    setLoading(true);
    setError('');
    try {
      const listPath = { accounts: 'accounts/list', contacts: 'contacts/list', leads: 'leads/list', imports: 'lead-imports/list', discovery: 'discovery/list', suppression: 'suppression/list', duplicates: 'duplicates/list' }[section];
      if (section === 'policy') {
        setRecord(await managementRequest('contact-policies/get', {}));
        setForm(await managementRequest('contact-policies/get', {}));
      } else if (listPath) {
        const result = await managementRequest(listPath, { q: query, page, pageSize, sortBy, sortDirection: 'asc' });
        setRows(result.items || []);
        setTotal(result.total || 0);
      }
      if (section === 'leads' || section === 'accounts') setSummary(await managementRequest('leads/summary', {}));
      if (section === 'discovery') {
        const sources = await managementRequest('discovery/providers', {});
        setProviders(sources.providers || []);
        setExternalDiscovery(sources.external?.status === 'NOT_CONFIGURED' ? 'EXTERNAL DISCOVERY — NOT CONFIGURED' : sources.external?.status || 'EXTERNAL DISCOVERY — NOT CONFIGURED');
      }
    } catch (cause) {
      setError(cause.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const stored = sessionStorage.getItem('salesos.crm.section');
    if (stored) setSection(stored);
  }, []);

  useEffect(() => {
    if (mode !== 'list' || !organizationId) return undefined;
    const timer = setTimeout(() => { loadList(); }, 200);
    return () => clearTimeout(timer);
  }, [mode, organizationId, section, query, page, pageSize, sortBy]);

  useEffect(() => {
    if (!organizationId) return undefined;
    currentSession().then((session) => setUserId(session?.user?.id || '')).catch(() => setUserId(''));
    listProducts('?pageSize=100').then((result) => setProducts(result.items)).catch(() => setProducts([]));
    managementRequest('accounts/list', { pageSize: 100 }).then((result) => setAccounts(result.items)).catch(() => setAccounts([]));
    return undefined;
  }, [organizationId]);

  useEffect(() => {
    if (mode === 'list' || mode === 'add') {
      if (mode === 'add') {
        setRecord(null);
        setForm(section === 'contacts' ? emptyContact : section === 'leads' ? emptyLead : emptyAccount);
        setDirty(false);
      }
      return undefined;
    }
    const token = recallNavigation(current[2], mode);
    if (!token) { setError('Open this record from the list again.'); return undefined; }
    let cancelled = false;
    setLoading(true);
    resolveNavigation(token).then(async (context) => {
      const path = section === 'imports' ? 'lead-imports/get' : section === 'discovery' ? 'discovery/get' : `${section === 'duplicates' ? 'duplicates' : section}/get`;
      const loaded = section === 'policy' ? await managementRequest('contact-policies/get', {}) : await managementRequest(path, { id: context.resourceId });
      if (cancelled) return;
      setRecord(loaded);
      setForm(loaded);
      setLoading(false);
    }).catch((cause) => { if (!cancelled) { setError(cause.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [mode, organizationId, section]);

  async function openRecord(item, action) {
    const opened = await openNavigation({ resourceType: current[2], action, resourceId: item.id });
    rememberNavigation(current[2], action, opened.token);
    onNavigate('leads', action);
  }

  function change(field, value) {
    setForm({ ...form, [field]: value });
    setDirty(true);
  }

  async function saveAccount(event) {
    event.preventDefault();
    const saved = record
      ? await managementRequest('accounts/update', { ...form, id: record.id, revision: record.revision })
      : await managementRequest('accounts/create', form);
    notify('Company saved.');
    setDirty(false);
    if (!record) choose('accounts');
    else setRecord(saved);
  }

  async function saveContact(event) {
    event.preventDefault();
    const body = { ...form, accountId: form.accountId || undefined };
    if (record) await managementRequest('contacts/update', { ...body, id: record.id, revision: record.revision });
    else await managementRequest('contacts/create', body);
    notify('Contact saved. Consent stays unknown until evidence is recorded.');
    setDirty(false);
    choose('contacts');
  }

  async function saveLead(event) {
    event.preventDefault();
    if (record) await managementRequest('leads/update', { id: record.id, revision: record.revision, icpName: form.icpName || undefined, sourceRef: form.sourceRef || undefined });
    else await managementRequest('leads/create', { ...form, productId: form.productId || undefined, icpName: form.icpName || undefined });
    notify('Lead saved. It is not authorized for outreach.');
    setDirty(false);
    choose('leads');
  }

  async function saveSuppression(event) {
    event.preventDefault();
    await managementRequest('suppression/create', { scope: form.scope || 'organization', reason: form.reason, subject: form.subject || undefined });
    notify('Suppression saved. No message was sent.');
    setDirty(false);
    choose('suppression');
  }

  async function savePolicy(event) {
    event.preventDefault();
    const saved = await managementRequest('contact-policies/update', {
      ...form,
      weekdays: String(form.weekdays || '1,2,3,4,5').split(',').map((item) => Number(item.trim())).filter((item) => !Number.isNaN(item)),
      holidays: String(form.holidays || '').split(',').map((item) => item.trim()).filter(Boolean),
      startMinute: Number(form.startMinute),
      endMinute: Number(form.endMinute),
      minimumIntervalHours: Number(form.minimumIntervalHours),
      maxAttempts: Number(form.maxAttempts),
    });
    setForm(saved);
    setRecord(saved);
    notify('Contact window saved. No message was sent.');
  }

  async function runImport() {
    const result = await managementRequest('lead-imports/execute', { fileName: 'import.csv', csv, policy: 'skip', idempotencyKey: `import-${Date.now()}` });
    notify(`Import ${result.status}. No messages were sent.`);
    setRecord(result);
  }

  async function runDiscovery() {
    const result = await managementRequest('discovery/create', { providerId: 'test', maxCandidates: 5, productId: products[0]?.id });
    notify('Discovery finished with the local test directory. It is not a live external source.');
    setRecord(result);
  }

  const canWrite = permissions.includes(current[3]);

  return (
    <ManagementPageLayout>
      <UnsavedChangesGuard dirty={dirty} />
      <ManagementPageHeader eyebrow="LIVE" title="Lead intelligence" description="Companies, evidence, qualification, and contact restrictions. Outreach is not sent from this screen." actions={mode === 'list' && canWrite && ['accounts', 'contacts', 'leads', 'suppression'].includes(section) ? <button type="button" className="btn btn-primary" onClick={() => onNavigate('leads', 'add')}>{section === 'accounts' ? 'Add company' : section === 'contacts' ? 'Add contact' : section === 'suppression' ? 'Add suppression' : 'Create lead'}</button> : null} />
      {mode === 'list' && (
        <FilterPanel>
          {SECTIONS.map((item) => <button key={item[0]} type="button" className={section === item[0] ? 'btn btn-primary' : 'btn'} onClick={() => choose(item[0])}>{item[1]}</button>)}
        </FilterPanel>
      )}
      {error && <ErrorState message={error} onRetry={loadList} />}
      {loading && mode === 'list' && <LoadingState />}
      {mode === 'list' && section === 'leads' && summary && (
        <p>Accounts {summary.accounts} · Contacts {summary.contacts} · Leads {summary.leads} · Qualified {summary.byStage?.QUALIFIED || 0} · Review {summary.byStage?.REVIEW_REQUIRED || 0} · Suppressed {summary.suppressed} · Human-owned {summary.humanOwned}</p>
      )}
      {mode === 'list' && !loading && section !== 'policy' && (
        <>
          <FilterPanel>
            <SearchInput id="crm-search" label="Search" value={query} onChange={(value) => { setQuery(value); setPage(1); }} />
            <PageSizeSelector value={pageSize} onChange={(value) => { setPageSize(value); setPage(1); }} />
            <button type="button" className="btn" onClick={() => setSortBy(section === 'leads' ? 'score' : 'displayName')}>Sort</button>
          </FilterPanel>
          <BulkActionToolbar count={selected.length}>
            {section === 'accounts' && <button type="button" className="btn" onClick={() => setConfirm('archive')}>Archive selected</button>}
            {section === 'leads' && permissions.includes('crm.leads.assign') && <button type="button" className="btn" onClick={() => setConfirm('assign')}>Assign me to selected</button>}
          </BulkActionToolbar>
          {!rows.length && !error ? <EmptyState title="No records" body="Add a company or import a CSV to begin." /> : (
            <DataTable label={current[1]}>
              <thead><tr><th /><th>Name</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td><SelectionCheckbox label={`Select ${row.displayName || row.name || row.reason || row.id}`} checked={selected.includes(row.id)} onChange={(checked) => setSelected(checked ? [...selected, row.id] : selected.filter((id) => id !== row.id))} /></td>
                    <td>{row.displayName || row.name || row.account?.displayName || row.fileName || row.providerId || row.subjectHint || row.reason}</td>
                    <td><StatusBadge>{row.stage || row.grade || row.lifecycleStatus || row.status || (row.active ? 'ACTIVE' : 'INACTIVE')}</StatusBadge></td>
                    <td><button type="button" className="btn" onClick={() => openRecord(row, 'view')}>View</button> {canWrite && ['accounts', 'contacts', 'leads'].includes(section) && <button type="button" className="btn" onClick={() => openRecord(row, 'edit')}>Edit</button>}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
          <PaginationControls page={page} pageSize={pageSize} total={total} onPage={setPage} />
        </>
      )}
      {mode === 'list' && section === 'imports' && (
        <RecordFormLayout title="CSV import" onSubmit={(event) => { event.preventDefault(); runImport().catch((cause) => setError(cause.message)); }}>
          <p>Local file only. Importing a contact does not permit marketing messages.</p>
          <label htmlFor="csv">CSV<textarea id="csv" value={csv} onChange={(event) => setCsv(event.target.value)} rows={8} /></label>
          <FormActions><button className="btn btn-primary" type="submit">Run import</button></FormActions>
          {record?.rows && <p>Status {record.status}. Rows {record.rowCount}. Errors {record.errorCount}.</p>}
        </RecordFormLayout>
      )}
      {mode === 'list' && section === 'discovery' && (
        <section className="panel">
          <h2>Prospect discovery</h2>
          <p>Available sources are manual entry and a deterministic test directory. Neither is a live third-party search.</p>
          <p>{externalDiscovery}</p>
          <ul>{providers.map((provider) => <li key={provider.id}>{provider.label} · {provider.availability}</li>)}</ul>
          <button type="button" className="btn btn-primary" onClick={() => runDiscovery().catch((cause) => setError(cause.message))}>Run test discovery</button>
          {record?.candidates && record.candidates.map((candidate) => <p key={candidate.id}>{candidate.name} · {candidate.domain} · {candidate.providerMode} · live {String(candidate.live)}</p>)}
        </section>
      )}
      {mode === 'list' && section === 'policy' && form && (
        <RecordFormLayout title="Contact windows" onSubmit={(event) => savePolicy(event).catch((cause) => setError(cause.message))}>
          <label htmlFor="timezone">IANA time zone<input id="timezone" value={form.timezone || ''} onChange={(event) => change('timezone', event.target.value)} /></label>
          <label htmlFor="weekdays">Weekdays<input id="weekdays" value={Array.isArray(form.weekdays) ? form.weekdays.join(',') : form.weekdays || ''} onChange={(event) => change('weekdays', event.target.value)} /></label>
          <label htmlFor="start">Start minute<input id="start" value={form.startMinute ?? 540} onChange={(event) => change('startMinute', event.target.value)} /></label>
          <label htmlFor="end">End minute<input id="end" value={form.endMinute ?? 1020} onChange={(event) => change('endMinute', event.target.value)} /></label>
          <FormActions><PermissionGate allowed={permissions.includes('crm.contact_policy.manage')}><button className="btn btn-primary" type="submit">Save policy</button></PermissionGate></FormActions>
        </RecordFormLayout>
      )}
      {(mode === 'add' || mode === 'edit') && section === 'accounts' && (
        <RecordFormLayout title={mode === 'add' ? 'Add company' : 'Edit company'} onSubmit={(event) => saveAccount(event).catch((cause) => setError(cause.message))}>
          <label htmlFor="legalName">Legal name<input id="legalName" value={form.legalName || ''} onChange={(event) => change('legalName', event.target.value)} required /></label>
          <label htmlFor="website">Website<input id="website" value={form.website || ''} onChange={(event) => change('website', event.target.value)} /></label>
          <label htmlFor="industry">Industry<input id="industry" value={form.industry || ''} onChange={(event) => change('industry', event.target.value)} /></label>
          <label htmlFor="country">Country<input id="country" value={form.country || ''} onChange={(event) => change('country', event.target.value)} /></label>
          <label htmlFor="sizeRange">Company size<input id="sizeRange" value={form.sizeRange || ''} onChange={(event) => change('sizeRange', event.target.value)} /></label>
          <label htmlFor="description">Description<textarea id="description" value={form.description || ''} onChange={(event) => change('description', event.target.value)} /></label>
          <FormActions><button className="btn" type="button" onClick={() => onNavigate('leads', 'list')}>Cancel</button><button className="btn btn-primary" type="submit">Save</button></FormActions>
        </RecordFormLayout>
      )}
      {(mode === 'add' || mode === 'edit') && section === 'contacts' && (
        <RecordFormLayout title={mode === 'add' ? 'Add contact' : 'Edit contact'} onSubmit={(event) => saveContact(event).catch((cause) => setError(cause.message))}>
          <label htmlFor="contactName">Name<input id="contactName" value={form.name || ''} onChange={(event) => change('name', event.target.value)} required /></label>
          <label htmlFor="jobTitle">Job title<input id="jobTitle" value={form.jobTitle || ''} onChange={(event) => change('jobTitle', event.target.value)} /></label>
          <label htmlFor="email">Business email<input id="email" value={form.email || ''} onChange={(event) => change('email', event.target.value)} /></label>
          <label htmlFor="accountId">Company<select id="accountId" value={form.accountId || ''} onChange={(event) => change('accountId', event.target.value)}><option value="">None</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.displayName}</option>)}</select></label>
          <FormActions><button className="btn" type="button" onClick={() => onNavigate('leads', 'list')}>Cancel</button><button className="btn btn-primary" type="submit">Save</button></FormActions>
        </RecordFormLayout>
      )}
      {(mode === 'add' || mode === 'edit') && section === 'leads' && (
        <RecordFormLayout title={mode === 'add' ? 'Create lead' : 'Edit lead'} onSubmit={(event) => saveLead(event).catch((cause) => setError(cause.message))}>
          {mode === 'add' && <label htmlFor="leadAccount">Company<select id="leadAccount" value={form.accountId || ''} onChange={(event) => change('accountId', event.target.value)} required><option value="">Choose</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.displayName}</option>)}</select></label>}
          {mode === 'add' && <label htmlFor="product">Product<select id="product" value={form.productId || ''} onChange={(event) => change('productId', event.target.value)}><option value="">None</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>}
          <label htmlFor="icp">ICP name<input id="icp" value={form.icpName || ''} onChange={(event) => change('icpName', event.target.value)} /></label>
          {mode === 'edit' && <label htmlFor="sourceRef">Source reference<input id="sourceRef" value={form.sourceRef || ''} onChange={(event) => change('sourceRef', event.target.value)} /></label>}
          <FormActions><button className="btn" type="button" onClick={() => onNavigate('leads', 'list')}>Cancel</button><button className="btn btn-primary" type="submit">Save</button></FormActions>
        </RecordFormLayout>
      )}
      {mode === 'add' && section === 'suppression' && (
        <RecordFormLayout title="Add suppression" onSubmit={(event) => saveSuppression(event).catch((cause) => setError(cause.message))}>
          <label htmlFor="scope">Scope<select id="scope" value={form.scope || 'organization'} onChange={(event) => change('scope', event.target.value)}><option value="organization">Organization</option><option value="account">Account</option><option value="contact">Contact</option><option value="email">Email</option><option value="phone">Phone</option><option value="channel">Channel</option></select></label>
          <label htmlFor="reason">Reason<input id="reason" value={form.reason || ''} onChange={(event) => change('reason', event.target.value)} required /></label>
          <label htmlFor="subject">Subject hint<input id="subject" value={form.subject || ''} onChange={(event) => change('subject', event.target.value)} /></label>
          <FormActions><button className="btn" type="button" onClick={() => onNavigate('leads', 'list')}>Cancel</button><button className="btn btn-primary" type="submit">Save</button></FormActions>
        </RecordFormLayout>
      )}
      {mode === 'view' && record && (
        <RecordDetailsLayout title={record.displayName || record.name || record.account?.displayName || 'Record'} actions={<button type="button" className="btn" onClick={() => onNavigate('leads', 'list')}>Back</button>}>
          <p>Source {record.source || record.sourceType || 'recorded'} · Verification {record.verificationStatus || record.employeeStatus || 'UNKNOWN'}</p>
          {record.stage && <p>Stage {record.stage} · Official score {record.score ?? 'UNRATED'}/100 · Grade {record.grade} · Eligibility {record.eligibilityState}</p>}
          {record.qualifications && <p>Qualification history is immutable.</p>}
          {record.assignments?.map((item, index) => <p key={`${item.startedAt}-${index}`}>{item.current ? 'Current assignment' : 'Ended assignment'} · {item.reason || 'Recorded'}</p>)}
          {record.audits?.map((item, index) => <p key={`${item.action}-${index}`}>Audit {item.action}</p>)}
          {record.qualifications?.map((item) => (
            <section key={item.id}>
              <h3>Official score {item.score}/100 · Grade {item.grade}</h3>
              <p>Deterministic assessment · {item.scoringVersion} · {item.createdAt}</p>
              {Array.isArray(item.dimensions) && <ul>{item.dimensions.map((dimension) => <li key={dimension.name}>{dimension.name}: {dimension.fit}</li>)}</ul>}
              <h3>{item.modelProvider ? 'Model explanation' : 'Stored explanation'}</h3>
              <p>{item.modelProvider ? `${item.modelProvider} · ${item.modelName}` : item.explanation?.includes('INSUFFICIENT_EXPLANATION') ? 'Deterministic explanation kept.' : 'No model was used.'}</p>
              <p>{item.explanation}</p>
              {item.overridden && <p>Human override · {item.overrideReason}</p>}
            </section>
          ))}
          {section === 'leads' && permissions.includes('crm.leads.qualify') && <button type="button" className="btn btn-primary" onClick={() => managementRequest('qualification/run', { id: record.id }).then(async (result) => { const fresh = await managementRequest('leads/get', { id: record.id }); setRecord(fresh); notify(`Score ${result.score}. No message was sent.`); }).catch((cause) => setError(cause.message))}>Run qualification</button>}
          {section === 'leads' && <button type="button" className="btn" onClick={() => managementRequest('eligibility/evaluate', { id: record.id }).then(async (result) => { const fresh = await managementRequest('leads/get', { id: record.id }); setRecord(fresh); notify(`Eligibility ${result.state}. Quiet hours ${result.quietHours.decision}. Nothing was sent.`); }).catch((cause) => setError(cause.message))}>Check eligibility</button>}
          {section === 'leads' && permissions.includes('crm.leads.assign') && <button type="button" className="btn" onClick={() => managementRequest('leads/assign', { id: record.id, revision: record.revision, ownerUserId: userId, reason: 'Human owner' }).then((saved) => { notify('Owner assignment recorded. Takeover was not removed.'); setRecord({ ...record, ...saved }); }).catch((cause) => setError(cause.message))}>Assign me as owner</button>}
          {section === 'accounts' && <button type="button" className="btn" onClick={() => setConfirm('one')}>Archive</button>}
          {section === 'suppression' && record.active && canWrite && <button type="button" className="btn" onClick={() => setConfirm('suppress')}>Remove suppression</button>}
          {section === 'duplicates' && record.status === 'OPEN' && permissions.includes('crm.leads.merge') && <button type="button" className="btn" onClick={() => setConfirm('merge')}>Review merge</button>}
        </RecordDetailsLayout>
      )}
      {confirm === 'assign' && (
        <ConfirmDialog title="Assign selected leads" body="The owner must be an active member of this organization. Changing the owner does not clear a human takeover." confirmLabel="Assign" onCancel={() => setConfirm(null)} onConfirm={() => {
          managementRequest('leads/bulk-assign', { ids: selected, ownerUserId: userId, reason: 'Human owner' }).then((result) => { notify(`Assigned ${result.updated}. Failed ${result.failed}. Takeover was not removed.`); setConfirm(null); setSelected([]); }).catch((cause) => setError(cause.message));
        }} />
      )}
      {confirm === 'suppress' && (
        <ConfirmDialog title="Remove suppression" body="The entry stays in history and stops applying. No message is sent." confirmLabel="Remove" onCancel={() => setConfirm(null)} onConfirm={() => {
          managementRequest('suppression/remove', { id: record.id }).then(() => { notify('Suppression removed.'); setConfirm(null); onNavigate('leads', 'list'); }).catch((cause) => setError(cause.message));
        }} />
      )}
      {confirm === 'merge' && (
        <ConfirmDialog title="Review duplicate" body="Merging keeps one company and records the decision. It does not send a message." confirmLabel="Merge" onCancel={() => setConfirm(null)} onConfirm={() => {
          managementRequest('duplicates/merge', { id: record.id }).then(() => { notify('Duplicate review recorded.'); setConfirm(null); onNavigate('leads', 'list'); }).catch((cause) => setError(cause.message));
        }} />
      )}
      {confirm && confirm !== 'assign' && confirm !== 'suppress' && confirm !== 'merge' && (
        <ConfirmDialog title="Archive records" body="Archived companies stay in the database for audit and suppression. They leave the active list." confirmLabel="Archive" onCancel={() => setConfirm(null)} onConfirm={() => {
          const ids = confirm === 'one' ? [record.id] : selected;
          managementRequest('accounts/archive', { ids }).then(() => { notify('Archive completed.'); setConfirm(null); setSelected([]); onNavigate('leads', 'list'); }).catch((cause) => setError(cause.message));
        }} />
      )}
    </ManagementPageLayout>
  );
}
