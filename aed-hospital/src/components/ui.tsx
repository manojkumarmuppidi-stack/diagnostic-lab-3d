"use client";
/**
 * Small, dependency-free UI kit (buttons, inputs, cards, dialogs, tabs, toasts, badges).
 * Styled with Tailwind + CSS variables defined in globals.css (light & dark).
 */
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";
import { cn } from "@/lib/client";

export function Button({
  variant = "primary",
  size,
  loading,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm"; loading?: boolean }) {
  return (
    <button className={cn("btn", `btn-${variant}`, size === "sm" && "btn-sm", className)} disabled={loading || rest.disabled} {...rest}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ title, actions, children, className, bodyClassName }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn("card", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Field({ label, error, help, children, required, htmlFor }: { label: string; error?: string; help?: string; children: ReactNode; required?: boolean; htmlFor?: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-2">
        {label}
        {required && <span className="ml-0.5" style={{ color: "var(--bad)" }}>*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-xs" style={{ color: "var(--bad)" }} role="alert">
          {error}
        </p>
      ) : help ? (
        <p className="text-xs muted">{help}</p>
      ) : null}
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 muted" role="status">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function EmptyState({ title, detail, action, icon }: { title: string; detail?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      {icon && <div className="muted">{icon}</div>}
      <p className="font-medium">{title}</p>
      {detail && <p className="max-w-md text-sm muted">{detail}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: { message: string } | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--bad)", color: "var(--bad)" }} role="alert">
      <XCircle className="h-4 w-4" aria-hidden />
      <span className="flex-1">{error.message}</span>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

const TONES = {
  neutral: { bg: "color-mix(in srgb, var(--text-3) 14%, transparent)", fg: "var(--text-2)" },
  blue: { bg: "color-mix(in srgb, var(--series-1) 16%, transparent)", fg: "var(--text)" },
  green: { bg: "color-mix(in srgb, var(--status-good) 18%, transparent)", fg: "var(--text)" },
  amber: { bg: "color-mix(in srgb, var(--status-warning) 26%, transparent)", fg: "var(--text)" },
  red: { bg: "color-mix(in srgb, var(--status-critical) 18%, transparent)", fg: "var(--text)" },
  violet: { bg: "color-mix(in srgb, var(--series-7) 18%, transparent)", fg: "var(--text)" },
};
export type Tone = keyof typeof TONES;

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  const t = TONES[tone];
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", className)} style={{ background: t.bg, color: t.fg }}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: "green",
  SUPERSEDED: "violet",
  VOIDED: "red",
  REVERSED: "red",
  OPEN: "neutral",
  REVIEW: "amber",
  RECONCILED: "blue",
  CLOSED: "green",
  PENDING: "amber",
  APPROVED: "green",
  REJECTED: "red",
  VALID: "green",
  WARNING: "amber",
  INVALID: "red",
  DUPLICATE: "violet",
  IMPORTED: "green",
  SKIPPED: "neutral",
  UPLOADED: "neutral",
  VALIDATED: "blue",
  CANCELLED: "neutral",
  NEW: "blue",
  OLD: "neutral",
  SETTLED: "green",
  PARTIAL: "amber",
  DUE: "red",
  REFUND_DUE: "violet",
  UNBILLED: "neutral",
  ADVANCE: "blue",
  PAYMENT: "blue",
  FINAL_SETTLEMENT: "green",
  REFUND: "red",
};
export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</Badge>;
}

/** Accessible modal; renders as a bottom sheet on phones and a centred dialog on larger screens. */
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Callers pass a new onClose on every render; keep the latest in a ref so the effect below runs
  // only when the dialog opens — re-running it on each keystroke moved the cursor out of the field.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    // First field of the form (not the close button in the header).
    const t = setTimeout(() => (ref.current?.querySelector<HTMLElement>("[data-modal-body] :is(input,select,textarea)") ?? ref.current?.querySelector<HTMLElement>("input,select,textarea,button"))?.focus(), 30);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn("flex max-h-[92vh] w-full flex-col rounded-t-2xl shadow-xl sm:rounded-2xl", wide ? "sm:max-w-4xl" : "sm:max-w-lg")}
        style={{ background: "var(--surface)" }}
      >
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--border)" }}>
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4" data-modal-body>
          {children}
        </div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" style={{ borderColor: "var(--border)" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** Confirmation dialog, optionally requiring a reason (void, reopen, reverse…). */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  danger,
  requireReason,
  reasonLabel = "Reason",
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void> | void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  requireReason?: boolean;
  reasonLabel?: string;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setReason("");
      setErr(null);
    }
  }, [open]);
  const go = async () => {
    if (requireReason && reason.trim().length < 5) return setErr("Please enter a reason (at least 5 characters)");
    setBusy(true);
    setErr(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={go} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div>{message}</div>
        {requireReason && (
          <Field label={reasonLabel} required error={err ?? undefined}>
            <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
        {!requireReason && err && <p style={{ color: "var(--bad)" }}>{err}</p>}
      </div>
    </Modal>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: ReactNode; hidden?: boolean }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="tablist">
      {tabs
        .filter((t) => !t.hidden)
        .map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={value === t.key}
            onClick={() => onChange(t.key)}
            className={cn("whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition", value === t.key ? "shadow-sm" : "muted hover:opacity-80")}
            style={value === t.key ? { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" } : { border: "1px solid transparent" }}
          >
            {t.label}
          </button>
        ))}
    </div>
  );
}

// ─────────────────────────── toasts ───────────────────────────

type Toast = { id: number; kind: "success" | "error" | "info"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:items-end" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="card pointer-events-auto flex max-w-md items-start gap-2 px-4 py-3 text-sm shadow-lg">
            {t.kind === "success" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--status-good)" }} />
            ) : t.kind === "error" ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--status-critical)" }} />
            ) : (
              <Info className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--series-1)" }} />
            )}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
