import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { api } from '../api';
import AppBar from './AppBar';
import WebhookSettings from './WebhookSettings';

interface ApiEvent {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  userId: number | null;
  tokenId?: string;
  requestBody?: unknown;
  responseBody?: unknown;
  fnName?: string;
}

interface FnInfo {
  name: string;
  line: number;
  signature: string;
  source: string;
}

interface DevConsoleProps {
  onBack: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  '2': 'var(--success)',
  '3': 'var(--primary)',
  '4': 'var(--warning)',
  '5': 'var(--danger)',
};

const METHOD_COLORS: Record<string, string> = {
  GET: '#61affe',
  POST: '#49cc90',
  PUT: '#fca130',
  DELETE: '#f93e3e',
  PATCH: '#50e3c2',
};

type DevTab = 'api-log' | 'webhooks';

export default function DevConsole({ onBack }: DevConsoleProps) {
  const [activeTab, setActiveTab] = useState<DevTab>('api-log');
  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<ApiEvent | null>(null);
  const [fnMap, setFnMap] = useState<Record<string, FnInfo>>({});
  const [paused, setPaused] = useState(false);
  const [filterMethod, setFilterMethod] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterPath, setFilterPath] = useState<string>('');
  const [loggingEnabled, setLoggingEnabled] = useState(true);
  const [copyFormat, setCopyFormat] = useState<'fetch' | 'curl' | 'python'>('fetch');
  const [copied, setCopied] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const eventsContainerRef = useRef<HTMLDivElement>(null);

  // Load initial events and fn-map
  useEffect(() => {
    // Fetch recent events
    fetch('/api/dev/events', {
      headers: { Authorization: `Bearer ${api.getToken()}` },
    })
      .then(r => r.json())
      .then(setEvents)
      .catch(() => {});

    // Fetch function map
    fetch('/api/dev/fn-map', {
      headers: { Authorization: `Bearer ${api.getToken()}` },
    })
      .then(r => r.json())
      .then(setFnMap)
      .catch(() => {});

    // Fetch logging status
    fetch('/api/dev/status', {
      headers: { Authorization: `Bearer ${api.getToken()}` },
    })
      .then(r => r.json())
      .then(data => setLoggingEnabled(data.enabled))
      .catch(() => {});
  }, []);

  // WebSocket connection
  useEffect(() => {
    const token = api.getToken();
    if (!token) return;

    const socket = io('/dev', {
      auth: { token },
      transports: ['websocket'],
    });

    socket.on('api-event', (event: ApiEvent) => {
      if (!paused) {
        setEvents(prev => [event, ...prev.slice(0, 499)]);
      }
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, [paused]);

  const toggleLogging = async () => {
    try {
      const res = await fetch('/api/dev/status', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${api.getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: !loggingEnabled }),
      });
      const data = await res.json();
      setLoggingEnabled(data.enabled);
    } catch {
      // Ignore errors
    }
  };

  const formatAge = useCallback((timestamp: string) => {
    const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }, []);

  const getStatusColor = (status: number) => {
    return STATUS_COLORS[String(status)[0]] || 'var(--text-secondary)';
  };

  const filteredEvents = events.filter(e => {
    if (filterMethod && e.method !== filterMethod) return false;
    if (filterStatus && !String(e.statusCode).startsWith(filterStatus)) return false;
    if (filterPath && !e.path.toLowerCase().includes(filterPath.toLowerCase())) return false;
    return true;
  });

  const generateCode = (event: ApiEvent, format: 'fetch' | 'curl' | 'python'): string => {
    const baseUrl = window.location.origin;
    const url = `${baseUrl}${event.path}`;
    const hasBody = event.requestBody && Object.keys(event.requestBody as object).length > 0;
    const bodyStr = hasBody ? JSON.stringify(event.requestBody, null, 2) : '';

    if (format === 'fetch') {
      let code = `fetch('${url}'`;
      if (event.method !== 'GET' || hasBody) {
        code += `, {
  method: '${event.method}'`;
        code += `,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_TOKEN'
  }`;
        if (hasBody) {
          code += `,
  body: JSON.stringify(${bodyStr})`;
        }
        code += '\n}';
      }
      code += ')';
      return code;
    }

    if (format === 'curl') {
      let cmd = `curl -X ${event.method} '${url}'`;
      cmd += ` \\\n  -H 'Content-Type: application/json'`;
      cmd += ` \\\n  -H 'Authorization: Bearer YOUR_TOKEN'`;
      if (hasBody) {
        cmd += ` \\\n  -d '${JSON.stringify(event.requestBody)}'`;
      }
      return cmd;
    }

    // Python
    let code = `import requests

response = requests.${event.method.toLowerCase()}(
    '${url}',
    headers={
        'Content-Type': 'application/json',
        'Authorization': 'Bearer YOUR_TOKEN'
    }`;
    if (hasBody) {
      code += `,
    json=${bodyStr.replace(/"/g, "'")}`;
    }
    code += '\n)';
    return code;
  };

  const copyCode = async () => {
    if (!selectedEvent) return;
    const code = generateCode(selectedEvent, copyFormat);
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tryRequest = async () => {
    if (!selectedEvent) return;
    // Open in new tab with fetch code in console
    const code = generateCode(selectedEvent, 'fetch');
    const html = `<!DOCTYPE html><html><head><title>Try Request</title></head><body>
      <pre>${code}</pre>
      <script>
        ${code}.then(r => r.json()).then(console.log).catch(console.error);
      </script>
    </body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    window.open(URL.createObjectURL(blob));
  };

  return (
    <div className="dev-console">
      <AppBar title="Developer Console" onBack={onBack} />

      <div className="dev-console-tabs">
        <button
          className={`dev-tab ${activeTab === 'api-log' ? 'active' : ''}`}
          onClick={() => setActiveTab('api-log')}
        >
          API Log
        </button>
        <button
          className={`dev-tab ${activeTab === 'webhooks' ? 'active' : ''}`}
          onClick={() => setActiveTab('webhooks')}
        >
          Webhooks
        </button>
      </div>

      {activeTab === 'webhooks' ? (
        <WebhookSettings />
      ) : (
      <>
      <div className="dev-console-toolbar">
        <div className="dev-console-filters">
          <select value={filterMethod} onChange={e => setFilterMethod(e.target.value)}>
            <option value="">All Methods</option>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All Status</option>
            <option value="2">2xx Success</option>
            <option value="3">3xx Redirect</option>
            <option value="4">4xx Client Error</option>
            <option value="5">5xx Server Error</option>
          </select>
          <input
            type="text"
            placeholder="Filter path..."
            value={filterPath}
            onChange={e => setFilterPath(e.target.value)}
          />
        </div>
        <div className="dev-console-controls">
          <button
            className={`btn-icon ${paused ? 'active' : ''}`}
            onClick={() => setPaused(!paused)}
            title={paused ? 'Resume' : 'Pause'}
          >
            {paused ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            )}
          </button>
          <button
            className={`btn-toggle ${loggingEnabled ? 'active' : ''}`}
            onClick={toggleLogging}
          >
            {loggingEnabled ? 'Logging On' : 'Logging Off'}
          </button>
          <button className="btn-secondary" onClick={() => setEvents([])}>
            Clear
          </button>
        </div>
      </div>

      <div className="dev-console-content">
        <div className="dev-console-events" ref={eventsContainerRef}>
          {filteredEvents.length === 0 ? (
            <div className="dev-console-empty">
              No API events captured yet. Make some requests!
            </div>
          ) : (
            filteredEvents.map(event => (
              <div
                key={event.id}
                className={`dev-event ${selectedEvent?.id === event.id ? 'selected' : ''}`}
                onClick={() => setSelectedEvent(event)}
              >
                <span
                  className="dev-event-method"
                  style={{ color: METHOD_COLORS[event.method] }}
                >
                  {event.method}
                </span>
                <span className="dev-event-path">{event.path}</span>
                <span
                  className="dev-event-status"
                  style={{ color: getStatusColor(event.statusCode) }}
                >
                  {event.statusCode}
                </span>
                <span className="dev-event-duration">{event.durationMs}ms</span>
                <span className="dev-event-age">{formatAge(event.timestamp)}</span>
                {event.fnName && (
                  <span className="dev-event-fn">{event.fnName}</span>
                )}
              </div>
            ))
          )}
        </div>

        <div className="dev-console-detail">
          {selectedEvent ? (
            <>
              <div className="dev-detail-header">
                <h3>
                  <span style={{ color: METHOD_COLORS[selectedEvent.method] }}>
                    {selectedEvent.method}
                  </span>{' '}
                  {selectedEvent.path}
                </h3>
                <span
                  className="dev-detail-status"
                  style={{ color: getStatusColor(selectedEvent.statusCode) }}
                >
                  {selectedEvent.statusCode}
                </span>
              </div>

              <div className="dev-detail-meta">
                <span>Duration: {selectedEvent.durationMs}ms</span>
                <span>User ID: {selectedEvent.userId ?? 'N/A'}</span>
                {selectedEvent.tokenId && <span>Token ID: {selectedEvent.tokenId}</span>}
                <span>Time: {new Date(selectedEvent.timestamp).toLocaleString()}</span>
              </div>

              {selectedEvent.fnName && fnMap[selectedEvent.fnName] && (
                <div className="dev-detail-section">
                  <h4>Frontend Function</h4>
                  <div className="dev-detail-fn">
                    <div className="dev-fn-signature">
                      {fnMap[selectedEvent.fnName].signature}
                    </div>
                    <div className="dev-fn-line">
                      client/src/api.ts:{fnMap[selectedEvent.fnName].line}
                    </div>
                    <pre className="dev-fn-source">
                      {fnMap[selectedEvent.fnName].source}
                    </pre>
                  </div>
                </div>
              )}

              {selectedEvent.requestBody && Object.keys(selectedEvent.requestBody as object).length > 0 && (
                <div className="dev-detail-section">
                  <h4>Request Body</h4>
                  <pre className="dev-detail-json">
                    {JSON.stringify(selectedEvent.requestBody, null, 2)}
                  </pre>
                </div>
              )}

              {selectedEvent.responseBody && (
                <div className="dev-detail-section">
                  <h4>Response Body</h4>
                  <pre className="dev-detail-json">
                    {JSON.stringify(selectedEvent.responseBody, null, 2)}
                  </pre>
                </div>
              )}

              <div className="dev-detail-actions">
                <div className="dev-copy-group">
                  <select
                    value={copyFormat}
                    onChange={e => setCopyFormat(e.target.value as any)}
                  >
                    <option value="fetch">JavaScript (fetch)</option>
                    <option value="curl">cURL</option>
                    <option value="python">Python</option>
                  </select>
                  <button onClick={copyCode}>
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <button className="btn-primary" onClick={tryRequest}>
                  Try It
                </button>
              </div>

              <div className="dev-detail-section">
                <h4>Generated Code</h4>
                <pre className="dev-detail-code">
                  {generateCode(selectedEvent, copyFormat)}
                </pre>
              </div>
            </>
          ) : (
            <div className="dev-console-empty">
              Select an event to view details
            </div>
          )}
        </div>
      </div>
      </>
      )}
    </div>
  );
}
