'use client';
import React, { useEffect, useState } from 'react';
import { managementRequest, openNavigation, resolveNavigation } from '../../lib/auth-client';
import { recallNavigation, rememberNavigation } from '../../lib/navigation-context';
import {
  DataTable, EmptyState, ErrorState, FilterPanel, FormActions, LoadingState, ManagementPageHeader,
  ManagementPageLayout, PageSizeSelector, PaginationControls, PermissionGate, RecordFormLayout, SearchInput, StatusBadge,
} from './kit';

const SECTIONS = ['overview', 'meetings', 'requests', 'availability', 'types', 'connections', 'policies', 'proposals', 'notes', 'tasks', 'operations', 'audit'];

export default function CalendarDesk({ mode, permissions = [], notify, onNavigate }) {
  const [section, setSection] = useState('overview');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [overview, setOverview] = useState(null);
  const [detail, setDetail] = useState(null);
  const [slots, setSlots] = useState([]);
  const [held, setHeld] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ displayName: '', provider: 'GOOGLE_CALENDAR', name: 'Product demonstration', timeZone: 'Asia/Kolkata', localDate: '', title: 'Product demonstration', agenda: 'Review the published product and agree a next step.', text: 'Please book a 30 minute product demonstration.' });
  const canManage = permissions.includes('calendar.connections.manage');
  const canBook = permissions.includes('calendar.bookings.create');
  const canReview = permissions.includes('calendar.bookings.review');
  const canOperate = permissions.includes('calendar.bookings.manage');

  useEffect(() => { void load(); }, [section, page, pageSize, query, mode]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      setOverview(await managementRequest('calendar/overview', {}));
      if (section === 'meetings' && mode === 'view') {
        const token = recallNavigation('calendar_meeting');
        const resolved = token ? await resolveNavigation(token) : null;
        setDetail(resolved?.resourceId ? await managementRequest('calendar/meetings/get', { id: resolved.resourceId }) : null);
      } else if (section === 'meetings' || section === 'requests') {
        const result = await managementRequest('calendar/meetings/list', { search: query, take: pageSize, skip: (page - 1) * pageSize, state: section === 'requests' ? 'PENDING_APPROVAL' : undefined });
        setRows(result.rows || []);
        setTotal(result.total || 0);
      } else if (section === 'types') {
        const result = await managementRequest('calendar/meeting-types/list', {});
        setRows(Array.isArray(result) ? result : []);
        setTotal(Array.isArray(result) ? result.length : 0);
      } else if (section === 'connections') {
        const result = await managementRequest('calendar/connections/list', {});
        setRows(Array.isArray(result) ? result : []);
        setTotal(Array.isArray(result) ? result.length : 0);
      } else if (section === 'operations' || section === 'audit') {
        setOverview(await managementRequest('calendar/operations', {}));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Calendar records could not be loaded');
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
      onNavigate('meetings', 'list');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The change was rejected');
    }
  }

  async function meetingAction(path, row, extra, message) {
    setError('');
    try {
      await managementRequest(path, { meetingId: row.id, version: row.version, ...extra });
      notify(message);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The change was rejected');
    }
  }

  async function openRow(row) {
    const opened = await openNavigation({ resourceType: 'calendar_meeting', resourceId: row.id, action: 'view' });
    rememberNavigation('calendar_meeting', opened.token);
    setSection('meetings');
    onNavigate('meetings', 'view');
  }

  function tomorrow() {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }

  const hours = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 9 * 60, endMinute: 17 * 60 }));

  return (
    <ManagementPageLayout>
      <ManagementPageHeader eyebrow="MEETINGS" title="Meetings & Calendar" description="EXTERNAL CALENDAR WRITES DISABLED. Internal bookings stay in SalesOS. No invitation, Meet link, or Teams link is created." />
      <FilterPanel>
        {SECTIONS.map((id) => <button type="button" key={id} className={section === id ? 'btn btn-primary' : 'btn'} onClick={() => { setSection(id); setPage(1); if (mode !== 'list') onNavigate('meetings', 'list'); }}>{id[0].toUpperCase() + id.slice(1)}</button>)}
      </FilterPanel>
      {error && <ErrorState message={error} onRetry={load} />}
      {loading && <LoadingState />}
      {!loading && section === 'overview' && overview && (
        <div className="kpi-grid">
          {[
            ['Google', 'LIVE GOOGLE CALENDAR — NOT CONFIGURED'],
            ['Microsoft', 'LIVE MICROSOFT CALENDAR — NOT CONFIGURED'],
            ['Free/busy', 'REAL FREE/BUSY — NOT TESTED'],
            ['External events', 'EXTERNAL EVENT CREATION — NOT AUTHORIZED'],
            ['Invitations', 'CALENDAR INVITATIONS — NOT AUTHORIZED'],
            ['Meetings', overview.meetings],
            ['Open holds', overview.openHolds],
            ['Pending approvals', overview.pendingApprovals],
            ['Proposals', overview.proposals],
            ['External confirmations', overview.externalConfirmations],
          ].map(([label, value]) => <article className="kpi" key={label}><small>{label}</small><strong>{String(value)}</strong></article>)}
        </div>
      )}
      {!loading && mode === 'add' && section === 'connections' && (
        <PermissionGate allowed={canManage}>
          <RecordFormLayout title="Prepare a calendar connection" onSubmit={(event) => submit(event, 'calendar/connections/create', { displayName: form.displayName, provider: form.provider }, 'Connection saved. It is not a live calendar account.')}>
            <label>Display name<input aria-label="Display name" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>
            <label>Provider<select aria-label="Provider" value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })}><option value="GOOGLE_CALENDAR">Google Calendar</option><option value="MICROSOFT_CALENDAR">Microsoft 365</option></select></label>
            <FormActions><button className="btn btn-primary" type="submit">Save connection</button></FormActions>
          </RecordFormLayout>
        </PermissionGate>
      )}
      {!loading && section === 'connections' && mode !== 'add' && (
        <>
          <button className="btn" type="button" onClick={() => onNavigate('meetings', 'add')}>Add connection</button>
          {rows.length === 0 ? <EmptyState title="No calendar connection" subtitle="A missing OAuth client stays NOT_CONFIGURED. This screen does not invent an account." /> : (
            <DataTable label="Calendar connections"><thead><tr><th>Name</th><th>Provider</th><th>Readiness</th><th>Write</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.displayName}</td><td>{row.provider}</td><td><StatusBadge>{row.readiness}</StatusBadge></td><td>NOT_AUTHORIZED</td></tr>)}</tbody></DataTable>
          )}
        </>
      )}
      {!loading && section === 'policies' && (
        <RecordFormLayout title="Working hours" onSubmit={(event) => submit(event, 'calendar/rules/save', { timeZone: form.timeZone, workingHours: hours, bufferBeforeMinutes: 0, bufferAfterMinutes: 15, noticeMinutes: 0, horizonDays: 30 }, 'Working hours saved for this organizer.')}>
          <label>Time zone<input aria-label="Time zone" value={form.timeZone} onChange={(event) => setForm({ ...form, timeZone: event.target.value })} /></label>
          <p>Weekdays 09:00–17:00. Slots from these hours are LOCAL_ONLY until a provider read is verified.</p>
          <FormActions><button className="btn btn-primary" type="submit">Save working hours</button></FormActions>
        </RecordFormLayout>
      )}
      {!loading && section === 'availability' && (
        <div>
          <RecordFormLayout title="Blocked date" onSubmit={(event) => submit(event, 'calendar/rules/block', { localDate: form.localDate, reason: 'Unavailable' }, 'Blocked date saved.')}>
            <label>Date<input aria-label="Blocked date" value={form.localDate} onChange={(event) => setForm({ ...form, localDate: event.target.value })} placeholder="YYYY-MM-DD" /></label>
            <FormActions><button className="btn" type="submit">Add blocked date</button></FormActions>
          </RecordFormLayout>
          <button className="btn btn-primary" type="button" onClick={async () => {
            try {
              const types = await managementRequest('calendar/meeting-types/list', {});
              const type = Array.isArray(types) ? types[0] : null;
              if (!type) { setError('Create a meeting type first.'); return; }
              const day = tomorrow();
              const result = await managementRequest('calendar/availability', { meetingTypeId: type.id, fromDate: day, throughDate: day, mode: 'LOCAL_ONLY' });
              setSlots(result.slots || []);
              setOverview({ ...overview, availabilityMode: result.mode, availabilityStatus: result.status });
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : 'Availability could not be loaded');
            }
          }}>Show local slots</button>
          <p>{overview?.availabilityStatus ? `${overview.availabilityMode} · ${overview.availabilityStatus}` : 'Slots are not loaded'}</p>
          {slots.length === 0 ? <EmptyState title="No slot loaded" subtitle="These hours are internal. They are not confirmed Google or Microsoft free time." /> : (
            <DataTable label="Local slots"><thead><tr><th>Local start</th><th>State</th><th>Source</th></tr></thead><tbody>{slots.map((slot) => <tr key={slot.start}><td>{slot.localStart}</td><td>{slot.state}</td><td>{slot.mode}</td></tr>)}</tbody></DataTable>
          )}
          {canBook && slots[0] && <button className="btn" type="button" onClick={async () => {
            const types = await managementRequest('calendar/meeting-types/list', {});
            try {
              const result = await managementRequest('calendar/slot-holds/create', { meetingTypeId: types[0].id, localStart: slots[0].localStart, timeZone: form.timeZone });
              setHeld(result);
              notify('Slot held inside SalesOS. Nothing was written to an external calendar.');
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : 'The hold was rejected');
            }
          }}>Hold first slot</button>}
          {canBook && held?.id && <button className="btn" type="button" onClick={async () => {
            try {
              await managementRequest('calendar/booking-requests/create', { holdId: held.id, title: 'Warehouse walkthrough', agenda: 'Internal product demonstration. Availability is local only.' });
              setHeld(null);
              notify('Booking request stored. It is not on an external calendar.');
            } catch (caught) {
              setError(caught instanceof Error ? caught.message : 'The booking request was rejected');
            }
          }}>Create booking request</button>}
        </div>
      )}
      {!loading && mode === 'add' && section === 'types' && (
        <RecordFormLayout title="Meeting type" onSubmit={(event) => submit(event, 'calendar/meeting-types/create', { name: form.name, description: 'Internal product demonstration', durationMinutes: 30, locationType: 'VIRTUAL_PENDING', timeZone: form.timeZone, approvalRequired: true }, 'Meeting type saved. No conference link was created.')}>
          <label>Name<input aria-label="Meeting type name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>Time zone<input aria-label="Meeting type zone" value={form.timeZone} onChange={(event) => setForm({ ...form, timeZone: event.target.value })} /></label>
          <FormActions><button className="btn btn-primary" type="submit">Save meeting type</button></FormActions>
        </RecordFormLayout>
      )}
      {!loading && section === 'types' && mode !== 'add' && (
        <>
          <button className="btn" type="button" onClick={() => onNavigate('meetings', 'add')}>Add meeting type</button>
          {rows.length === 0 ? <EmptyState title="No meeting type" subtitle="Virtual meetings stay pending until a real conference link exists." /> : <DataTable label="Meeting types"><thead><tr><th>Name</th><th>Duration</th><th>Location</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.name}</td><td>{row.durationMinutes}</td><td>{row.locationType}</td></tr>)}</tbody></DataTable>}
        </>
      )}
      {!loading && section === 'meetings' && mode === 'view' && detail && (
        <article>
          <h2>{detail.title}</h2>
          <p>{detail.state} · {detail.availabilityMode} · {detail.locationType}</p>
          <p>External state: {detail.external?.state || 'NOT_ATTEMPTED'}. Conference URL: none.</p>
          <p>{detail.agenda}</p>
          {detail.notes?.length > 0 && <ul>{detail.notes.map((note) => <li key={note.id}>{note.body}</li>)}</ul>}
        </article>
      )}
      {!loading && (section === 'meetings' || section === 'requests') && mode !== 'view' && (
        <>
          <SearchInput id="meeting-search" label="Search" value={query} onChange={(value) => { setQuery(value); setPage(1); }} />
          <PageSizeSelector value={pageSize} onChange={setPageSize} />
          {rows.length === 0 ? <EmptyState title="No meetings" subtitle="Internal meetings appear here after a booking request. External calendars are not shown." /> : (
            <DataTable label="Meetings"><thead><tr><th>Title</th><th>State</th><th>Source</th><th></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.title}</td><td>{row.state}</td><td>{row.availabilityMode}</td><td>
              <button type="button" className="btn" onClick={() => openRow(row)}>View</button>
              {canBook && row.state === 'SLOT_HELD' && <button type="button" className="btn" onClick={() => meetingAction('calendar/meetings/submit', row, {}, 'Submitted for review. Nothing was written externally.')}>Submit for approval</button>}
              {canReview && row.state === 'PENDING_APPROVAL' && <button type="button" className="btn" onClick={() => meetingAction('calendar/approvals/decide', row, {}, 'Approved inside SalesOS. Nothing was written to an external calendar.')}>Approve</button>}
              {canOperate && row.state === 'APPROVED_INTERNAL' && <button type="button" className="btn" onClick={() => meetingAction('calendar/meetings/confirm', row, {}, 'Booked inside SalesOS. The external calendar was not updated.')}>Confirm booking</button>}
              {canOperate && row.state === 'BOOKED_INTERNAL' && <button type="button" className="btn" onClick={() => meetingAction('calendar/meetings/reschedule', row, { localStart: `${tomorrow()}T11:00` }, 'Reschedule stored for review. Nothing was written externally.')}>Reschedule</button>}
              {canOperate && row.state !== 'CANCELLED_INTERNAL' && <button type="button" className="btn" onClick={() => meetingAction('calendar/meetings/cancel', row, { reason: 'Cancelled inside SalesOS' }, 'Meeting cancelled inside SalesOS. No notice was sent.')}>Cancel meeting</button>}
            </td></tr>)}</tbody></DataTable>
          )}
          <PaginationControls page={page} pageSize={pageSize} total={total} onPage={setPage} />
        </>
      )}
      {!loading && section === 'proposals' && canBook && (
        <RecordFormLayout title="AI meeting proposal" onSubmit={async (event) => {
          event.preventDefault();
          const types = await managementRequest('calendar/meeting-types/list', {});
          const type = types[0];
          if (!type) { setError('Create a meeting type first.'); return; }
          return submit(event, 'calendar/proposals/create', { meetingTypeId: type.id, fromDate: tomorrow(), throughDate: tomorrow(), title: form.title, text: form.text }, 'Proposal stored for review. It did not book an external calendar.');
        }}>
          <p>The proposal uses stored availability and stays LOCAL_ONLY. Inbound text is not an instruction to book.</p>
          <label>Request<textarea aria-label="Meeting request" value={form.text} onChange={(event) => setForm({ ...form, text: event.target.value })} /></label>
          <FormActions><button className="btn btn-primary" type="submit">Prepare proposal</button></FormActions>
        </RecordFormLayout>
      )}
      {!loading && (section === 'operations' || section === 'audit') && overview && (
        <div className="kpi-grid">
          {[['Google readiness', overview.google], ['Microsoft readiness', overview.microsoft], ['Invitation delivery', overview.invitationDelivery], ['Attendee acceptance', overview.attendeeAcceptance], ['Provider joins', overview.providerJoins]].map(([label, value]) => <article className="kpi" key={label}><small>{label}</small><strong>{String(value)}</strong></article>)}
        </div>
      )}
    </ManagementPageLayout>
  );
}
