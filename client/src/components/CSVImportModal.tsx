import { useState, useRef } from 'react';
import { api } from '../api';

interface CSVImportModalProps {
  boardId: string;
  onClose: () => void;
  onImportComplete: () => void;
}

interface PreviewData {
  importId: string;
  headers: string[];
  suggestedMapping: Record<string, string>;
  sampleRows: Record<string, string>[];
  rowCount: number;
  customFields: { id: string; name: string; field_type: string }[];
}

const PLANK_FIELDS = [
  { value: 'skip', label: 'Skip' },
  { value: 'title', label: 'Title' },
  { value: 'description', label: 'Description' },
  { value: 'column', label: 'Column' },
  { value: 'assignees', label: 'Assignees' },
  { value: 'labels', label: 'Labels' },
  { value: 'due_date', label: 'Due Date' },
  { value: 'start_date', label: 'Start Date' },
  { value: 'position', label: 'Position' },
];

export default function CSVImportModal({ boardId, onClose, onImportComplete }: CSVImportModalProps) {
  const [step, setStep] = useState<'upload' | 'map'>('upload');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; errors: { row: number; field: string; message: string }[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Please select a CSV file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('File size must be under 5MB');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const token = api.getToken();
      const response = await fetch(`/api/boards/${boardId}/csv/import/preview`, {
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
      setMapping(data.suggestedMapping);
      setStep('map');
    } catch (err: any) {
      setError(err.message || 'Failed to parse CSV');
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

  const handleConfirm = async () => {
    if (!preview) return;

    setLoading(true);
    setError(null);

    try {
      const token = api.getToken();
      const response = await fetch(`/api/boards/${boardId}/csv/import/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ importId: preview.importId, mapping }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Import failed' }));
        throw new Error(err.error || 'Import failed');
      }

      const result = await response.json();
      setImportResult(result);

      setTimeout(() => {
        onImportComplete();
        onClose();
      }, 3000);
    } catch (err: any) {
      setError(err.message || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  const updateMapping = (header: string, field: string) => {
    setMapping(prev => ({ ...prev, [header]: field }));
  };

  const fieldOptions = [
    ...PLANK_FIELDS,
    ...(preview?.customFields || []).map(cf => ({
      value: `custom:${cf.id}`,
      label: cf.name,
    })),
  ];

  const mappedTitleCount = Object.values(mapping).filter(v => v === 'title').length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal ${step === 'map' ? 'modal-csv-import' : ''}`} onClick={(e) => e.stopPropagation()}>
        <h2>Import Cards from CSV</h2>

        {step === 'upload' && (
          <>
            <p className="modal-subtitle">Upload a CSV file to import cards into this board.</p>
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
                accept=".csv"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                style={{ display: 'none' }}
              />
              {loading ? (
                <div className="loading-inline"><div className="spinner"></div></div>
              ) : (
                <>
                  <p style={{ margin: '0 0 0.5rem', fontWeight: 500 }}>Drop CSV file here</p>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>or click to browse (max 5MB)</p>
                </>
              )}
            </div>
          </>
        )}

        {step === 'map' && preview && !importResult && (
          <>
            <p className="modal-subtitle">{preview.rowCount} rows found. Map CSV columns to card fields.</p>

            <div className="csv-mapping-table">
              <div className="csv-mapping-header">
                <span>CSV Column</span>
                <span>Maps To</span>
              </div>
              {preview.headers.map(header => (
                <div key={header} className={`csv-mapping-row${mapping[header] !== 'skip' ? ' mapped' : ''}`}>
                  <span className="csv-header-name">{header}</span>
                  <select
                    value={mapping[header] || 'skip'}
                    onChange={(e) => updateMapping(header, e.target.value)}
                  >
                    {fieldOptions.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {preview.sampleRows.length > 0 && (
              <div className="csv-preview">
                <p style={{ fontWeight: 500, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Preview (first {preview.sampleRows.length} rows)</p>
                <div className="csv-preview-scroll">
                  <table>
                    <thead>
                      <tr>
                        {preview.headers.filter(h => mapping[h] !== 'skip').map(h => (
                          <th key={h}>{fieldOptions.find(f => f.value === mapping[h])?.label || h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sampleRows.map((row, i) => (
                        <tr key={i}>
                          {preview.headers.filter(h => mapping[h] !== 'skip').map(h => (
                            <td key={h}>{row[h] || ''}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {importResult && (
          <div className="csv-import-result">
            <p style={{ fontWeight: 600, fontSize: '1.1rem', color: 'var(--primary)' }}>
              Imported {importResult.created} card{importResult.created !== 1 ? 's' : ''}
            </p>
            {importResult.errors.length > 0 && (
              <div className="csv-import-warnings">
                <p style={{ fontWeight: 500, fontSize: '0.85rem', marginBottom: '0.25rem' }}>{importResult.errors.length} warning{importResult.errors.length !== 1 ? 's' : ''}:</p>
                <ul>
                  {importResult.errors.slice(0, 10).map((err, i) => (
                    <li key={i}>Row {err.row}: {err.message}</li>
                  ))}
                  {importResult.errors.length > 10 && <li>...and {importResult.errors.length - 10} more</li>}
                </ul>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="csv-error">{error}</div>
        )}

        <div className="modal-actions">
          {step === 'map' && !importResult && (
            <button onClick={() => { setStep('upload'); setPreview(null); setError(null); }} className="btn-secondary" style={{ marginRight: 'auto' }}>
              Back
            </button>
          )}
          <button onClick={onClose} className="btn-secondary">
            {importResult ? 'Close' : 'Cancel'}
          </button>
          {step === 'map' && !importResult && (
            <button
              onClick={handleConfirm}
              className="btn-primary"
              disabled={loading || mappedTitleCount !== 1}
            >
              {loading ? 'Importing...' : `Import ${preview?.rowCount || 0} Cards`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
