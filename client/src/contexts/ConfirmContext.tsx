import { createContext, useContext, useState, useCallback, useRef } from 'react';

interface ConfirmOptions {
  confirmLabel?: string;
}

type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingConfirm {
  message: string;
  confirmLabel: string;
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);

  const confirm: ConfirmFn = useCallback((message, options) => {
    return new Promise<boolean>((resolve) => {
      const entry: PendingConfirm = {
        message,
        confirmLabel: options?.confirmLabel || 'Confirm',
        resolve,
      };
      pendingRef.current = entry;
      setPending(entry);
    });
  }, []);

  const handleResponse = (value: boolean) => {
    pendingRef.current?.resolve(value);
    pendingRef.current = null;
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div className="modal-overlay" onClick={() => handleResponse(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <p style={{ margin: '0 0 1.5rem', fontSize: '1rem' }}>{pending.message}</p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => handleResponse(false)}>
                Cancel
              </button>
              <button className="btn-danger" onClick={() => handleResponse(true)} autoFocus>
                {pending.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used within ConfirmProvider');
  return confirm;
}
