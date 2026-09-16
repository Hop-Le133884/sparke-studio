import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
import { X, LoaderCircle } from "lucide-react";

/**
 * The Sparke mark: two layered rounded squares, navy behind and an orange
 * gradient in front, separated by a knockout that takes the surface colour
 * it sits on (`--brand-knockout`). Built from primitive rects per the design
 * system; do not redraw it freehand.
 */
export function SparkeMark({ size = 32 }: { size?: number }) {
  const gradientId = useId();
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF8A3D" />
          <stop offset="1" stopColor="#F05A22" />
        </linearGradient>
      </defs>
      <rect x="8" y="8" width="34" height="34" rx="9" fill="#374EA2" />
      <rect
        x="19"
        y="19"
        width="40"
        height="40"
        rx="11"
        style={{ fill: "var(--brand-knockout, #ffffff)" }}
      />
      <rect x="22" y="22" width="34" height="34" rx="9" fill={`url(#${gradientId})`} />
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <span className="brand-symbol">
        <SparkeMark />
      </span>
      {!compact && <span className="brand-name">Sparke</span>}
    </span>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""} ${className}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // The owner may keep a busy dialog open; native Escape must not bypass it.
        event.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Busy({ label = "Working…" }: { label?: string }) {
  return (
    <span className="busy">
      <LoaderCircle size={16} className="spinner" />
      {label}
    </span>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  const input =
    isValidElement(children) &&
    typeof children.type === "string" &&
    ["input", "textarea", "select"].includes(children.type)
      ? cloneElement(children as ReactElement<Record<string, unknown>>, {
          id,
          "aria-label":
            (children.props as Record<string, unknown>)["aria-label"] || label,
          ...(hint ? { "aria-describedby": `${id}-hint` } : {}),
        })
      : children;
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      {input}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </label>
  );
}
export function Empty({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
