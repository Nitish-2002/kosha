import './ConfirmDialog.scss';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  // A third, non-destructive way out — e.g. "Save changes" alongside a
  // "Discard"/Cancel pair, for a leave-with-unsaved-work prompt where losing
  // the change is only one of the reasonable choices, not the only one.
  primaryLabel?: string;
  onPrimary?: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
  primaryLabel,
  onPrimary,
}: ConfirmDialogProps) {
  return (
    <div className="confirm-backdrop" onClick={onCancel}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="confirm-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="confirm-danger-btn" onClick={onConfirm}>
            {confirmLabel}
          </button>
          {primaryLabel && onPrimary && (
            <button type="button" className="confirm-primary-btn" onClick={onPrimary}>
              {primaryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
