import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { AuditLogEvent } from '../../types';

interface AuditLogTableProps {
  logs: AuditLogEvent[];
}

export const AuditLogTable = ({ logs }: AuditLogTableProps) => {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);

  // Filter (Entscheidung 2026-08-16: Audit-Log filterbar + exportierbar)
  const [filterType, setFilterType] = React.useState('');
  const [filterActor, setFilterActor] = React.useState('');
  const [filterEntity, setFilterEntity] = React.useState('');
  const [filterText, setFilterText] = React.useState('');

  const filteredLogs = React.useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return logs.filter((log) => {
      if (filterType && log.event_type !== filterType) return false;
      if (filterActor && !(log.actor_identity || '').toLowerCase().includes(filterActor.toLowerCase())) return false;
      if (filterEntity && !(log.entity_type || '').toLowerCase().includes(filterEntity.toLowerCase())) return false;
      if (q && !((log.event_details || '') + ' ' + (log.entity_type || '')).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [logs, filterType, filterActor, filterEntity, filterText]);

  const totalItems = filteredLogs.length;
  const totalPages = Math.ceil(totalItems / pageSize) || 1;

  // Auto-clamp current page if total pages decreases or changes
  React.useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const paginatedLogs = filteredLogs.slice(startIndex, endIndex);

  // CSV-Export (alle gefilterten Einträge)
  const handleExportCsv = () => {
    const header = [
      t('admin:audit_table.time'),
      t('admin:audit_table.type'),
      t('admin:audit_table.entity'),
      t('admin:audit_table.details'),
      t('admin:audit_table.actor')
    ];
    const rows = filteredLogs.map((log) => [
      new Date(log.created_at_utc).toISOString(),
      log.event_type,
      log.entity_type,
      (log.event_details || '').replace(/"/g, '""'),
      log.actor_identity
    ]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetFilters = () => {
    setFilterType('');
    setFilterActor('');
    setFilterEntity('');
    setFilterText('');
    setCurrentPage(1);
  };

  return (
    <div className="bg-primary-dark/40 border border-white/5 rounded-xl overflow-hidden shadow-2xl">
      {/* Filter-Leiste */}
      <div className="flex flex-wrap items-center gap-2 px-6 py-3 bg-white/[0.02] border-b border-white/5">
        <select
          id="audit-log-filter-type"
          value={filterType}
          onChange={(e) => { setFilterType(e.target.value); setCurrentPage(1); }}
          className="bg-primary-dark/80 border border-white/10 px-2.5 py-1.5 rounded-lg text-slate-200 focus:outline-none focus:border-accent-orange/50 text-xs font-mono cursor-pointer"
        >
          <option value="">Alle Typen</option>
          {[...new Set(logs.map((l) => l.event_type))].sort().map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input
          id="audit-log-filter-actor"
          value={filterActor}
          onChange={(e) => { setFilterActor(e.target.value); setCurrentPage(1); }}
          placeholder="Actor (z. B. mcp_client)"
          className="bg-primary-dark/80 border border-white/10 px-2.5 py-1.5 rounded-lg text-slate-200 focus:outline-none focus:border-accent-orange/50 text-xs font-mono placeholder-slate-600"
        />
        <input
          id="audit-log-filter-entity"
          value={filterEntity}
          onChange={(e) => { setFilterEntity(e.target.value); setCurrentPage(1); }}
          placeholder={t('admin:audit_table.filter_entity_placeholder')}
          className="bg-primary-dark/80 border border-white/10 px-2.5 py-1.5 rounded-lg text-slate-200 focus:outline-none focus:border-accent-orange/50 text-xs font-mono placeholder-slate-600"
        />
        <input
          id="audit-log-filter-text"
          value={filterText}
          onChange={(e) => { setFilterText(e.target.value); setCurrentPage(1); }}
          placeholder="Volltextsuche…"
          className="bg-primary-dark/80 border border-white/10 px-2.5 py-1.5 rounded-lg text-slate-200 focus:outline-none focus:border-accent-orange/50 text-xs font-mono placeholder-slate-600 flex-1 min-w-[160px]"
        />
        <button
          id="audit-log-export-btn"
          onClick={handleExportCsv}
          className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 text-xs font-bold transition-all cursor-pointer"
        >
          ⬇ CSV-Export ({totalItems})
        </button>
        {(filterType || filterActor || filterEntity || filterText) && (
          <button
            id="audit-log-reset-btn"
            onClick={resetFilters}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold transition-all cursor-pointer"
          >
            ✕ Filter zurücksetzen
          </button>
        )}
      </div>

      <table className="w-full text-left border-collapse">
        <thead className="bg-white/5 shadow-inner">
          <tr>
            <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest font-display">{t('admin:audit_table.time')}</th>
            <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest font-display">{t('admin:audit_table.type')}</th>
            <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest font-display">{t('admin:audit_table.entity')}</th>
            <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest font-display">{t('admin:audit_table.details')}</th>
            <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest font-display">{t('admin:audit_table.actor')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {paginatedLogs.length > 0 ? paginatedLogs.map((log: AuditLogEvent) => (
            <tr key={log.id_uuid} className="hover:bg-white/5 transition-colors group">
              <td className="px-6 py-4 text-[11px] font-mono text-slate-400">
                {new Date(log.created_at_utc).toLocaleTimeString(i18n.language || 'de')}
              </td>
              <td className="px-6 py-4">
                <span className={cn(
                  "px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-tighter",
                  log.event_type === 'CREATE' ? "bg-green-500/10 text-green-500" :
                  log.event_type === 'UPDATE' ? "bg-accent-blue/10 text-accent-blue" :
                  "bg-accent-orange/10 text-accent-orange"
                )}>
                  {log.event_type}
                </span>
              </td>
              <td className="px-6 py-4 text-[10px] font-bold text-slate-300 uppercase">{log.entity_type}</td>
              <td className="px-6 py-4 text-xs text-slate-400 group-hover:text-slate-300 transition-colors italic">{log.event_details}</td>
              <td className="px-6 py-4 text-[10px] font-mono text-slate-500">{log.actor_identity}</td>
            </tr>
          )) : (
            <tr>
              <td colSpan={5} className="px-6 py-20 text-center text-slate-600 italic text-sm">{t('admin:audit_table.empty')}</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Pagination Controls */}
      <div 
        id="audit-log-pagination-container"
        className="flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-4 bg-white/[0.02] border-t border-white/5"
      >
        {/* Left: Entries Status */}
        <div className="text-xs font-mono text-slate-400">
          {t('common:pagination_entries', { 
            from: totalItems === 0 ? 0 : startIndex + 1, 
            to: endIndex, 
            count: totalItems 
          })}
        </div>

        {/* Center: Entries per page */}
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>{t('common:pagination_entries_per_page', { defaultValue: 'Einträge pro Seite:' })}</span>
          <select
            id="audit-log-page-size-select"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setCurrentPage(1);
            }}
            className="bg-primary-dark/80 border border-white/10 px-2.5 py-1 rounded-lg text-slate-200 focus:outline-none focus:border-accent-orange/50 text-xs font-mono cursor-pointer"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
        </div>

        {/* Right: Page Navigation buttons */}
        <div className="flex items-center gap-1.5">
          <button
            id="audit-log-first-btn"
            onClick={() => setCurrentPage(1)}
            disabled={currentPage === 1}
            className="p-1 px-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 disabled:opacity-30 disabled:pointer-events-none border border-white/5 hover:border-white/10 transition-all font-mono text-xs cursor-pointer"
            title={t('common:pagination_first_page', { defaultValue: 'Erste Seite' })}
          >
            &lt;&lt;
          </button>
          <button
            id="audit-log-prev-btn"
            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
            className="p-1 px-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 disabled:opacity-30 disabled:pointer-events-none border border-white/5 hover:border-white/10 transition-all font-mono text-xs cursor-pointer"
            title={t('common:pagination_prev_page', { defaultValue: 'Vorherige Seite' })}
          >
            &lt;
          </button>
          <span className="text-xs font-mono text-slate-400 px-2 min-w-[50px] text-center">
            {currentPage} / {totalPages}
          </span>
          <button
            id="audit-log-next-btn"
            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={currentPage === totalPages}
            className="p-1 px-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 disabled:opacity-30 disabled:pointer-events-none border border-white/5 hover:border-white/10 transition-all font-mono text-xs cursor-pointer"
            title={t('common:pagination_next_page', { defaultValue: 'Nächste Seite' })}
          >
            &gt;
          </button>
          <button
            id="audit-log-last-btn"
            onClick={() => setCurrentPage(totalPages)}
            disabled={currentPage === totalPages}
            className="p-1 px-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 disabled:opacity-30 disabled:pointer-events-none border border-white/5 hover:border-white/10 transition-all font-mono text-xs cursor-pointer"
            title={t('common:pagination_last_page', { defaultValue: 'Letzte Seite' })}
          >
            &gt;&gt;
          </button>
        </div>
      </div>
    </div>
  );
};

