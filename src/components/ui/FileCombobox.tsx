import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Paperclip, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// ============================================================================
// 054 (2026-08-21): Such-Combobox für Profil-Dateien im Mail-Dialog (Option A).
// Ersetzt den Button-Wust (flex-wrap) — ein Feld mit Live-Suche, Auswahl als
// Chips. Skaliert unbegrenzt (5 oder 50 Dateien = identisches Layout).
// Design-Konventionen: primary-dark, border-white/5, rounded-xl, font-display.
// Dropdown via createPortal → document.body: der Dialog hat overflow-hidden
// (Dialog.tsx Z. 53), sonst wird das Dropdown am Dialog-Rand abgeschnitten.
// ============================================================================

interface ProfileFile {
  name: string;
  size: number;
}

interface FileComboboxProps {
  files: ProfileFile[];
  attachedNames: string[];
  loadingName: string | null;
  onSelect: (name: string, size: number) => void;
  disabled?: boolean;
}

export const FileCombobox = ({
  files,
  attachedNames,
  loadingName,
  onSelect,
  disabled,
}: FileComboboxProps) => {
  const { t } = useTranslation(['admin', 'common']);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Außen-Klick schließt (Szenario 8)
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Esc schließt + leert Eingabe (Szenario 8)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setQuery('');
        inputRef.current?.blur();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const attachedSet = new Set(attachedNames);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? files.filter((f) => f.name.toLowerCase().includes(q))
    : files;

  // Portal-Position: Dropdown am Trigger-Button verankern (fixed im Viewport),
  // damit overflow-hidden des Dialogs (Dialog.tsx Z. 53) es nicht abschneidet.
  const [anchorRect, setAnchorRect] = useState<{ top: number; left: number; width: number } | null>(null);
  useEffect(() => {
    if (open && rootRef.current) {
      const r = rootRef.current.getBoundingClientRect();
      setAnchorRect({ top: r.bottom, left: r.left, width: r.width });
    }
    if (!open) setAnchorRect(null);
  }, [open]);

  const handlePick = (f: ProfileFile) => {
    if (attachedSet.has(f.name)) return; // Doppel-Anhang blockiert (Szenario 5)
    onSelect(f.name, f.size);
    setOpen(false);
    setQuery('');
  };

  const dropdown = open && anchorRect && (
    <div
      className="fixed z-[200] mt-1.5 rounded-xl border border-white/10 bg-primary-dark shadow-2xl overflow-hidden"
      style={{ top: anchorRect.top, left: anchorRect.left, width: anchorRect.width }}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
        <Search size={12} className="text-slate-500 shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('admin:mail.search_files')}
          className="w-full bg-transparent text-xs text-white placeholder:text-slate-500 outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="text-slate-500 hover:text-white transition-colors cursor-pointer shrink-0"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className="max-h-48 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <p className="px-3 py-2 text-xs text-slate-500">
            {t('admin:mail.no_files_found')}
          </p>
        ) : (
          filtered.map((f) => {
            const isAttached = attachedSet.has(f.name);
            const isLoading = loadingName === f.name;
            return (
              <button
                key={f.name}
                type="button"
                disabled={isAttached || isLoading}
                onClick={() => handlePick(f)}
                className={`w-full px-3 py-1.5 text-left text-xs font-bold border-b border-white/5 last:border-0 flex items-center gap-2 transition-all ${
                  isAttached
                    ? 'bg-emerald-500/10 text-emerald-400 cursor-not-allowed'
                    : isLoading
                      ? 'bg-primary-dark/50 text-slate-500 cursor-wait animate-pulse'
                      : 'text-slate-300 hover:text-white hover:bg-primary-dark/60 cursor-pointer'
                }`}
              >
                <Paperclip size={11} className={isAttached ? 'text-emerald-400' : 'text-slate-500'} />
                <span className="truncate flex-1">{f.name}</span>
                <span className="text-[9px] font-mono text-slate-500 shrink-0">
                  {(f.size / 1024).toFixed(1)} KB
                </span>
                {isAttached && (
                  <span className="text-[9px] uppercase font-black text-emerald-400 shrink-0">
                    {t('admin:mail.attached_badge')}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div ref={rootRef} className="relative">
      {/* Feld „Datei hinzufügen…“ (Szenario 2) */}
      <button
        type="button"
        disabled={disabled || files.length === 0}
        onClick={() => {
          setOpen((v) => !v);
          if (!open) setTimeout(() => inputRef.current?.focus(), 10);
        }}
        className="w-full px-3 py-2 rounded-xl text-xs font-bold border border-white/5 bg-primary-dark/40 text-slate-300 hover:text-white hover:border-white/10 hover:bg-primary-dark transition-all flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Search size={12} className="text-slate-500" />
        <span className="truncate">
          {files.length === 0
            ? t('admin:mail.no_profile_files')
            : t('admin:mail.add_from_profile_manager')}
        </span>
        <span className="ml-auto text-[9px] font-mono text-slate-500">
          {files.length > 0 ? `${filtered.length}/${files.length}` : ''}
        </span>
      </button>

      {/* Dropdown im Portal (nicht vom Dialog-Overflow abschneidbar) */}
      {open && createPortal(dropdown, document.body)}
    </div>
  );
};
