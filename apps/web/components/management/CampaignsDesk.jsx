'use client';
import React, { useEffect, useState } from 'react';
import { listProducts, managementRequest, openNavigation, resolveNavigation } from '../../lib/auth-client';
import { recallNavigation, rememberNavigation } from '../../lib/navigation-context';
import {
  ConfirmDialog, DataTable, EmptyState, ErrorState, FilterPanel, FormActions, LoadingState,
  ManagementPageHeader, ManagementPageLayout, PageSizeSelector, PaginationControls, PermissionGate,
  RecordDetailsLayout, RecordFormLayout, SearchInput, StatusBadge, UnsavedChangesGuard,
} from './kit';

const SECTIONS = [
  ['campaigns', 'Campaigns', 'campaign', 'campaigns.create'],
  ['segments', 'Segments', 'audience_segment', 'campaigns.audience.manage'],
  ['sequences', 'Sequences', 'campaign_sequence', 'campaigns.sequence.manage'],
  ['templates', 'Templates', 'campaign_template', 'campaigns.template.manage'],
  ['monitor', 'Monitor', 'campaign', 'campaigns.simulate'],
  ['analytics', 'Analytics', 'campaign', 'campaigns.analytics.read'],
];

const emptyCampaign = { name: '', description: '', goal: '', campaignType: 'OUTREACH', timeZone: 'UTC', productVersionId: '', icpRef: '' };
const emptySegment = { name: '', description: '', kind: 'DYNAMIC', field: 'stage', operator: 'eq', value: 'QUALIFIED' };
const emptyTemplate = { name: '', subject: 'Hello {{company_name}}', bodyText: 'Hello {{contact_first_name}} at {{company_name}}', locale: 'en' };

export default function CampaignsDesk({ mode, organizationId, permissions = [], notify, onNavigate }) {
  const [section, setSection] = useState('campaigns');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [record, setRecord] = useState(null);
  const [form, setForm] = useState(emptyCampaign);
  const [steps, setSteps] = useState(() => defaultSteps());
  const [preview, setPreview] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [monitor, setMonitor] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const current = SECTIONS.find((item) => item[0] === section) ?? SECTIONS[0];
  const canCreate = permissions.includes(current[3]);

  function choose(next) {
    setSection(next);
    setPage(1);
    setQuery('');
    setPreview(null);
    sessionStorage.setItem('salesos.campaign.section', next);
    if (mode !== 'list') onNavigate('campaigns', 'list');
  }

  async function loadList() {
    setLoading(true);
    setError('');
    try {
      if (section === 'analytics') {
        setAnalytics(await managementRequest('campaign-analytics/summary', {}));
      } else if (section === 'monitor') {
        const list = await managementRequest('campaigns/list', { q: query, page, pageSize, sortBy: 'updatedAt', sortDirection: 'desc' });
        setRows(list.items || []);
        setTotal(list.total || 0);
      } else {
        const path = section === 'segments' ? 'segments/list' : section === 'sequences' ? 'sequences/list' : section === 'templates' ? 'campaign-templates/list' : 'campaigns/list';
        const list = await managementRequest(path, { q: query, page, pageSize, sortBy: 'updatedAt', sortDirection: 'desc' });
        setRows(list.items || []);
        setTotal(list.total || 0);
      }
    } catch (cause) {
      setError(cause.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const stored = sessionStorage.getItem('salesos.campaign.section');
    if (stored) setSection(stored);
  }, []);

  useEffect(() => {
    if (mode !== 'list' || !organizationId) return undefined;
    const timer = setTimeout(() => { loadList(); }, 200);
    return () => clearTimeout(timer);
  }, [mode, organizationId, section, query, page, pageSize]);

  useEffect(() => {
    listProducts('?pageSize=100').then((result) => setProducts(result.items || [])).catch(() => setProducts([]));
  }, [organizationId]);

  useEffect(() => {
    if (mode === 'list') return undefined;
    if (mode === 'add') {
      setRecord(null);
      setForm(section === 'segments' ? emptySegment : section === 'templates' ? emptyTemplate : emptyCampaign);
      setSteps(defaultSteps());
      setDirty(false);
      setLoading(false);
      return undefined;
    }
    const token = recallNavigation(current[2], mode);
    if (!token) { setError('Open this record from the list again.'); return undefined; }
    let cancelled = false;
    setLoading(true);
    resolveNavigation(token).then(async (context) => {
      const path = section === 'segments' ? 'segments/get' : section === 'sequences' ? 'sequences/get' : section === 'templates' ? 'campaign-templates/get' : 'campaigns/get';
      const loaded = await managementRequest(path, { id: context.resourceId });
      if (cancelled) return;
      setRecord(loaded);
      setForm(loaded);
      if (loaded.steps) setSteps(loaded.steps);
      if (section === 'monitor' || section === 'campaigns') setMonitor(await managementRequest('campaign-simulation/monitor', { id: context.resourceId }));
      setLoading(false);
    }).catch((cause) => { if (!cancelled) { setError(cause.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [mode, organizationId, section]);

  async function openRecord(item, action) {
    const opened = await openNavigation({ resourceType: current[2], action, resourceId: item.id });
    rememberNavigation(current[2], action, opened.token);
    onNavigate('campaigns', action);
  }

  function change(field, value) {
    setForm({ ...form, [field]: value });
    setDirty(true);
  }

  async function saveCampaign(event) {
    event.preventDefault();
    const body = { ...form, productVersionId: form.productVersionId || undefined, icpRef: form.icpRef || undefined };
    const saved = record ? await managementRequest('campaigns/update', { ...body, id: record.id, revision: record.revision }) : await managementRequest('campaigns/create', body);
    notify('Campaign saved. External delivery stays not authorized.');
    setDirty(false);
    setRecord(saved);
    if (!record) choose('campaigns');
  }

  async function saveSegment(event) {
    event.preventDefault();
    const filter = { op: 'and', items: [{ field: form.field || 'stage', operator: form.operator || 'eq', value: form.value || 'QUALIFIED' }] };
    if (record) await managementRequest('segments/update', { id: record.id, revision: record.revision, name: form.name, description: form.description, filter });
    else await managementRequest('segments/create', { name: form.name, description: form.description, kind: form.kind, filter });
    notify('Segment saved.');
    setDirty(false);
    choose('segments');
  }

  async function saveTemplate(event) {
    event.preventDefault();
    await managementRequest('campaign-templates/create', form);
    notify('Template saved. It cannot send.');
    setDirty(false);
    choose('templates');
  }

  async function saveSequence(event) {
    event.preventDefault();
    const body = { name: form.name || 'Introduction sequence', timeZone: form.timeZone || 'UTC', steps };
    if (record) await managementRequest('sequences/steps', { id: record.id, steps });
    else await managementRequest('sequences/create', body);
    notify('Sequence saved.');
    setDirty(false);
    choose('sequences');
  }

  async function previewAudience(filter) {
    try {
      setError('');
      setPreview(await managementRequest('segments/preview', { filter }));
    } catch (cause) {
      setPreview(null);
      setError(cause.message);
    }
  }

  async function act(path, body, message) {
    const saved = await managementRequest(path, body);
    notify(message);
    setConfirm(null);
    if (saved?.revision) setRecord(saved);
    else if (record) setRecord(await managementRequest('campaigns/get', { id: record.id }));
    return saved;
  }

  return (
    <ManagementPageLayout>
      <ManagementPageHeader eyebrow="CAMPAIGN PREPARATION" title="Campaigns" description="EXTERNAL DELIVERY — NOT AUTHORIZED. Simulation prepares drafts and does not send email or WhatsApp." actions={<PermissionGate allowed={canCreate} fallback=""><button type="button" className="btn btn-primary" onClick={() => onNavigate('campaigns', 'add')}>Add {current[1].toLowerCase().replace(/s$/, '')}</button></PermissionGate>} />
      <FilterPanel>
        {SECTIONS.map(([id, label]) => <button type="button" key={id} className={section === id ? 'btn btn-primary' : 'btn'} onClick={() => choose(id)}>{label}</button>)}
      </FilterPanel>
      <UnsavedChangesGuard dirty={dirty} />
      {error && <ErrorState message={error} onRetry={loadList} />}
      {loading && <LoadingState />}
      {mode === 'list' && section === 'analytics' && analytics && <AnalyticsPanel analytics={analytics} />}
      {mode === 'list' && section !== 'analytics' && !loading && (
        <>
          <SearchInput id="campaign-search" label="Search" value={query} onChange={setQuery} />
          <PageSizeSelector value={pageSize} onChange={setPageSize} />
          {rows.length === 0 ? <EmptyState title="No campaign records" subtitle="Create a campaign, segment, or sequence. Nothing here is sent." /> : (
            <DataTable label={current[1]}>
              <thead><tr><th>Name</th><th>Status</th><th>Channel</th><th></th></tr></thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td><StatusBadge>{item.state || item.kind || 'DRAFT'}</StatusBadge></td>
                    <td>{item.channel || 'EMAIL'}</td>
                    <td><button type="button" className="btn" onClick={() => openRecord(item, 'view')}>View</button> {section !== 'monitor' && <button type="button" className="btn" onClick={() => openRecord(item, 'edit')}>Edit</button>}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
          <PaginationControls page={page} pageSize={pageSize} total={total} onPage={setPage} />
        </>
      )}
      {mode === 'add' && section === 'campaigns' && <CampaignForm form={form} products={products} onChange={change} onSubmit={saveCampaign} onCancel={() => choose('campaigns')} />}
      {mode === 'add' && section === 'segments' && <SegmentForm form={form} onChange={change} onSubmit={saveSegment} onPreview={() => previewAudience({ op: 'and', items: [{ field: form.field || 'stage', operator: 'eq', value: form.value || 'QUALIFIED' }] })} preview={preview} onCancel={() => choose('segments')} />}
      {mode === 'add' && section === 'sequences' && <SequenceForm form={form} steps={steps} setSteps={setSteps} onChange={change} onSubmit={saveSequence} onCancel={() => choose('sequences')} />}
      {mode === 'add' && section === 'templates' && <TemplateForm form={form} onChange={change} onSubmit={saveTemplate} onCancel={() => choose('templates')} />}
      {mode !== 'list' && mode !== 'add' && record && section === 'campaigns' && (
        <RecordDetailsLayout title={record.name} actions={<button type="button" className="btn" onClick={() => choose('campaigns')}>Back</button>}>
          <p>EXTERNAL DELIVERY — NOT AUTHORIZED. Automated reply detection is unavailable until a mailbox is configured. Silence is not treated as lack of interest.</p>
          <p>State <StatusBadge>{record.state}</StatusBadge> · Product version pinned · Sending {record.sendingStatus}</p>
          <p>Sent NOT AVAILABLE · Delivered NOT AVAILABLE · Replies NOT AVAILABLE · Meetings NOT AVAILABLE · Conversions NOT AVAILABLE</p>
          {record.history?.length > 0 && <ul>{record.history.map((item) => <li key={item.id}>{item.action} {item.fromState || '—'} → {item.toState}</li>)}</ul>}
          {monitor && <p>Enrollments {monitor.enrollments?.length || 0}. Send attempts {monitor.sendAttempts}.</p>}
          <div className="mgmt-actions">
            <button type="button" className="btn" onClick={() => act('campaigns/clone', { id: record.id }, 'Campaign cloned as a draft.')}>Clone</button>
            <button type="button" className="btn" onClick={() => setConfirm({ title: 'Archive campaign', body: 'Archive this campaign. It does not send.', label: 'Archive', run: () => act('campaigns/archive', { ids: [record.id] }, 'Campaign archived.') })}>Archive</button>
            <button type="button" className="btn" onClick={() => act('campaigns/transition', { id: record.id, revision: record.revision, state: 'CONFIGURING' }, 'Campaign is configuring.')}>Configure</button>
            <button type="button" className="btn" onClick={() => act('campaign-approvals/request', { kind: 'CONFIGURATION', subjectId: record.id, versionRef: String(record.revision), digest: record.id }, 'Review requested.')}>Submit for review</button>
            <button type="button" className="btn" onClick={() => setConfirm({ title: 'Schedule simulation', body: 'Schedule an internal simulation. No message is sent.', label: 'Schedule', run: () => act('campaigns/transition', { id: record.id, revision: record.revision, state: 'SCHEDULED' }, 'Simulation scheduled.') })}>Schedule simulation</button>
            <button type="button" className="btn" onClick={() => setConfirm({ title: 'Start simulation', body: 'Run the internal simulator. Provider send stays closed.', label: 'Start', run: () => act('campaign-simulation/start', { id: record.id }, 'Simulation started. Nothing was sent.') })}>Start simulation</button>
            <button type="button" className="btn" onClick={() => act('campaigns/transition', { id: record.id, revision: record.revision, state: 'PAUSED' }, 'Simulation paused.')}>Pause</button>
            <button type="button" className="btn" onClick={() => act('campaigns/transition', { id: record.id, revision: record.revision, state: 'SIMULATING' }, 'Simulation resumed.')}>Resume</button>
            <button type="button" className="btn" onClick={() => setConfirm({ title: 'Cancel campaign', body: 'Cancel preparation. No provider is contacted.', label: 'Cancel campaign', run: () => act('campaigns/transition', { id: record.id, revision: record.revision, state: 'CANCELLED' }, 'Campaign cancelled.') })}>Cancel campaign</button>
          </div>
        </RecordDetailsLayout>
      )}
      {mode === 'edit' && record && section === 'campaigns' && <CampaignForm form={form} products={products} onChange={change} onSubmit={saveCampaign} onCancel={() => choose('campaigns')} />}
      {mode !== 'list' && mode !== 'add' && record && section === 'segments' && <SegmentForm form={form} onChange={change} onSubmit={saveSegment} onPreview={() => previewAudience(record.versions?.[0]?.filter || { op: 'and', items: [{ field: 'stage', operator: 'eq', value: 'QUALIFIED' }] })} preview={preview} onCancel={() => choose('segments')} />}
      {mode !== 'list' && mode !== 'add' && record && section === 'sequences' && <SequenceForm form={form} steps={steps.length ? steps : defaultSteps()} setSteps={setSteps} onChange={change} onSubmit={saveSequence} onFreeze={() => act('sequences/freeze', { id: record.id }, 'Sequence version published.')} onCancel={() => choose('sequences')} />}
      {confirm && <ConfirmDialog title={confirm.title} body={confirm.body} confirmLabel={confirm.label} onCancel={() => setConfirm(null)} onConfirm={confirm.run} />}
    </ManagementPageLayout>
  );
}

function defaultSteps() {
  return [
    { position: 1, stepType: 'EMAIL_DRAFT', config: { next: 2 } },
    { position: 2, stepType: 'WAIT_DURATION', config: { businessDays: 2, next: 3 } },
    { position: 3, stepType: 'CONDITION', config: { field: 'reply', whenTrue: 4, whenFalse: 4 } },
    { position: 4, stepType: 'END_SEQUENCE', config: {} },
  ];
}

function CampaignForm({ form, products, onChange, onSubmit, onCancel }) {
  return (
    <RecordFormLayout title="Campaign" onSubmit={onSubmit}>
      <label>Name<input aria-label="Campaign name" value={form.name || ''} onChange={(event) => onChange('name', event.target.value)} required /></label>
      <label>Description<textarea aria-label="Description" value={form.description || ''} onChange={(event) => onChange('description', event.target.value)} /></label>
      <label>Goal<input aria-label="Goal" value={form.goal || ''} onChange={(event) => onChange('goal', event.target.value)} /></label>
      <label>Type<input aria-label="Campaign type" value={form.campaignType || 'OUTREACH'} onChange={(event) => onChange('campaignType', event.target.value)} /></label>
      <label>Time zone<input aria-label="Time zone" value={form.timeZone || 'UTC'} onChange={(event) => onChange('timeZone', event.target.value)} /></label>
      <label>Published product
        <select aria-label="Published product" value={form.productVersionId || ''} onChange={(event) => onChange('productVersionId', event.target.value)}>
          <option value="">No product yet</option>
          {products.filter((product) => product.publishedVersionId).map((product) => <option key={product.id} value={product.publishedVersionId}>{product.name}</option>)}
        </select>
      </label>
      <label>ICP<input aria-label="ICP" value={form.icpRef || ''} onChange={(event) => onChange('icpRef', event.target.value)} /></label>
      <FormActions><button type="button" className="btn" onClick={onCancel}>Cancel</button><button type="submit" className="btn btn-primary">Save</button></FormActions>
    </RecordFormLayout>
  );
}

function SegmentForm({ form, onChange, onSubmit, onPreview, preview, onCancel }) {
  return (
    <RecordFormLayout title="Audience segment" onSubmit={onSubmit}>
      <label>Name<input aria-label="Segment name" value={form.name || ''} onChange={(event) => onChange('name', event.target.value)} required /></label>
      <label>Kind<select aria-label="Segment kind" value={form.kind || 'DYNAMIC'} onChange={(event) => onChange('kind', event.target.value)}><option value="DYNAMIC">Dynamic</option><option value="SNAPSHOT">Snapshot</option></select></label>
      <label>Field<select aria-label="Filter field" value={form.field || 'stage'} onChange={(event) => onChange('field', event.target.value)}><option value="stage">Lead stage</option><option value="consent">Consent</option><option value="country">Country</option><option value="grade">Grade</option></select></label>
      <label>Value<input aria-label="Filter value" value={form.value || ''} onChange={(event) => onChange('value', event.target.value)} /></label>
      <button type="button" className="btn" onClick={onPreview}>Preview audience</button>
      {preview && <p>Matching {preview.total}. Eligible for preparation {preview.eligibleForPreparation}. Suppressed {preview.suppressed}. Human-owned {preview.humanOwned}. Unknown consent {preview.unknown}. A match is not permission to send.</p>}
      <FormActions><button type="button" className="btn" onClick={onCancel}>Cancel</button><button type="submit" className="btn btn-primary">Save segment</button></FormActions>
    </RecordFormLayout>
  );
}

function SequenceForm({ form, steps, setSteps, onChange, onSubmit, onFreeze, onCancel }) {
  function move(index, direction) {
    const next = steps.map((step) => ({ ...step }));
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const current = next[index].position;
    next[index].position = next[target].position;
    next[target].position = current;
    setSteps(next.sort((left, right) => left.position - right.position));
  }
  return (
    <RecordFormLayout title="Sequence" onSubmit={onSubmit}>
      <label>Name<input aria-label="Sequence name" value={form.name || ''} onChange={(event) => onChange('name', event.target.value)} required /></label>
      <ol>{steps.map((step, index) => <li key={step.position}>{step.stepType} <button type="button" className="btn" onClick={() => move(index, -1)}>Move up</button></li>)}</ol>
      <button type="button" className="btn" onClick={() => setSteps([...steps, { position: steps.length + 1, stepType: 'EMAIL_DRAFT', config: {} }])}>Add email draft step</button>
      <button type="button" className="btn" onClick={() => setSteps([...steps, { position: steps.length + 1, stepType: 'WAIT_DURATION', config: { businessDays: 2 } }])}>Add wait step</button>
      <button type="button" className="btn" onClick={() => setSteps([...steps, { position: steps.length + 1, stepType: 'CONDITION', config: { field: 'reply' } }])}>Add condition</button>
      {onFreeze && <button type="button" className="btn" onClick={onFreeze}>Publish sequence</button>}
      <FormActions><button type="button" className="btn" onClick={onCancel}>Cancel</button><button type="submit" className="btn btn-primary">Save</button></FormActions>
    </RecordFormLayout>
  );
}

function TemplateForm({ form, onChange, onSubmit, onCancel }) {
  return (
    <RecordFormLayout title="Template" onSubmit={onSubmit}>
      <label>Name<input aria-label="Template name" value={form.name || ''} onChange={(event) => onChange('name', event.target.value)} required /></label>
      <label>Subject<input aria-label="Subject" value={form.subject || ''} onChange={(event) => onChange('subject', event.target.value)} required /></label>
      <label>Body<textarea aria-label="Body" value={form.bodyText || ''} onChange={(event) => onChange('bodyText', event.target.value)} required /></label>
      <FormActions><button type="button" className="btn" onClick={onCancel}>Cancel</button><button type="submit" className="btn btn-primary">Save</button></FormActions>
    </RecordFormLayout>
  );
}

function labelUnavailable(value) {
  return value === 'NOT_AVAILABLE' ? 'NOT AVAILABLE' : value;
}

function AnalyticsPanel({ analytics }) {
  return (
    <section>
      <p>Campaigns {analytics.totalCampaigns}. Drafts {analytics.draftCampaigns}. Approved {analytics.approvedCampaigns}. Scheduled simulations {analytics.scheduledSimulations}. Paused {analytics.pausedCampaigns}. Completed simulations {analytics.completedSimulations}.</p>
      <p>Audience {analytics.audienceSize}. Eligible for preparation {analytics.eligibleForPreparation}. Suppressed {analytics.suppressed}. Human-owned {analytics.humanOwned}. Unknown eligibility {analytics.unknownEligibility}. Qualified leads {analytics.qualifiedLeads}.</p>
      <p>Drafts generated {analytics.draftsGenerated}. Awaiting approval {analytics.draftsAwaitingApproval}. Approved drafts {analytics.draftsApproved}. Simulation steps {analytics.simulationStepsCompleted}. Failed tasks {analytics.failedInternalTasks}. Stopped enrollments {analytics.stoppedEnrollments}.</p>
      <p>Sent {labelUnavailable(analytics.external.sent)}. Delivered {labelUnavailable(analytics.external.delivered)}. Replies {labelUnavailable(analytics.external.replies)}. Meetings {labelUnavailable(analytics.external.meetings)}. Conversions {labelUnavailable(analytics.external.conversions)}.</p>
    </section>
  );
}
