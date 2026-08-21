// Auftrag 012 P0-1: Admin-Tab „Skills“ — Vault-Skills auflisten, ansehen und löschen.
// Auftrag 013 P2-E: + Export (Markdown-Download) + Pinning (Frontmatter-Flag).
// Read-only-Liste (listVaultSkills) + Löschen (deleteVaultSkill, nur _louis/skills/).
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Trash2, RefreshCw, ChevronDown, ChevronUp, Tag, Download, Pin, PinOff } from 'lucide-react';
import { trpc } from '../../lib/trpc';

interface VaultSkill {
  path: string;
  name: string;
  description: string;
  content: string;
  tags: string[];
  version: number;
  pinned?: boolean;
  // Auftrag 026 P1-1 (Parität #30/#29): Usage-Zähler + Curator-Status
  useCount?: number;
  viewCount?: number;
  patchCount?: number;
  status?: "active" | "inactive" | "archived";
  lastUsedAtUtc?: string | null;
}

export function SkillsTab() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const { data: skills = [], isLoading, refetch } = trpc.listVaultSkills.useQuery();
  const deleteSkill = trpc.deleteVaultSkill.useMutation({
    onSuccess: () => {
      utils.listVaultSkills.invalidate();
    }
  });
  const togglePin = trpc.toggleSkillPin.useMutation({
    onSuccess: () => {
      utils.listVaultSkills.invalidate();
    }
  });

  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  // Auftrag 013 P2-E: Export als Markdown-Download (Inhalt liegt bereits im Frontend vor)
  const exportSkill = (skill: VaultSkill) => {
    const md = `---\ntags: [louis-skill]\nname: ${skill.name}\ndescription: ${skill.description}\nversion: ${skill.version}\n${skill.pinned ? "pinned: true\n" : ""}---\n\n${skill.content}\n`;
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${skill.name.replace(/[^a-zA-Z0-9_]/g, "_")}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 font-sans">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-accent-orange/10 rounded-xl border border-accent-orange/20">
            <BookOpen size={20} className="text-accent-orange" />
          </div>
          <div>
            <h3 className="text-lg font-black text-white font-display uppercase tracking-wider">
              {t('admin:skills.tab_title', { defaultValue: 'Wissens-Skills' })}
            </h3>
            <p className="text-xs text-slate-500">
              {t('admin:skills.tab_desc', { defaultValue: 'Skills aus dem Vault (_louis/skills/), die Louis automatisch in seine Antworten einbezieht.' })}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="p-2 bg-primary-dark border border-white/10 rounded-xl text-slate-400 hover:text-white transition-all cursor-pointer"
          title={t('admin:skills.refresh', { defaultValue: 'Aktualisieren' })}
        >
          <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-slate-500 text-sm">
          {t('admin:skills.loading', { defaultValue: 'Lade Skills…' })}
        </div>
      ) : skills.length === 0 ? (
        <div className="p-8 text-center bg-primary-dark/30 border border-white/5 rounded-2xl">
          <p className="text-xs text-slate-500 font-mono italic">
            {t('admin:skills.empty', { defaultValue: 'Keine Wissens-Skills vorhanden. Louis kann über save_skill neue Skills anlegen (mit Freigabe).' })}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {skills.map((skill: VaultSkill) => {
            const isExpanded = expanded === skill.path;
            const isConfirming = confirming === skill.path;
            return (
              <div key={skill.path} className="bg-primary-dark/80 border border-white/5 p-4 rounded-2xl hover:border-accent-orange/20 transition-all">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-white truncate">{skill.name}</span>
                      <span className="text-[10px] font-mono bg-accent-orange/10 border border-accent-orange/20 text-accent-orange px-1.5 py-0.5 rounded-full">
                        v{skill.version}
                      </span>
                      {/* Auftrag 013 P2-E: Pinned-Badge */}
                      {skill.pinned && (
                        <span className="text-[10px] font-mono bg-accent-blue/10 border border-accent-blue/30 text-accent-blue px-1.5 py-0.5 rounded-full">
                          {t('admin:skills.pinned', { defaultValue: '📌 gepinnt' })}
                        </span>
                      )}
                      {/* Auftrag 026 P1-1 (#29): Curator-Status-Badge */}
                      {skill.status === "inactive" && (
                        <span className="text-[10px] font-mono bg-amber-500/10 border border-amber-500/30 text-amber-400 px-1.5 py-0.5 rounded-full">
                          {t('admin:skills.status_inactive', { defaultValue: '💤 inaktiv' })}
                        </span>
                      )}
                      {skill.status === "archived" && (
                        <span className="text-[10px] font-mono bg-slate-500/20 border border-slate-500/40 text-slate-400 px-1.5 py-0.5 rounded-full">
                          {t('admin:skills.status_archived', { defaultValue: '🗄️ archiviert' })}
                        </span>
                      )}
                      {/* Auftrag 026 P1-1 (#30): Usage-Zähler + letzte Aktivität */}
                      <span className="text-[10px] font-mono bg-slate-500/10 border border-white/5 text-slate-400 px-1.5 py-0.5 rounded-full" title={t('admin:skills.usage_title', { defaultValue: 'view = Injektionen (24h-Cooldown), use = vault_read auf die Datei, patch = update_skill-Freigaben' })}>
                        👁 {skill.viewCount ?? 0} · 🔧 {skill.useCount ?? 0} · ✏️ {skill.patchCount ?? 0}
                      </span>
                      {skill.lastUsedAtUtc && (
                        <span className="text-[10px] font-mono bg-slate-500/10 border border-white/5 text-slate-500 px-1.5 py-0.5 rounded-full">
                          🕒 {skill.lastUsedAtUtc.slice(0, 10)}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{skill.description}</p>
                    <div className="flex items-center gap-1.5 flex-wrap mt-2">
                      <Tag size={10} className="text-slate-500" />
                      {(skill.tags || []).length > 0 ? (
                        skill.tags.slice(0, 4).map((tag) => (
                          <span key={tag} className="text-[10px] font-mono bg-slate-500/10 border border-white/5 text-slate-400 px-1.5 py-0.5 rounded-full">
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-slate-600 italic">
                          {t('admin:skills.no_tags', { defaultValue: 'keine Tags' })}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-600 font-mono mt-2">{skill.path}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {isConfirming ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            deleteSkill.mutate({ path: skill.path });
                            setConfirming(null);
                          }}
                          disabled={deleteSkill.isPending}
                          className="p-1.5 px-2.5 bg-rose-500/15 hover:bg-rose-500/30 text-rose-400 border border-rose-500/20 rounded-lg text-[10px] font-black uppercase tracking-wider cursor-pointer"
                        >
                          {t('admin:skills.confirm_delete', { defaultValue: 'Löschen?' })}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirming(null)}
                          className="p-1.5 px-2 border border-white/5 text-slate-400 hover:text-white rounded-lg text-[10px] font-black uppercase tracking-wider cursor-pointer"
                        >
                          {t('admin:skills.cancel', { defaultValue: 'Abbrechen' })}
                        </button>
                      </>
                    ) : (
                      <>
                        {/* Auftrag 013 P2-E: Export (Markdown-Download) */}
                        <button
                          type="button"
                          onClick={() => exportSkill(skill)}
                          className="p-1.5 bg-primary-dark border border-white/5 text-slate-400 hover:text-accent-blue rounded-lg cursor-pointer"
                          title={t('admin:skills.export', { defaultValue: 'Skill exportieren (Markdown)' })}
                        >
                          <Download size={13} />
                        </button>
                        {/* Auftrag 013 P2-E: Pin/Unpin */}
                        <button
                          type="button"
                          onClick={() => togglePin.mutate({ path: skill.path, pinned: !skill.pinned })}
                          disabled={togglePin.isPending}
                          className={`p-1.5 bg-primary-dark border rounded-lg cursor-pointer ${skill.pinned ? "border-accent-blue/40 text-accent-blue" : "border-white/5 text-slate-400 hover:text-accent-blue"}`}
                          title={skill.pinned ? t('admin:skills.unpin', { defaultValue: 'Skill entpinnen' }) : t('admin:skills.pin', { defaultValue: 'Skill pinnen (immer einbeziehen)' })}
                        >
                          {skill.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirming(skill.path)}
                          className="p-1.5 bg-primary-dark border border-white/5 text-slate-400 hover:text-rose-400 rounded-lg cursor-pointer"
                          title={t('admin:skills.delete', { defaultValue: 'Skill löschen' })}
                        >
                          <Trash2 size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setExpanded(isExpanded ? null : skill.path)}
                          className="p-1.5 bg-primary-dark border border-white/5 text-slate-400 hover:text-white rounded-lg cursor-pointer"
                          title={t('admin:skills.toggle_content', { defaultValue: 'Inhalt anzeigen' })}
                        >
                          {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {isExpanded && (
                  <pre className="mt-3 p-3 bg-[#0d1527] border border-white/5 rounded-xl text-[10px] text-slate-300 font-mono whitespace-pre-wrap max-h-56 overflow-y-auto">
                    {skill.content || skill.description}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
