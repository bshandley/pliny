import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { io, Socket } from 'socket.io-client';
import { api } from '../api';
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
  isOpen: boolean;
  onClose: () => void;
}

type DevTab = 'api-log' | 'webhooks';

export default function DevConsole({ isOpen, onClose }: DevConsoleProps) {
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
  const pausedRef = useRef(paused);

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  // Body scroll lock
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  // Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Load initial data
  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/dev/events', {
      headers: { Authorization: `Bearer ${api.getToken()}` },
    })
      .then(r => r.json())
      .then(setEvents)
      .catch(() => {});

    fetch('/api/dev/fn-map', {
      headers: { Authorization: `Bearer ${api.getToken()}` },
    })
      .then(r => r.json())
      .then(setFnMap)
      .catch(() => {});

    fetch('/api/dev/status', {
      headers: { Authorization: `Bearer ${api.getToken()}` },
    })
      .then(r => r.json())
      .then(data => setLoggingEnabled(data.enabled))
      .catch(() => {});
  }, [isOpen]);

  // WebSocket — stable connection while modal is open
  useEffect(() => {
    if (!isOpen) return;
    const token = api.getToken();
    if (!token) return;

    const socket = io('/dev', {
      auth: { token },
      transports: ['websocket'],
    });

    socket.on('api-event', (event: ApiEvent) => {
      if (!pausedRef.current) {
        setEvents(prev => [event, ...prev.slice(0, 499)]);
      }
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [isOpen]);

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
      // ignore
    }
  };

  const formatAge = useCallback((timestamp: string) => {
    const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }, []);

  const getStatusClass = (status: number) => {
    const first = String(status)[0];
    if (first === '2') return 'success';
    if (first === '3') return 'redirect';
    if (first === '4') return 'client-error';
    if (first === '5') return 'server-error';
    return '';
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
        code += `, {\n  method: '${event.method}'`;
        code += `,\n  headers: {\n    'Content-Type': 'application/json',\n    'Authorization': 'Bearer YOUR_TOKEN'\n  }`;
        if (hasBody) {
          code += `,\n  body: JSON.stringify(${bodyStr})`;
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
    let code = `import requests\n\nresponse = requests.${event.method.toLowerCase()}(\n    '${url}',\n    headers={\n        'Content-Type': 'application/json',\n        'Authorization': 'Bearer YOUR_TOKEN'\n    }`;
    if (hasBody) {
      code += `,\n    json=${bodyStr.replace(/"/g, "'")}`;
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

  if (!isOpen) return null;

  return createPortal(
    <div className="devconsole-overlay" onMouseDown={e => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="devconsole-modal">
        {/* Header */}
        <div className="devconsole-header">
          <div className="devconsole-header-left">
            <svg className="devconsole-logo" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
            </svg>
            <h2>API Console</h2>
          </div>
          <div className="devconsole-tabs">
            <button
              className={`devconsole-tab ${activeTab === 'api-log' ? 'active' : ''}`}
              onClick={() => setActiveTab('api-log')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>
              </svg>
              API Log
            </button>
            <button
              className={`devconsole-tab ${activeTab === 'webhooks' ? 'active' : ''}`}
              onClick={() => setActiveTab('webhooks')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              Webhooks
            </button>
          </div>
          <button className="devconsole-close" onClick={onClose} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {activeTab === 'webhooks' ? (
          <div className="devconsole-body">
            <WebhookSettings />
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div className="devconsole-toolbar">
              <div className="devconsole-filters">
                <select value={filterMethod} onChange={e => setFilterMethod(e.target.value)}>
                  <option value="">All Methods</option>
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                  <option value="PATCH">PATCH</option>
                </select>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                  <option value="">All Status</option>
                  <option value="2">2xx Success</option>
                  <option value="3">3xx Redirect</option>
                  <option value="4">4xx Client Error</option>
                  <option value="5">5xx Server Error</option>
                </select>
                <div className="devconsole-filter-input">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  <input
                    type="text"
                    placeholder="Filter path..."
                    value={filterPath}
                    onChange={e => setFilterPath(e.target.value)}
                  />
                </div>
              </div>
              <div className="devconsole-controls">
                <button
                  className={`devconsole-ctrl-btn ${paused ? 'active' : ''}`}
                  onClick={() => setPaused(!paused)}
                  title={paused ? 'Resume live feed' : 'Pause live feed'}
                >
                  {paused ? (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                      Resume
                    </>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
                      </svg>
                      Pause
                    </>
                  )}
                </button>
                <button
                  className={`devconsole-recording-btn ${loggingEnabled ? 'active' : ''}`}
                  onClick={toggleLogging}
                >
                  <span className="devconsole-recording-dot" />
                  {loggingEnabled ? 'Logging On' : 'Logging Off'}
                </button>
                <button
                  className="devconsole-ctrl-btn"
                  onClick={() => { setEvents([]); setSelectedEvent(null); }}
                  title="Clear all events"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/>
                  </svg>
                  Clear
                </button>
              </div>
            </div>

            {/* Content: events + detail */}
            <div className="devconsole-content">
              <div className="devconsole-events" ref={eventsContainerRef}>
                {filteredEvents.length === 0 ? (
                  <div className="devconsole-empty">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
                    </svg>
                    <p>No API events captured</p>
                    <span>Make some requests to see them here</span>
                  </div>
                ) : (
                  filteredEvents.map(event => (
                    <div
                      key={event.id}
                      className={`devconsole-event ${selectedEvent?.id === event.id ? 'selected' : ''}`}
                      onClick={() => setSelectedEvent(event)}
                    >
                      <span className="devconsole-event-method" data-method={event.method}>
                        {event.method}
                      </span>
                      <span className="devconsole-event-path">{event.path}</span>
                      <span className={`devconsole-event-status ${getStatusClass(event.statusCode)}`}>
                        {event.statusCode}
                      </span>
                      <span className="devconsole-event-duration">{event.durationMs}ms</span>
                      <span className="devconsole-event-age">{formatAge(event.timestamp)}</span>
                      {event.fnName && (
                        <span className="devconsole-event-fn">{event.fnName}</span>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="devconsole-detail">
                {selectedEvent ? (
                  <>
                    <div className="devconsole-detail-header">
                      <div className="devconsole-detail-title">
                        <span className="devconsole-event-method" data-method={selectedEvent.method}>
                          {selectedEvent.method}
                        </span>
                        <code className="devconsole-detail-path">{selectedEvent.path}</code>
                      </div>
                      <span className={`devconsole-detail-status-badge ${getStatusClass(selectedEvent.statusCode)}`}>
                        {selectedEvent.statusCode}
                      </span>
                    </div>

                    <div className="devconsole-detail-meta">
                      <div className="devconsole-meta-item">
                        <span className="devconsole-meta-label">Duration</span>
                        <span className="devconsole-meta-value">{selectedEvent.durationMs}ms</span>
                      </div>
                      <div className="devconsole-meta-item">
                        <span className="devconsole-meta-label">User</span>
                        <span className="devconsole-meta-value">{selectedEvent.userId ?? 'N/A'}</span>
                      </div>
                      {selectedEvent.tokenId && (
                        <div className="devconsole-meta-item">
                          <span className="devconsole-meta-label">Token</span>
                          <span className="devconsole-meta-value devconsole-mono">{selectedEvent.tokenId}</span>
                        </div>
                      )}
                      <div className="devconsole-meta-item">
                        <span className="devconsole-meta-label">Time</span>
                        <span className="devconsole-meta-value">{new Date(selectedEvent.timestamp).toLocaleString()}</span>
                      </div>
                    </div>

                    {selectedEvent.fnName && fnMap[selectedEvent.fnName] && (
                      <div className="devconsole-section">
                        <h4>Frontend Function</h4>
                        <div className="devconsole-fn-card">
                          <div className="devconsole-fn-sig">
                            {fnMap[selectedEvent.fnName].signature}
                          </div>
                          <div className="devconsole-fn-loc">
                            client/src/api.ts:{fnMap[selectedEvent.fnName].line}
                          </div>
                          <pre className="devconsole-fn-source">
                            {fnMap[selectedEvent.fnName].source}
                          </pre>
                        </div>
                      </div>
                    )}

                    {selectedEvent.requestBody && Object.keys(selectedEvent.requestBody as object).length > 0 && (
                      <div className="devconsole-section">
                        <h4>Request Body</h4>
                        <pre className="devconsole-json">
                          {JSON.stringify(selectedEvent.requestBody, null, 2)}
                        </pre>
                      </div>
                    )}

                    {selectedEvent.responseBody && (
                      <div className="devconsole-section">
                        <h4>Response Body</h4>
                        <pre className="devconsole-json">
                          {JSON.stringify(selectedEvent.responseBody, null, 2)}
                        </pre>
                      </div>
                    )}

                    <div className="devconsole-actions">
                      <div className="devconsole-copy-group">
                        <select
                          value={copyFormat}
                          onChange={e => setCopyFormat(e.target.value as 'fetch' | 'curl' | 'python')}
                        >
                          <option value="fetch">JavaScript</option>
                          <option value="curl">cURL</option>
                          <option value="python">Python</option>
                        </select>
                        <button onClick={copyCode}>
                          {copied ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                      <button className="devconsole-try-btn" onClick={tryRequest}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                        Try It
                      </button>
                    </div>

                    <div className="devconsole-section">
                      <h4>Generated Code</h4>
                      <pre className="devconsole-code">
                        {generateCode(selectedEvent, copyFormat)}
                      </pre>
                    </div>
                  </>
                ) : (
                  <div className="devconsole-empty">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="13" y2="12"/>
                    </svg>
                    <p>Select an event to inspect</p>
                    <span>Click any request from the list</span>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
