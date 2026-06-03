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

  const totalItems = logs.length;
  const totalPages = Math.ceil(totalItems / pageSize) || 1;

  // Auto-clamp current page if total pages decreases or changes
  React.useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage]);

  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const paginatedLogs = logs.slice(startIndex, endIndex);

  return (
    <div className="bg-primary-dark/40 border border-white/5 rounded-xl overflow-hidden shadow-2xl">
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
          <span>{i18n.language === 'de' ? 'Einträge pro Seite:' : 'Entries per page:'}</span>
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
            title={i18n.language === 'de' ? 'Erste Seite' : 'First page'}
          >
            &lt;&lt;
          </button>
          <button
            id="audit-log-prev-btn"
            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            disabled={currentPage === 1}
            className="p-1 px-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 disabled:opacity-30 disabled:pointer-events-none border border-white/5 hover:border-white/10 transition-all font-mono text-xs cursor-pointer"
            title={i18n.language === 'de' ? 'Vorherige Seite' : 'Previous page'}
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
            title={i18n.language === 'de' ? 'Nächste Seite' : 'Next page'}
          >
            &gt;
          </button>
          <button
            id="audit-log-last-btn"
            onClick={() => setCurrentPage(totalPages)}
            disabled={currentPage === totalPages}
            className="p-1 px-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 disabled:opacity-30 disabled:pointer-events-none border border-white/5 hover:border-white/10 transition-all font-mono text-xs cursor-pointer"
            title={i18n.language === 'de' ? 'Letzte Seite' : 'Last page'}
          >
            &gt;&gt;
          </button>
        </div>
      </div>
    </div>
  );
};

