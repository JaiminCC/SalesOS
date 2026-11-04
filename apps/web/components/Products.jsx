'use client';
import React, { useEffect, useRef, useState } from 'react';
import {
  addIcp,
  archiveIcp,
  archiveProduct,
  createProduct,
  downloadKnowledge,
  duplicateProduct,
  getProduct,
  listIcps,
  listKnowledge,
  listProductVersions,
  listProducts,
  previewProductContext,
  restoreProduct,
  reviewKnowledge,
  searchKnowledge,
  transitionVersion,
  updateProduct,
  updateProductVersion,
  uploadKnowledge,
  managementRequest,
} from '../lib/auth-client';
import { ConfirmDialog } from './management/kit';
import '../app/products.css';

const TYPES = [
  ['SOFTWARE', 'Software / SaaS'],
  ['PHYSICAL', 'Physical product'],
  ['PROFESSIONAL_SERVICE', 'Professional service'],
  ['SUBSCRIPTION', 'Subscription service'],
  ['DIGITAL', 'Digital product'],
  ['CUSTOM', 'Custom solution'],
  ['OTHER', 'Other'],
];
const PRICING = ['FIXED', 'SUBSCRIPTION', 'TIERED', 'CUSTOM_QUOTE', 'USAGE', 'NEGOTIATED'];
const TABS = ['Details', 'Versions', 'Positioning', 'ICP', 'Pricing', 'Objections', 'Knowledge', 'Preview'];

const emptyDraft = {
  name: '',
  productType: 'SOFTWARE',
  category: '',
  shortDescription: '',
  detailedDescription: '',
  website: '',
  tags: '',
  targetMarkets: '',
  languages: 'en',
  currency: 'USD',
};

function lines(value) {
  return String(value || '').split('\n').map((line) => line.trim()).filter(Boolean);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function Products({ organizationId, permissions = [], notify, onWorkspace }) {
  const canWrite = permissions.includes('products.write');
  const canPublish = permissions.includes('products.publish');
  const canApprove = permissions.includes('approvals.manage');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [product, setProduct] = useState(null);
  const [versions, setVersions] = useState([]);
  const [icps, setIcps] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [tab, setTab] = useState('Details');
  const [createForm, setCreateForm] = useState(emptyDraft);
  const [detailForm, setDetailForm] = useState(emptyDraft);
  const [positioning, setPositioning] = useState({ valuePropositions: '', capabilities: '', qualificationQuestions: '', tone: '', brandVoice: '', restrictedClaims: '', escalationConditions: '', approvalRequirements: '', disallowedBuyers: '' });
  const [pricing, setPricing] = useState({ model: 'CUSTOM_QUOTE', visible: false, currency: 'USD', summary: '' });
  const [objections, setObjections] = useState('');
  const [icpName, setIcpName] = useState('');
  const [icpIndustries, setIcpIndustries] = useState('');
  const [searchText, setSearchText] = useState('');
  const [searchMode, setSearchMode] = useState('keyword');
  const [searchResult, setSearchResult] = useState(null);
  const [preview, setPreview] = useState(null);
  const [rejectReason, setRejectReason] = useState('Not approved for live use');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortBy, setSortBy] = useState('updatedAt');
  const [sortDirection, setSortDirection] = useState('desc');
  const [total, setTotal] = useState(0);
  const [selectedIds, setSelectedIds] = useState([]);
  const [confirm, setConfirm] = useState(null);
  const [docStatus, setDocStatus] = useState('');
  const [docSort, setDocSort] = useState('createdAt:desc');
  const listTicket = useRef(0);

  const draft = versions.find((version) => version.status === 'DRAFT' && version.snapshot);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function loadList(nextSelected = selectedId) {
    const ticket = ++listTicket.current;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (typeFilter) params.set('productType', typeFilter);
      if (statusFilter) params.set('status', statusFilter);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      params.set('sortBy', sortBy);
      params.set('sortDirection', sortDirection);
      const result = await listProducts(`?${params}`);
      if (ticket !== listTicket.current) return;
      setItems(result.items);
      setTotal(result.total);
      const id = result.items.some((item) => item.id === nextSelected) ? nextSelected : result.items[0]?.id || '';
      setSelectedId(id);
      if (id) await loadProduct(id, ticket);
      else if (ticket === listTicket.current) { setProduct(null); setVersions([]); setIcps([]); setDocuments([]); }
    } catch (cause) {
      if (ticket !== listTicket.current) return;
      setError(cause.message);
    } finally {
      if (ticket === listTicket.current) setLoading(false);
    }
  }

  async function loadProduct(id, ticket = listTicket.current) {
    const [detail, versionRows, icpRows, docs] = await Promise.all([
      getProduct(id),
      listProductVersions(id),
      listIcps(id).catch(() => []),
      listKnowledge(id),
    ]);
    if (ticket !== listTicket.current) return;
    setProduct(detail);
    setVersions(versionRows);
    setIcps(icpRows);
    setDocuments(docs);
    setDetailForm({
      name: detail.name,
      productType: detail.productType,
      category: detail.category || '',
      shortDescription: detail.shortDescription || '',
      detailedDescription: detail.detailedDescription || '',
      website: detail.website || '',
      tags: (detail.tags || []).join(', '),
      targetMarkets: (detail.targetMarkets || []).join(', '),
      languages: (detail.languages || []).join(', '),
      currency: detail.currency || 'USD',
    });
    const open = versionRows.find((version) => version.status === 'DRAFT' && version.snapshot) || versionRows.find((version) => version.status === 'PUBLISHED' && version.snapshot);
    const snapshot = open?.snapshot;
    const position = snapshot?.positioning || {};
    setPositioning({
      valuePropositions: (position.valuePropositions || []).join('\n'),
      capabilities: (position.capabilities || []).join('\n'),
        qualificationQuestions: (position.qualificationQuestions || []).join('\n'),
        tone: position.tone || '',
      brandVoice: position.brandVoice || '',
      restrictedClaims: (position.restrictedClaims || []).join('\n'),
      escalationConditions: (position.escalationConditions || []).join('\n'),
      approvalRequirements: (position.approvalRequirements || []).join('\n'),
      disallowedBuyers: (position.disallowedBuyers || []).join('\n'),
    });
    const price = snapshot?.pricing || {};
    setPricing({ model: price.model || 'CUSTOM_QUOTE', visible: Boolean(price.visible), currency: price.currency || detail.currency || 'USD', summary: price.summary || '' });
    setObjections((position.objections || []).map((item) => `${item.objection} | ${item.response}`).join('\n'));
    setDirty(false);
  }

  useEffect(() => {
    if (!organizationId) { setLoading(false); setItems([]); return undefined; }
    setSelectedId('');
    loadList('');
    return undefined;
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId) return undefined;
    loadList(selectedId);
    return undefined;
  }, [page, pageSize, sortBy, sortDirection]);

  function mark(setter) {
    return (event) => { setter(event.target.type === 'checkbox' ? event.target.checked : event.target.value); setDirty(true); };
  }

  async function run(work, success) {
    setBusy(true);
    try {
      const created = await work();
      if (success) notify(success);
      setDirty(false);
      await loadList(created && typeof created === 'object' && created.id ? created.id : selectedId);
    } catch (cause) {
      notify(cause.message);
    } finally {
      setBusy(false);
    }
  }

  function splitList(value) {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }

  function draftPayload() {
    if (!draft?.snapshot) throw new Error('Open a draft before saving configuration');
    const objectionRows = lines(objections).map((line) => {
      const [objection, response] = line.split('|').map((part) => part.trim());
      if (!objection || !response) throw new Error('Each objection needs an approved response, separated by |');
      return { objection, response };
    });
    return {
      revision: draft.revision,
      positioning: {
        ...draft.snapshot.positioning,
        valuePropositions: lines(positioning.valuePropositions),
        capabilities: lines(positioning.capabilities),
        qualificationQuestions: lines(positioning.qualificationQuestions),
        tone: positioning.tone,
        brandVoice: positioning.brandVoice,
        restrictedClaims: lines(positioning.restrictedClaims),
        escalationConditions: lines(positioning.escalationConditions),
        approvalRequirements: lines(positioning.approvalRequirements),
        disallowedBuyers: lines(positioning.disallowedBuyers),
        objections: objectionRows,
      },
      pricing: { ...draft.snapshot.pricing, ...pricing, visible: Boolean(pricing.visible) },
    };
  }

  return (
    <div className="product-shell">
      <section className="panel">
        <div className="panel-head"><div><h3>Product catalog</h3><p>Live records for the active organization.</p></div></div>
        <div className="toolbar">
          <label className="inline-search" htmlFor="product-search">Search<input id="product-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, category, or description" /></label>
          <label htmlFor="product-type-filter">Type<select id="product-type-filter" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="">All types</option>{TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label htmlFor="product-status-filter">Status<select id="product-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived</option></select></label>
          <label htmlFor="product-sort">Sort<select id="product-sort" value={`${sortBy}:${sortDirection}`} onChange={(event) => { const [field, direction] = event.target.value.split(':'); setSortBy(field); setSortDirection(direction); setPage(1); }}><option value="updatedAt:desc">Updated</option><option value="name:asc">Name A–Z</option><option value="name:desc">Name Z–A</option><option value="productType:asc">Type</option><option value="createdAt:desc">Created</option></select></label>
          <label htmlFor="product-page-size">Page size<select id="product-page-size" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>{[10, 20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
          <button className="btn" type="button" onClick={() => loadList(selectedId)}>Apply filters</button>
          {canWrite && onWorkspace && <button className="btn btn-primary" type="button" onClick={() => onWorkspace('product', 'add').catch((cause) => notify(cause.message))}>Open add page</button>}
          {onWorkspace && <button className="btn" type="button" onClick={() => onWorkspace('product_defaults', 'edit').catch((cause) => notify(cause.message))}>Organization defaults</button>}
          <button className="btn" type="button" onClick={() => loadList(selectedId)}>Refresh</button>
          {canWrite && selectedIds.length > 0 && <button className="btn btn-danger" type="button" onClick={() => setConfirm({ kind: 'bulk-archive', ids: selectedIds, name: `${selectedIds.length} products` })}>Archive selected</button>}
        </div>
        {error && <p className="product-error" role="alert">{error}</p>}
        {loading && <p className="product-note">Loading products…</p>}
        {!loading && !items.length && <p className="product-note">No products match this view.</p>}
      </section>

      {canWrite && (
        <section className="panel">
          <h3>Create product</h3>
          <form className="product-form" onSubmit={(event) => { event.preventDefault(); run(() => createProduct({ ...createForm, tags: splitList(createForm.tags), targetMarkets: splitList(createForm.targetMarkets), languages: splitList(createForm.languages) }), 'Product created.'); }}>
            <label htmlFor="new-product-name">New product name<input id="new-product-name" required value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} /></label>
            <label htmlFor="new-product-type">New product type<select id="new-product-type" value={createForm.productType} onChange={(event) => setCreateForm({ ...createForm, productType: event.target.value })}>{TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label htmlFor="new-product-category">Category<input id="new-product-category" value={createForm.category} onChange={(event) => setCreateForm({ ...createForm, category: event.target.value })} /></label>
            <label htmlFor="new-product-currency">Currency<input id="new-product-currency" value={createForm.currency} maxLength={3} onChange={(event) => setCreateForm({ ...createForm, currency: event.target.value.toUpperCase() })} /></label>
            <label className="wide" htmlFor="new-product-short">Short description<textarea id="new-product-short" value={createForm.shortDescription} onChange={(event) => setCreateForm({ ...createForm, shortDescription: event.target.value })} /></label>
            <div className="actions wide"><button className="btn btn-primary" type="submit" disabled={busy}>Create product</button></div>
          </form>
        </section>
      )}

      <div className="product-layout">
        <div className="product-list" aria-label="Products">
          {items.map((item) => (
            <div key={item.id} className={`product-row ${item.id === selectedId ? 'selected' : ''}`}>
              <input type="checkbox" aria-label={`Select ${item.name}`} checked={selectedIds.includes(item.id)} onChange={(event) => setSelectedIds(event.target.checked ? [...selectedIds, item.id] : selectedIds.filter((id) => id !== item.id))} />
              <button type="button" className={item.id === selectedId ? 'selected' : ''} onClick={() => { if (dirty && !window.confirm('Leave this product with unsaved changes?')) return; setSelectedId(item.id); setDirty(false); setTab('Details'); loadProduct(item.id).catch((cause) => setError(cause.message)); }}>
                <b>{item.name}</b>
                <small>{TYPES.find(([value]) => value === item.productType)?.[1] || item.productType} · {item.status}</small>
              </button>
            </div>
          ))}
          <div className="mgmt-toolbar"><button className="btn" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} · {total} products</span><button className="btn" type="button" disabled={page * pageSize >= total} onClick={() => setPage(page + 1)}>Next</button></div>
        </div>
        <section className="panel">
          {!product && <p className="product-note">Select a product to view its live configuration.</p>}
          {product && (
            <>
              <div className="panel-head"><div><h3>{product.name}</h3><p>{product.status === 'ARCHIVED' ? 'Archived' : 'Active'} · {product.currency}</p></div><span className="badge badge-green">LIVE DATA</span></div>
              {onWorkspace && <div className="actions"><button className="btn" type="button" onClick={() => onWorkspace('product', 'view', { resourceId: product.id }).catch((cause) => notify(cause.message))}>Open product details</button>{canWrite && <button className="btn" type="button" onClick={() => onWorkspace('product', 'edit', { resourceId: product.id }).catch((cause) => notify(cause.message))}>Open product editor</button>}</div>}
              <div className="product-tabs" role="tablist">{TABS.map((name) => <button key={name} type="button" role="tab" aria-selected={tab === name} className={tab === name ? 'active' : ''} onClick={() => { if (dirty && !window.confirm('Switch sections with unsaved changes?')) return; setTab(name); }}>{name}</button>)}</div>
              {tab === 'Details' && (
                <form className="product-form" onSubmit={(event) => { event.preventDefault(); run(() => updateProduct(product.id, { ...detailForm, tags: splitList(detailForm.tags), targetMarkets: splitList(detailForm.targetMarkets), languages: splitList(detailForm.languages) }), 'Product saved.'); }}>
                  <label htmlFor="product-name">Product name<input id="product-name" value={detailForm.name} onChange={mark((value) => setDetailForm({ ...detailForm, name: value }))} disabled={!canWrite} /></label>
                  <label htmlFor="product-type">Product type<select id="product-type" value={detailForm.productType} onChange={mark((value) => setDetailForm({ ...detailForm, productType: value }))} disabled={!canWrite}>{TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label htmlFor="product-category">Category<input id="product-category" value={detailForm.category} onChange={mark((value) => setDetailForm({ ...detailForm, category: value }))} disabled={!canWrite} /></label>
                  <label htmlFor="product-website">Product website<input id="product-website" value={detailForm.website} onChange={mark((value) => setDetailForm({ ...detailForm, website: value }))} disabled={!canWrite} /></label>
                  <label className="wide" htmlFor="product-short">Short description<textarea id="product-short" value={detailForm.shortDescription} onChange={mark((value) => setDetailForm({ ...detailForm, shortDescription: value }))} disabled={!canWrite} /></label>
                  <label className="wide" htmlFor="product-detail">Detailed description<textarea id="product-detail" value={detailForm.detailedDescription} onChange={mark((value) => setDetailForm({ ...detailForm, detailedDescription: value }))} disabled={!canWrite} /></label>
                  <label htmlFor="product-tags">Tags<input id="product-tags" value={detailForm.tags} onChange={mark((value) => setDetailForm({ ...detailForm, tags: value }))} disabled={!canWrite} /></label>
                  <label htmlFor="product-markets">Target markets<input id="product-markets" value={detailForm.targetMarkets} onChange={mark((value) => setDetailForm({ ...detailForm, targetMarkets: value }))} disabled={!canWrite} /></label>
                  <label htmlFor="product-languages">Supported languages<input id="product-languages" value={detailForm.languages} onChange={mark((value) => setDetailForm({ ...detailForm, languages: value }))} disabled={!canWrite} /></label>
                  <label htmlFor="product-currency">Currency<input id="product-currency" value={detailForm.currency} onChange={mark((value) => setDetailForm({ ...detailForm, currency: value }))} disabled={!canWrite} /></label>
                  <div className="actions wide">
                    {canWrite && <button className="btn btn-primary" type="submit" disabled={busy}>Save product</button>}
                    {canWrite && <button className="btn" type="button" onClick={() => run(() => duplicateProduct(product.id), 'Product duplicated.')}>Duplicate</button>}
                    {canWrite && product.status === 'ACTIVE' && <button className="btn" type="button" onClick={() => setConfirm({ kind: 'archive', id: product.id, name: product.name })}>Archive</button>}
                    {canWrite && product.status === 'ARCHIVED' && <button className="btn" type="button" onClick={() => run(() => restoreProduct(product.id), 'Product restored.')}>Restore</button>}
                  </div>
                </form>
              )}
              {tab === 'Versions' && (
                <div>
                  <table className="data-table"><thead><tr><th>Version</th><th>Status</th><th>Revision</th></tr></thead><tbody>{versions.map((version) => <tr key={version.id}><td>v{version.versionNumber}</td><td>{version.status}</td><td>{version.revision}</td></tr>)}</tbody></table>
                  <div className="actions">
                    {canWrite && draft && <button className="btn btn-primary" type="button" onClick={() => run(() => transitionVersion(product.id, draft.id, 'submit'), 'Draft submitted for review.')}>Submit for review</button>}
                    {canWrite && draft && <button className="btn" type="button" onClick={() => run(() => transitionVersion(product.id, draft.id, 'archive'), 'Draft archived.')}>Archive draft</button>}
                    {canApprove && versions.filter((version) => version.status === 'IN_REVIEW').map((version) => <button key={version.id} className="btn btn-primary" type="button" onClick={() => run(() => transitionVersion(product.id, version.id, 'approve'), 'Version approved.')}>Approve version</button>)}
                    {canApprove && versions.filter((version) => version.status === 'IN_REVIEW').map((version) => <button key={`${version.id}-reject`} className="btn" type="button" onClick={() => run(() => transitionVersion(product.id, version.id, 'reject', { reason: rejectReason }), 'Version rejected.')}>Reject version</button>)}
                    {canPublish && versions.filter((version) => version.status === 'APPROVED').map((version) => <button key={version.id} className="btn btn-primary" type="button" onClick={() => run(() => transitionVersion(product.id, version.id, 'publish'), 'Version published.')}>Publish version</button>)}
                    {canWrite && !draft && versions.some((version) => version.status === 'PUBLISHED' || version.status === 'SUPERSEDED') && <button className="btn" type="button" onClick={() => run(() => transitionVersion(product.id, versions.find((version) => version.status === 'PUBLISHED' || version.status === 'SUPERSEDED').id, 'restore'), 'Older version copied into a new draft.')}>Restore as new draft</button>}
                  </div>
                  {canApprove && <label htmlFor="reject-reason">Rejection reason<input id="reject-reason" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} /></label>}
                </div>
              )}
              {tab === 'Positioning' && (
                <form className="product-form" onSubmit={(event) => { event.preventDefault(); run(() => updateProductVersion(product.id, draft.id, draftPayload()), 'Draft positioning saved.'); }}>
                  <label className="wide" htmlFor="value-props">Value propositions<textarea id="value-props" value={positioning.valuePropositions} onChange={mark((value) => setPositioning({ ...positioning, valuePropositions: value }))} disabled={!canWrite || !draft} /></label>
                  <label className="wide" htmlFor="capabilities">Supported capabilities<textarea id="capabilities" value={positioning.capabilities} onChange={mark((value) => setPositioning({ ...positioning, capabilities: value }))} disabled={!canWrite || !draft} /></label>
                  <label className="wide" htmlFor="qualification-questions">Qualification questions<textarea id="qualification-questions" value={positioning.qualificationQuestions} onChange={mark((value) => setPositioning({ ...positioning, qualificationQuestions: value }))} disabled={!canWrite || !draft} /></label>
                  <label htmlFor="tone">Communication tone<input id="tone" value={positioning.tone} onChange={mark((value) => setPositioning({ ...positioning, tone: value }))} disabled={!canWrite || !draft} /></label>
                  <label htmlFor="brand-voice">Brand voice<input id="brand-voice" value={positioning.brandVoice} onChange={mark((value) => setPositioning({ ...positioning, brandVoice: value }))} disabled={!canWrite || !draft} /></label>
                  <label className="wide" htmlFor="restricted">Restricted claims<textarea id="restricted" value={positioning.restrictedClaims} onChange={mark((value) => setPositioning({ ...positioning, restrictedClaims: value }))} disabled={!canWrite || !draft} /></label>
                  <label className="wide" htmlFor="escalation">Escalation conditions<textarea id="escalation" value={positioning.escalationConditions} onChange={mark((value) => setPositioning({ ...positioning, escalationConditions: value }))} disabled={!canWrite || !draft} /></label>
                  <p className="product-note wide">Free-text instructions do not grant permission to bypass authorization, safety, or external-action policy.</p>
                  {canWrite && draft && <div className="actions wide"><button className="btn btn-primary" type="submit" disabled={busy}>Save draft</button></div>}
                  {!draft && <p className="product-note wide">This view is read only until a draft is open.</p>}
                </form>
              )}
              {tab === 'ICP' && (
                <div>
                  <ul>{icps.filter((icp) => !icp.archived).map((icp) => <li key={icp.id}><b>{icp.name}</b> · priority {icp.priority} {canWrite && <button className="btn" type="button" onClick={() => run(() => archiveIcp(product.id, icp.id), 'ICP archived.')}>Archive ICP</button>}</li>)}</ul>
                  {canWrite && draft && (
                    <form className="product-form" onSubmit={(event) => { event.preventDefault(); run(() => addIcp(product.id, { name: icpName, priority: icps.length + 1, industries: lines(icpIndustries), countries: ['US'], languages: ['en'] }), 'ICP added.'); }}>
                      <label htmlFor="icp-name">ICP name<input id="icp-name" required value={icpName} onChange={(event) => setIcpName(event.target.value)} /></label>
                      <label htmlFor="icp-industries">Target industries<textarea id="icp-industries" value={icpIndustries} onChange={(event) => setIcpIndustries(event.target.value)} /></label>
                      <div className="actions wide"><button className="btn btn-primary" type="submit">Add ICP</button>{onWorkspace && <button className="btn" type="button" onClick={() => onWorkspace('icp', 'add', { parentId: product.id }).catch((cause) => notify(cause.message))}>Open ICP page</button>}</div>
                    </form>
                  )}
                </div>
              )}
              {tab === 'Pricing' && (
                <form className="product-form" onSubmit={(event) => { event.preventDefault(); run(() => updateProductVersion(product.id, draft.id, draftPayload()), 'Pricing rules saved.'); }}>
                  <label htmlFor="pricing-model">Pricing model<select id="pricing-model" value={pricing.model} onChange={mark((value) => setPricing({ ...pricing, model: value }))} disabled={!canWrite || !draft}>{PRICING.map((model) => <option key={model}>{model}</option>)}</select></label>
                  <label htmlFor="pricing-currency">Currency<input id="pricing-currency" value={pricing.currency} onChange={mark((value) => setPricing({ ...pricing, currency: value.toUpperCase() }))} disabled={!canWrite || !draft} /></label>
                  <label className="wide" htmlFor="pricing-summary">Summary<textarea id="pricing-summary" value={pricing.summary} onChange={mark((value) => setPricing({ ...pricing, summary: value }))} disabled={!canWrite || !draft} /></label>
                  <label htmlFor="pricing-visible"><input id="pricing-visible" type="checkbox" checked={pricing.visible} onChange={mark((value) => setPricing({ ...pricing, visible: value }))} disabled={!canWrite || !draft} /> Price is visible to agents</label>
                  <p className="product-note wide">A hidden price stays out of the agent context. Custom quotes do not need a public amount.</p>
                  {canWrite && draft && <div className="actions wide"><button className="btn btn-primary" type="submit">Save pricing</button></div>}
                </form>
              )}
              {tab === 'Objections' && (
                <form onSubmit={(event) => { event.preventDefault(); run(() => updateProductVersion(product.id, draft.id, draftPayload()), 'Objections saved.'); }}>
                  <label htmlFor="objections">Approved objection responses<textarea id="objections" value={objections} onChange={mark((value) => setObjections(value))} disabled={!canWrite || !draft} placeholder="Price concern | Share the approved comparison." /></label>
                  {canWrite && draft && <div className="actions"><button className="btn btn-primary" type="submit">Save objections</button></div>}
                </form>
              )}
              {tab === 'Knowledge' && (
                <div>
                  {canWrite && <form onSubmit={async (event) => { event.preventDefault(); const file = event.currentTarget.elements.file.files?.[0]; if (!file) return; const contentBase64 = await fileToBase64(file); await run(async () => { const saved = await uploadKnowledge(product.id, { fileName: file.name, contentBase64 }); if (saved.status === 'FAILED') throw new Error(saved.failureReason || 'Document processing failed'); }, savedStatus(file.name)); }}>
                    <label htmlFor="knowledge-file">Knowledge file<input id="knowledge-file" name="file" type="file" accept=".pdf,.docx,.txt,.md,.markdown,.html,.htm" /></label>
                    <button className="btn btn-primary" type="submit">Upload document</button>{onWorkspace && <button className="btn" type="button" onClick={() => onWorkspace('knowledge_document', 'add', { parentId: product.id }).catch((cause) => notify(cause.message))}>Open knowledge page</button>}
                  </form>}
                  <div className="toolbar"><label htmlFor="document-status">Document status<select id="document-status" value={docStatus} onChange={(event) => setDocStatus(event.target.value)}><option value="">All</option><option value="PENDING_APPROVAL">Pending approval</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option><option value="FAILED">Failed</option></select></label><label htmlFor="document-sort">Document sort<select id="document-sort" value={docSort} onChange={(event) => setDocSort(event.target.value)}><option value="createdAt:desc">Newest</option><option value="fileName:asc">File name</option><option value="status:asc">Status</option></select></label><button className="btn" type="button" onClick={async () => { const [sortField, direction] = docSort.split(':'); try { const result = await managementRequest('knowledge/list', { productId: product.id, status: docStatus || undefined, sortBy: sortField, sortDirection: direction, q: searchText || undefined, page: 1, pageSize: 20 }); setDocuments(result.items); } catch (cause) { notify(cause.message); } }}>Apply document filters</button></div>
                  <table className="data-table"><thead><tr><th>File</th><th>Status</th><th>Semantic index</th><th></th></tr></thead><tbody>{documents.map((document) => <tr key={document.id}><td>{document.fileName}{document.failureReason ? <small>{document.failureReason}</small> : null}</td><td>{document.status}</td><td>{document.semanticStatus === 'INDEXED' ? 'Indexed' : 'Keyword only'}</td><td>{canApprove && document.status === 'PENDING_APPROVAL' && <button className="btn" type="button" onClick={() => run(() => reviewKnowledge(product.id, document.id, 'approve'), 'Document approved.')}>Approve document</button>} <button className="btn" type="button" onClick={() => downloadKnowledge(product.id, document.id, document.fileName).catch((cause) => notify(cause.message))}>Download</button>{canWrite && <button className="btn btn-danger" type="button" onClick={() => setConfirm({ kind: 'delete-document', id: document.id, name: document.fileName })}>Delete</button>}</td></tr>)}</tbody></table>
                  <form className="toolbar" onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { setSearchResult(await searchKnowledge(product.id, { query: searchText, mode: searchMode })); } catch (cause) { notify(cause.message); } finally { setBusy(false); } }}>
                    <label htmlFor="knowledge-query">Search approved knowledge<input id="knowledge-query" value={searchText} onChange={(event) => setSearchText(event.target.value)} /></label>
                    <label htmlFor="knowledge-mode">Mode<select id="knowledge-mode" value={searchMode} onChange={(event) => setSearchMode(event.target.value)}><option value="keyword">Keyword</option><option value="semantic">Semantic</option></select></label>
                    <button className="btn" type="submit">Search knowledge</button>
                  </form>
                  {searchResult && <div><p className="product-note">{searchResult.mode === 'semantic' ? 'Semantic similarity' : 'Keyword match'} · semantic indexing {searchResult.semanticAvailable ? 'available' : 'unavailable'}</p>{searchResult.results.map((result) => <article className="citation" key={result.chunkId}><p>{result.content}</p><small>{result.fileName} · chunk {result.chunkId} · {result.section || 'section'} · page {result.page || '—'}</small></article>)}</div>}
                </div>
              )}
              {tab === 'Preview' && (
                <form onSubmit={async (event) => { event.preventDefault(); setBusy(true); try { setPreview(await previewProductContext(product.id, { query: searchText || product.name })); } catch (cause) { notify(cause.message); } finally { setBusy(false); } }}>
                  <button className="btn btn-primary" type="submit">Preview published context</button>
                  {preview && <div><p className="product-note">{preview.liveAgentContext ? 'Live agent context uses the published version.' : 'This preview is not live agent context.'}</p><p>Version {preview.version?.versionNumber} · {preview.version?.status}</p><p>{(preview.positioning?.valuePropositions || []).join(', ')}</p><p>Retrieval {preview.provenance?.retrievalMode}</p>{(preview.citations || []).map((citation) => <article className="citation" key={citation.chunkId}><small>{citation.fileName} · {citation.chunkId} · page {citation.page || '—'} · {citation.section || 'section'}</small></article>)}</div>}
                </form>
              )}
            </>
          )}
        </section>
      </div>
      {confirm && <ConfirmDialog title={confirm.kind === 'delete-document' ? 'Delete document' : 'Archive product'} body={confirm.kind === 'delete-document' ? `Delete ${confirm.name}? Retention rules still apply. A published citation stops using the file after it is removed.` : `Archive ${confirm.name}? Archived products stay recoverable and published versions are not deleted.`} confirmLabel={confirm.kind === 'delete-document' ? 'Delete document' : 'Archive'} busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => {
        const action = confirm;
        setConfirm(null);
        if (action.kind === 'archive') run(() => archiveProduct(action.id), 'Product archived.');
        if (action.kind === 'bulk-archive') run(async () => { const result = await managementRequest('products/bulk-archive', { ids: action.ids }); const failed = result.results.filter((item) => !item.ok); if (failed.length) throw new Error(`${failed.length} products could not be archived`); setSelectedIds([]); }, 'Selected products archived.');
        if (action.kind === 'delete-document') run(() => managementRequest('knowledge/delete', { productId: product.id, id: action.id }), 'Document deleted.');
      }} />}
    </div>
  );
}

function savedStatus() {
  return 'Document uploaded and processed.';
}
