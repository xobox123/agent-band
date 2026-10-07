interface Props {
  onClick: () => void;
  className?: string;
}

/** The "×" button shared by dialogs, the details panel and the dock. */
export function CloseButton({ onClick, className = '' }: Props) {
  return (
    <button
      type="button"
      className={`btn btn-icon close-btn ${className}`.trim()}
      aria-label="Close"
      title="Close"
      onClick={onClick}
    >
      <span aria-hidden="true">×</span>
    </button>
  );
}
