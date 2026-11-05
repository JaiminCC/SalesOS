'use client';
import React, { useEffect, useState } from 'react';
import { managementRequest } from '../../lib/auth-client';
import { ErrorState, LoadingState, ManagementPageHeader, ManagementPageLayout, StatusBadge } from './kit';

export default function CommandDesk({ permissions = [], notify, onNavigate }) {
  const canPause = permissions.includes('automation.pause');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const result = await managementRequest('automation/get');
      setStatus(result.status);
    } catch (cause) {
      setError(cause.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function run(path, message) {
    setBusy(true);
    try {
      const result = path === 'runs/create' ? await managementRequest(path, { triggerType: 'SCAN' }) : await managementRequest(path);
      if (path === 'runs/create') notify(`Scan finished as ${result.state}.`);
      else { setStatus(result.status); notify(message); }
      if (path !== 'runs/create') await load();
    } catch (cause) {
      notify(cause.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ManagementPageLayout>
      <ManagementPageHeader eyebrow="LIVE SUPERVISOR" title="Automation" description="This status comes from the server. Start a run from the inspector with a published product and an explicit model. Approval never sends a message." actions={<>
        <button className="btn" type="button" onClick={() => onNavigate('models')}>Models</button>
        <button className="btn" type="button" onClick={() => onNavigate('agents')}>Agents</button>
        <button className="btn" type="button" onClick={() => onNavigate('inspector')}>Inspector</button>
      </>} />
      {loading && <LoadingState label="Loading automation status…" />}
      {error && <ErrorState message={error} onRetry={load} />}
      {!loading && !error && <p>Organization automation is <StatusBadge>{status}</StatusBadge></p>}
      <div className="mgmt-actions">
        {canPause && status !== 'PAUSED' && <button className="btn" type="button" disabled={busy} onClick={() => run('automation/pause', 'Automation paused.')}>Pause automation</button>}
        {canPause && status === 'PAUSED' && <button className="btn" type="button" disabled={busy} onClick={() => run('automation/resume', 'Automation resumed.')}>Resume automation</button>}
      </div>
    </ManagementPageLayout>
  );
}
