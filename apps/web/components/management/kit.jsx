'use client';
import React, { useEffect, useRef } from 'react';

export function ManagementPageLayout({ children }) {
  return <div className="mgmt-page">{children}</div>;
}

export function ManagementPageHeader({ eyebrow, title, description, actions }) {
  return (
    <div className="mgmt-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="mgmt-actions">{actions}</div>}
    </div>
  );
}

export function SearchInput({ id, label, value, onChange }) {
  return <label htmlFor={id}>{label}<input id={id} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

export function FilterPanel({ children }) {
  return <div className="mgmt-toolbar" role="group" aria-label="Filters">{children}</div>;
}

export function SortableColumnHeader({ label, active, direction, onSort }) {
  return <th scope="col"><button type="button" className="sort-button" aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'} onClick={onSort}>{label}{active ? (direction === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>;
}

export function SelectionCheckbox({ label, checked, onChange }) {
  return <input type="checkbox" aria-label={label} checked={checked} onChange={(event) => onChange(event.target.checked)} />;
}

export function DataTable({ label, children }) {
  return <div className="mgmt-table-wrap"><table className="mgmt-table data-table" aria-label={label}>{children}</table></div>;
}

export function TableToolbar({ children }) {
  return <div className="mgmt-toolbar">{children}</div>;
}

export function PaginationControls({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mgmt-toolbar" aria-label="Pagination">
      <button type="button" className="btn" onClick={() => onPage(page - 1)} disabled={page <= 1}>Previous</button>
      <span>Page {page} of {pages} · {total} records</span>
      <button type="button" className="btn" onClick={() => onPage(page + 1)} disabled={page >= pages}>Next</button>
    </div>
  );
}

export function PageSizeSelector({ value, onChange }) {
  return (
    <label className="page-size">Page size
      <select aria-label="Page size" value={value} onChange={(event) => onChange(Number(event.target.value))}>
        {[10, 20, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
      </select>
    </label>
  );
}

export function RowActionMenu({ label, children }) {
  return <div className="mgmt-actions" aria-label={label}>{children}</div>;
}

export function BulkActionToolbar({ count, children }) {
  if (!count) return null;
  return <div className="mgmt-bulk" role="status">{count} selected {children}</div>;
}

export function ConfirmDialog({ title, body, confirmLabel, busy, onCancel, onConfirm }) {
  const cancelRef = useRef(null);
  useEffect(() => { cancelRef.current?.focus(); }, []);
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onKeyDown={(event) => { if (event.key === 'Escape') onCancel(); }}>
        <h2 id="confirm-title">{title}</h2>
        <p>{body}</p>
        <div className="mgmt-actions">
          <button ref={cancelRef} type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={onConfirm}>{busy ? 'Working…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmBulkActionDialog(props) {
  return <ConfirmDialog {...props} />;
}

export function EmptyState({ title, subtitle }) {
  return <div className="mgmt-empty" role="status"><b>{title}</b><p>{subtitle}</p></div>;
}

export function ErrorState({ message, onRetry }) {
  return <div className="mgmt-error" role="alert"><p>{message}</p>{onRetry && <button type="button" className="btn" onClick={onRetry}>Try again</button>}</div>;
}

export function LoadingState({ label = 'Loading records…' }) {
  return <p className="mgmt-loading" role="status">{label}</p>;
}

export function RecordDetailsLayout({ title, children, actions }) {
  return <section className="panel"><ManagementPageHeader title={title} actions={actions} />{children}</section>;
}

export function RecordFormLayout({ title, children, onSubmit }) {
  return <form className="panel product-form" onSubmit={onSubmit}><h2>{title}</h2>{children}</form>;
}

export function FormSection({ title, children }) {
  return <section className="wide"><h3>{title}</h3>{children}</section>;
}

export function FormActions({ children }) {
  return <div className="actions wide">{children}</div>;
}

export function UnsavedChangesGuard({ dirty }) {
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  return null;
}

export function StatusBadge({ children }) {
  return <span className="badge badge-purple">{children}</span>;
}

export function PermissionGate({ allowed, children, fallback = 'You do not have permission for this action.' }) {
  if (allowed) return children;
  return <p className="mgmt-error" role="status">{fallback}</p>;
}
