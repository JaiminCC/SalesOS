'use client';

import { useEffect, useState } from 'react';
import { getHealthLive } from '../lib/api-client';

type HealthState = 'checking' | 'connected' | 'offline';

export function ApiHealth() {
  const [state, setState] = useState<HealthState>('checking');

  useEffect(() => {
    let cancelled = false;
    let active: AbortController | undefined;

    const tick = () => {
      active?.abort();
      const controller = new AbortController();
      active = controller;
      getHealthLive(controller.signal)
        .then(() => {
          if (!cancelled) setState('connected');
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setState('offline');
        });
    };

    tick();
    const timer = setInterval(tick, 10000);
    return () => {
      cancelled = true;
      active?.abort();
      clearInterval(timer);
    };
  }, []);

  const label = state === 'connected' ? 'API CONNECTED' : state === 'offline' ? 'API OFFLINE' : 'API …';
  return (
    <span className={`api-health api-health-${state}`} title="Backend connection">
      {label}
    </span>
  );
}
