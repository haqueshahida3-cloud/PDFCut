// Dashboard: big tool cards with search and pinning, recent files (favourites, reopen, remove),
// and a drop zone for quick opening.
import { motion } from 'framer-motion';
import { FileText, Pin, Star, Trash2 } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dropzone, EmptyState, Input } from '../components/ui';
import { formatBytes, formatDate } from '../lib/util';
import { loadRecentBytes, navigate, removeRecent, setPending, toast, togglePin, updateRecent, useApp } from '../store/app';
import { GROUP_ORDER, allTools } from './registry';

export default function Home() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const q = useDeferredValue(query.trim().toLowerCase());
  const recents = useApp((s) => s.recents);
  const pinned = useApp((s) => s.pinned);
  const tools = allTools()
    .filter((x) => x.id !== 'home')
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  const filtered = tools.filter((x) => {
    if (!q) return true;
    const label = t(`nav.${x.id}`, { defaultValue: x.id }).toLowerCase();
    const desc = t(`desc.${x.id}`, { defaultValue: '' }).toLowerCase();
    return label.includes(q) || desc.includes(q) || x.id.includes(q) || x.keywords.some((k) => k.includes(q));
  });

  const openRecent = async (id: string, name: string): Promise<void> => {
    const bytes = await loadRecentBytes(id);
    if (!bytes) {
      toast({ kind: 'error', title: 'This file is no longer stored', message: name });
      removeRecent(id);
      return;
    }
    setPending([new File([bytes as unknown as BlobPart], name, { type: 'application/pdf' })]);
    navigate('viewer');
  };

  return (
    <div className="h-full overflow-auto px-6 pb-10 pt-6">
      <section className="mx-auto max-w-6xl space-y-8">
        <div className="space-y-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{t('home.title')}</h1>
            <p className="mt-1 text-muted">{t('app.tagline')}</p>
          </div>
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('home.search')}
            aria-label={t('home.search')}
            className="h-11 w-full max-w-xl text-base"
          />
        </div>

        {!q && pinned.length > 0 && (
          <section aria-label={t('home.pinned')} className="flex flex-wrap items-center gap-2">
            <span className="me-1 text-xs font-semibold uppercase tracking-wider text-muted">{t('home.pinned')}</span>
            {pinned.map((id) => {
              const tool = tools.find((x) => x.id === id);
              if (!tool) return null;
              const Icon = tool.icon;
              return (
                <button key={id} type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(id)}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {t(`nav.${id}`, { defaultValue: id })}
                </button>
              );
            })}
          </section>
        )}

        {filtered.length === 0 ? (
          <EmptyState icon={<FileText className="h-6 w-6" />} title={t('home.no_results')} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((tool, i) => {
              const Icon = tool.icon;
              const isPinned = pinned.includes(tool.id);
              return (
                <motion.div
                  key={tool.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(i, 12) * 0.02 }}
                  className="glass group relative rounded-card transition-transform duration-200 hover:-translate-y-0.5 focus-within:-translate-y-0.5"
                >
                  <button
                    type="button"
                    onClick={() => navigate(tool.id)}
                    className="flex w-full flex-col gap-3 rounded-card p-5 text-start"
                  >
                    <span className="grid h-11 w-11 place-items-center rounded-2xl bg-accent-soft text-accent transition-transform duration-200 group-hover:scale-105">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="block font-semibold">{t(`nav.${tool.id}`, { defaultValue: tool.id })}</span>
                    <span className="block text-sm text-muted">{t(`desc.${tool.id}`, { defaultValue: '' })}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => togglePin(tool.id)}
                    aria-pressed={isPinned}
                    aria-label={isPinned ? 'Unpin tool' : 'Pin tool'}
                    className="btn btn-ghost btn-sm absolute end-3 top-3 h-8 w-8 p-0 opacity-60 hover:opacity-100"
                  >
                    <Pin className={isPinned ? 'h-4 w-4 fill-current text-accent' : 'h-4 w-4'} />
                  </button>
                </motion.div>
              );
            })}
          </div>
        )}

        <section className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="glass rounded-card p-5">
            <h2 className="mb-3 font-semibold">{t('home.recent')}</h2>
            {recents.length === 0 ? (
              <EmptyState icon={<FileText className="h-6 w-6" />} title={t('home.empty_recent')} />
            ) : (
              <ul className="divide-y divide-line">
                {recents.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2.5">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-start"
                      onClick={() => void openRecent(r.id, r.name)}
                    >
                      <span className="block truncate text-sm font-medium">{r.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {formatBytes(r.size)} · {r.pages} p · {formatDate(r.openedAt)}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm h-8 w-8 p-0"
                      aria-label={r.favorite ? 'Remove from favourites' : 'Add to favourites'}
                      aria-pressed={r.favorite}
                      onClick={() => updateRecent(r.id, { favorite: !r.favorite })}
                    >
                      <Star className={r.favorite ? 'h-4 w-4 fill-current text-amber-500' : 'h-4 w-4'} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm h-8 w-8 p-0"
                      aria-label="Remove from recent files"
                      onClick={() => removeRecent(r.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Dropzone
            compact
            multiple
            accept="application/pdf,.pdf"
            title={t('common.drop_hint')}
            hint={t('home.open_hint')}
            onFiles={(files) => {
              setPending(files);
              navigate('viewer');
            }}
          />
        </section>
      </section>
    </div>
  );
}
