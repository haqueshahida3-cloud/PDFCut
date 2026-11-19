// A compact floating panel for contextual information (selection details, document facts). It sits outside
// the layout flow, can be collapsed, and animates only transform and opacity.
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState, type ReactNode } from 'react';

export function FloatingPanel({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <aside aria-label={title} className="glass fixed bottom-12 start-4 z-30 w-64 rounded-card p-3 shadow-xl">
      <button type="button" className="flex w-full items-center justify-between text-sm font-semibold" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {title}
        {open ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronUp className="h-4 w-4" aria-hidden="true" />}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </aside>
  );
}
