import { useState, useRef } from 'react';
import { api } from '../api';

interface TrelloImportModalProps {
  onClose: () => void;
  onImportComplete: () => void;
  onSelectBoard: (boardId: string, boardName: string) => void;
}

interface Summary {
  boardName: string;
  listCount: number;
  cardCount: number;
  archivedCardCount: number;
  labelCount: number;
  memberCount: number;
  matchedMemberCount: number;
  commentCount: number;
  checklistItemCount: number;
}

interface MemberMatch {
  trelloUsername: string;
  fullName: string;
  matched: boolean;
  plinyUserId?: string;
  plinyUsername?: string;
}

interface PreviewData {
  summary: Summary;
  members: MemberMatch[];
  boardData: any;
}

interface ImportResult {
  boardId: string;
  boardName: string;
  stats: {
    columns: number;
    cards: number;
    labels: number;
    comments: number;
    checklistItems: number;
    assignees: number;
  };
}

export default function TrelloImportModal({ onClose, onImportComplete, onSelectBoard }: TrelloImportModalProps) {
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.json')) {
      setError('Please select a JSON file');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setError('File too large. Trello exports are usually under 10MB.');
      return;
    }

    setLoading(true);
    setError(null);
    setFileName(file.name);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const token = api.getToken();
      const response = await fetch('/api/trello/preview', {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(err.error || 'Upload failed');
      }

      const data: PreviewData = await response.json();
      setPreview(data);
      setStep('preview');
    } catch (err: any) {
      setError(err.message || 'Failed to parse Trello export');
      setFileName(null);
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleImport = async () => {
    if (!preview) return;

    setLoading(true);
    setError(null);

    try {
      const token = api.getToken();
      const response = await fetch('/api/trello/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ boardData: preview.boardData }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Import failed' }));
        throw new Error(err.error || 'Import failed');
      }

      const result: ImportResult = await response.json();
      setImportResult(result);
      setStep('done');
      onImportComplete();
    } catch (err: any) {
      setError(err.message || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoToBoard = () => {
    if (importResult) {
      onClose();
      onSelectBoard(importResult.boardId, importResult.boardName);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal ${step === 'preview' ? 'modal-trello-import' : ''}`} onClick={(e) => e.stopPropagation()}>
        <h2>Import from Trello</h2>

        {step !== 'done' && (
          <div className="csv-steps">
            <div className={`csv-step ${step === 'upload' ? 'active' : 'completed'}`}>
              <span className="csv-step-num">{step === 'upload' ? '1' : '\u2713'}</span>
              Upload
            </div>
            <div className="csv-step-line" />
            <div className={`csv-step ${step === 'preview' ? 'active' : ''}`}>
              <span className="csv-step-num">2</span>
              Preview
            </div>
          </div>
        )}

        {step === 'upload' && (
          <>
            <p className="modal-subtitle" style={{ marginBottom: '1rem', color: 'var(--color-text-secondary)' }}>
              Export from Trello: Board &rarr; Share, print, and export &rarr; Export as JSON
            </p>
            <div
              className={`csv-drop-zone${dragOver ? ' drag-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                style={{ display: 'none' }}
              />
              {loading ? (
                <div className="loading-inline"><div className="spinner"></div></div>
              ) : (
                <>
                  <svg className="csv-upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  {fileName ? (
                    <p className="csv-filename">{fileName}</p>
                  ) : (
                    <>
                      <p className="csv-drop-title">Drop Trello JSON file here</p>
                      <p className="csv-drop-hint">or click to browse (max 50MB)</p>
                    </>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {step === 'preview' && preview && (
          <>
            <div className="trello-preview-summary">
              <h3>Board: "{preview.summary.boardName}"</h3>
              <ul className="trello-summary-list">
                <li><span className="trello-summary-icon">|</span> {preview.summary.listCount} column{preview.summary.listCount !== 1 ? 's' : ''}</li>
                <li>
                  <span className="trello-summary-icon">|</span> {preview.summary.cardCount} card{preview.summary.cardCount !== 1 ? 's' : ''}
                  {preview.summary.archivedCardCount > 0 && <span className="trello-archived-note"> ({preview.summary.archivedCardCount} archived)</span>}
                </li>
                <li><span className="trello-summary-icon">|</span> {preview.summary.labelCount} label{preview.summary.labelCount !== 1 ? 's' : ''}</li>
                <li>
                  <span className="trello-summary-icon">|</span> {preview.summary.memberCount} member{preview.summary.memberCount !== 1 ? 's' : ''}
                  {preview.summary.memberCount > 0 && (
                    <span className="trello-match-note">
                      ({preview.summary.matchedMemberCount} matched, {preview.summary.memberCount - preview.summary.matchedMemberCount} as guest{preview.summary.memberCount - preview.summary.matchedMemberCount !== 1 ? 's' : ''})
                    </span>
                  )}
                </li>
                <li><span className="trello-summary-icon">|</span> {preview.summary.commentCount} comment{preview.summary.commentCount !== 1 ? 's' : ''}</li>
                <li><span className="trello-summary-icon">\u2514</span> {preview.summary.checklistItemCount} checklist item{preview.summary.checklistItemCount !== 1 ? 's' : ''}</li>
              </ul>
            </div>

            {preview.members.length > 0 && (
              <div className="trello-members-table">
                <h4>Member Matching</h4>
                <table>
                  <thead>
                    <tr>
                      <th>Trello Username</th>
                      <th>Full Name</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.members.map((member) => (
                      <tr key={member.trelloUsername}>
                        <td>{member.trelloUsername}</td>
                        <td>{member.fullName}</td>
                        <td>
                          {member.matched ? (
                            <span className="trello-match-status matched">Matched to {member.plinyUsername}</span>
                          ) : (
                            <span className="trello-match-status unmatched">Will import as guest</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {step === 'done' && importResult && (
          <div className="csv-import-result">
            <svg className="csv-success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="8 12 11 15 16 9" />
            </svg>
            <p className="csv-result-count">
              Imported "{importResult.boardName}"
            </p>
            <ul className="trello-import-stats">
              <li>{importResult.stats.columns} column{importResult.stats.columns !== 1 ? 's' : ''}</li>
              <li>{importResult.stats.cards} card{importResult.stats.cards !== 1 ? 's' : ''}</li>
              <li>{importResult.stats.labels} label{importResult.stats.labels !== 1 ? 's' : ''}</li>
              <li>{importResult.stats.assignees} assignee{importResult.stats.assignees !== 1 ? 's' : ''}</li>
              <li>{importResult.stats.comments} comment{importResult.stats.comments !== 1 ? 's' : ''}</li>
              <li>{importResult.stats.checklistItems} checklist item{importResult.stats.checklistItems !== 1 ? 's' : ''}</li>
            </ul>
          </div>
        )}

        {error && (
          <div className="csv-error">{error}</div>
        )}

        <div className="modal-actions">
          {step === 'preview' && (
            <button onClick={() => { setStep('upload'); setPreview(null); setError(null); setFileName(null); }} className="btn-secondary" style={{ marginRight: 'auto' }}>
              Back
            </button>
          )}
          <button onClick={onClose} className="btn-secondary">
            {step === 'done' ? 'Close' : 'Cancel'}
          </button>
          {step === 'preview' && (
            <button
              onClick={handleImport}
              className="btn-primary"
              disabled={loading}
            >
              {loading ? 'Importing...' : 'Import'}
            </button>
          )}
          {step === 'done' && (
            <button onClick={handleGoToBoard} className="btn-primary">
              Go to Board
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
