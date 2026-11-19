// Reusable, accessible UI primitives: buttons, cards, modal, switches, sliders, segmented
// controls, skeletons, empty states, progress, drag-and-drop zones and toasts.
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, Loader2, Upload, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  cloneElement,
  isValidElement,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { dismissToast, useApp, type Toast } from '../store/app';
import { cn } from '../utils/cn';

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: ReactNode;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn('btn', `btn-${variant}`, size === 'sm' && 'btn-sm', className)}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

export function Card({ className, glass = true, children, ...rest }: HTMLAttributes<HTMLDivElement> & { glass?: boolean }) {
  return (
    <div className={cn('rounded-card p-5', glass ? 'glass' : 'border border-line bg-surface', className)} {...rest}>
      {children}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn('input', props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn('input', props.className)} />;
}

/** Gives a single form control the field's label as its accessible name (unless it already has one). */
function labelled(children: ReactNode, label: string): ReactNode {
  if (isValidElement<{ 'aria-label'?: string }>(children) && !children.props['aria-label']) {
    return cloneElement(children, { 'aria-label': label });
  }
  return children;
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <div className={cn('block space-y-1.5', className)}>
      <span className="text-sm font-medium">{label}</span>
      {labelled(children, label)}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200', checked ? 'bg-accent' : 'bg-line')}
    >
      <span
        className={cn(
          'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200',
          checked ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0.5 rtl:-translate-x-0.5',
        )}
      />
    </button>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--accent)]"
      />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  id,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (v: T) => void;
  label: string;
  id: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-line/50 p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className="relative rounded-lg px-3 py-1.5 text-sm font-medium"
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-lg bg-surface shadow-sm"
                transition={{ type: 'spring', stiffness: 520, damping: 42 }}
              />
            )}
            <span className={cn('relative', active ? 'text-fg' : 'text-muted')}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('skeleton rounded-lg', className)} />;
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">{icon}</div>
      <div className="font-semibold">{title}</div>
      {text && <p className="max-w-sm text-sm text-muted">{text}</p>}
      {action}
    </div>
  );
}

export function ProgressBar({ value, indeterminate = false, className }: { value?: number; indeterminate?: boolean; className?: string }) {
  const pct = Math.round((value ?? 0) * 100);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : pct}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-line', className)}
    >
      {indeterminate ? (
        <div className="progress-indeterminate h-full w-1/3 rounded-full bg-accent" />
      ) : (
        <motion.div
          className="h-full w-full origin-left rounded-full bg-accent"
          initial={false}
          animate={{ scaleX: Math.min(1, Math.max(0, value ?? 0)) }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        />
      )}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="modal"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn('glass relative z-10 w-full rounded-card p-5 shadow-2xl', width)}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18 }}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{title}</h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto pr-1">{children}</div>
            {footer && <div className="mt-4 flex flex-wrap justify-end gap-2">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Dropzone({
  onFiles,
  accept,
  multiple = false,
  title,
  hint,
  compact = false,
  icon,
}: {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  title: string;
  hint?: string;
  compact?: boolean;
  icon?: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const handle = (list: FileList | null): void => {
    if (list && list.length > 0) onFiles(Array.from(list));
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={title}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        handle(e.dataTransfer.files);
      }}
      className={cn('drop-zone', over && 'drop-zone-over', compact ? 'py-6' : 'py-12')}
    >
      <motion.div
        animate={{ scale: over ? 1.05 : 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 22 }}
        className="flex flex-col items-center gap-3 text-center"
      >
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent">
          {icon ?? <Upload className="h-7 w-7" aria-hidden="true" />}
        </div>
        <div className="font-medium">{title}</div>
        {hint && <div className="max-w-md text-sm text-muted">{hint}</div>}
      </motion.div>
      <input
        ref={(el) => {
          inputRef.current = el;
        }}
        type="file"
        hidden
        multiple={multiple}
        accept={accept}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          handle(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

function ToastItem({ t }: { t: Toast }) {
  useEffect(() => {
    const timer = window.setTimeout(() => dismissToast(t.id), t.duration);
    return () => window.clearTimeout(timer);
  }, [t.id, t.duration]);
  const Icon = t.kind === 'error' ? AlertTriangle : t.kind === 'success' ? CheckCircle2 : Info;
  const tone = t.kind === 'error' ? 'text-red-500' : t.kind === 'success' ? 'text-emerald-500' : 'text-accent';
  return (
    <motion.div
      layout
      role="status"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="glass pointer-events-auto flex min-w-[260px] max-w-md items-center gap-3 rounded-card px-4 py-3 shadow-xl"
    >
      <Icon className={cn('h-5 w-5 shrink-0', tone)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{t.title}</div>
        {t.message && <div className="truncate text-xs text-muted">{t.message}</div>}
      </div>
      {t.actionLabel && t.onAction && (
        <button
          type="button"
          className="btn btn-ghost btn-sm font-semibold text-accent"
          onClick={() => {
            t.onAction?.();
            dismissToast(t.id);
          }}
        >
          {t.actionLabel}
        </button>
      )}
      <button type="button" className="btn btn-ghost btn-sm h-7 w-7 p-0" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
        <X className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );
}

export function ToastHost() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2 rtl:translate-x-1/2" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastItem key={t.id} t={t} />
        ))}
      </AnimatePresence>
    </div>
  );
}
