import React, { useState } from 'react';
import { motion } from 'motion/react';
import { 
  Shield, 
  Users, 
  Settings, 
  Activity, 
  User, 
  Bell,
  Database,
  ShieldCheck,
  Building2,
  Link,
  FileText,
  FileSpreadsheet,
  Brain,
  Cpu,
  Mail,
  Server,
  Signature,
  List,
  Send,
  Mic,
  Sparkles,
  Clock,
  HelpCircle,
  BookOpen,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import { trpc } from '../lib/trpc';

import { AuditLogTable } from '../components/admin/AuditLogTable';
import { ConnectionsTab } from '../components/admin/ConnectionsTab';
import { MyCompanyForm } from '../components/admin/MyCompanyForm';
import { ProfileTab } from '../components/admin/ProfileTab';
import { UsersTab } from '../components/admin/UsersTab';
import { SystemSettingsTab } from '../components/admin/SystemSettingsTab';
import { TemplatesTab } from '../components/admin/TemplatesTab';
import { DataPortabilityTab } from '../components/admin/DataPortabilityTab';
import { LouisAiSettingsForm } from '../components/admin/LouisAiSettingsForm';
import { LouisAiMemoryForm } from '../components/admin/LouisAiMemoryForm';
import { LouisAiWorkflowsTab } from '../components/admin/LouisAiWorkflowsTab';
import { LicensesTab } from '../components/admin/LicensesTab';
import { CouncilSettingsTab } from '../components/admin/CouncilSettingsTab';
import { AgentJobsTab } from '../components/admin/AgentJobsTab';
import { GovernanceRulesTab } from '../components/admin/GovernanceRulesTab';
import { AiQuestionsTab } from '../components/admin/AiQuestionsTab';
import { TokenUsageTab } from '../components/admin/TokenUsageTab';
import { SkillsTab } from '../components/admin/SkillsTab';

export const Admin = ({ timezone, setTimezone }: { timezone: string, setTimezone: (tz: string) => void }) => {
  const { t } = useTranslation();
  const [activeSubTab, setActiveSubTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const sub = params.get('subtab');
    if (sub === 'connections' || sub === 'mcp' || params.get('oauth') === 'success') {
      return 'connections';
    }
    return sub || 'profile';
  });

  // Fetch session to authorize view access
  const { data: sessionData, isLoading: isSessionLoading } = trpc.getSession.useQuery();

  // Fetch live system status
  const { data: systemStatus } = trpc.getSystemStatus.useQuery(undefined, {
    enabled: sessionData?.user?.role === 'admin'
  });

  // Audit Logs
  const { data: auditLogs = [] } = trpc.getAuditLogs.useQuery(undefined, {
    enabled: activeSubTab === 'logs' && sessionData?.user?.role === 'admin'
  });

  if (isSessionLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent-orange"></div>
      </div>
    );
  }

  if (sessionData?.user?.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-8 bg-primary-light/30 border border-white/5 rounded-2xl max-w-lg mx-auto my-12 shadow-2xl">
        <div className="p-5 bg-red-500/10 rounded-full border border-red-500/20 text-red-500 mb-6 shadow-inner animate-pulse">
          <Shield size={48} />
        </div>
        <h3 className="text-xl font-black text-white uppercase tracking-wider font-display mb-2">
          {t('common.restricted_module', { defaultValue: 'Zugriff eingeschränkt' })}
        </h3>
        <p className="text-slate-400 text-sm tracking-wide font-medium">
          {t('admin.access_denied', { defaultValue: 'Zutritt verweigert: Nur Administratoren haben Zugriff auf diese Ansicht.' })}
        </p>
      </div>
    );
  }

  const stats = [
    {
      id: 'db',
      label: t('admin.status_db', { defaultValue: 'Status Datenbank' }),
      value: systemStatus?.dbStatusText || 'Verbinde...',
      icon: Database,
      colorClass: systemStatus?.dbConnected ? 'text-green-400' : 'text-accent-orange'
    },
    {
      id: 'ai',
      label: t('admin.status_ai_conn', { defaultValue: 'Status KI-Anbindung' }),
      value: systemStatus?.aiStatusText || t('common.system_status_card.checking', { defaultValue: 'Prüfe...' }),
      icon: Brain,
      colorClass: systemStatus?.aiStatusText && systemStatus.aiStatusText.includes('Bereit') ? 'text-green-400' : 'text-accent-orange'
    },
    {
      id: 'mail',
      label: t('admin.status_email_dispatch', { defaultValue: 'Status E-Mail Versand' }),
      value: systemStatus?.emailStatusText || 'Lade...',
      icon: Mail,
      colorClass: systemStatus?.emailStatusText && systemStatus.emailStatusText.includes('Bereit') ? 'text-green-400' : 'text-slate-500'
    },
    {
      id: 'size',
      label: t('admin.status_db_sizes', { defaultValue: 'Status Datenbankgrössen' }),
      value: systemStatus?.dbSizeText || 'Berechne...',
      icon: Server,
      colorClass: 'text-accent-blue'
    },
  ];

  const adminTabs = [
    { id: 'profile', label: t('admin.tabs.profile', { defaultValue: 'Admin-Profil' }), icon: User },
    { id: 'users', label: t('admin.tabs.users', { defaultValue: 'Benutzerverwaltung' }), icon: Users },
    { id: 'my_company', label: t('admin.tabs.my_company', { defaultValue: 'Mein Unternehmen' }), icon: Building2 },
    { 
      id: 'louis_config', 
      label: t('admin.ai_settings.title', { defaultValue: 'LOUIS AI Config' }), 
      icon: Brain,
      subItems: [
        { id: 'louis_config', label: t('admin.ai_settings.title', { defaultValue: 'Provider & RAG' }), icon: Brain },
        { id: 'louis_memory', label: t('admin.ai_settings.memory_db_label', { defaultValue: 'Gedächtnis & Wissen' }), icon: Database },
        { id: 'council_settings', label: t('admin.council_settings.tab_label', { defaultValue: 'LLM Council Config' }), icon: Users },
        { id: 'louis_jobs', label: t('admin.ai_settings.jobs_label', { defaultValue: 'Agent-Jobs' }), icon: Clock },
        { id: 'louis_governance', label: t('admin.ai_settings.governance_label', { defaultValue: 'Governance-Regeln' }), icon: ShieldCheck },
        { id: 'louis_questions', label: t('admin.ai_settings.questions_label', { defaultValue: 'Rückfragen' }), icon: HelpCircle },
        { id: 'louis_token_usage', label: t('admin.ai_settings.token_usage_label', { defaultValue: 'Token-Verbrauch' }), icon: Activity },
        { id: 'louis_skills', label: t('admin.skills.tab_label', { defaultValue: 'Wissens-Skills' }), icon: BookOpen }
      ]
    },
    { id: 'louis_workflows', label: t('admin.workflows_tab.title', { defaultValue: 'LOUIS AI Workflows' }), icon: Cpu },
    { 
      id: 'notifications', 
      label: t('admin.tabs.notifications', { defaultValue: 'Vorlagen' }), 
      icon: FileText,
      subItems: [
        { id: 'tpl_templates', label: t('admin.templates.tab_templates', { defaultValue: 'E-Mail-Vorlagen' }), icon: FileText },
        { id: 'tpl_signatures', label: t('admin.templates.tab_signatures', { defaultValue: 'Signaturen' }), icon: Signature },
        { id: 'tpl_invoice_texts', label: t('admin.templates.tab_invoice_texts', { defaultValue: 'Rechnungstexte' }), icon: FileText },
        { id: 'tpl_invoice_items', label: t('admin.templates.tab_invoice_items', { defaultValue: 'Angebots- & Rechnungsposten' }), icon: List },
        { id: 'tpl_offer_texts', label: t('admin.templates.tab_offer_texts', { defaultValue: 'Angebotstexte' }), icon: FileSpreadsheet }
      ]
    },
    { 
      id: 'settings', 
      label: t('common.system_settings', { defaultValue: 'Systemeinstellungen' }), 
      icon: Settings,
      subItems: [
        { id: 'settings', label: t('common.system_settings', { defaultValue: 'Systemeinstellungen' }), icon: Settings },
        { id: 'data_portability', label: t('admin.tabs.data_portability', { defaultValue: 'Massenimport / -export' }), icon: FileSpreadsheet },
        { id: 'connections', label: t('admin.tabs.connections', { defaultValue: 'Verbindungen' }), icon: Link }
      ]
    },
    { id: 'logs', label: t('admin.tabs.logs', { defaultValue: 'Audit-Protokolle' }), icon: Activity },
    { id: 'licenses', label: t('admin.tabs.licenses', { defaultValue: 'Lizenzen & Credits' }), icon: ShieldCheck },
  ];

  return (
    <div className="space-y-8 sm:space-y-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 sm:gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-1.5 bg-accent-blue/10 rounded-sm">
              <ShieldCheck className="text-accent-blue" size={20} />
            </div>
            <h2 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.4em] font-display">
              {t('admin.intelligence', { defaultValue: 'System-Intelligenz' })}
            </h2>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white font-display uppercase italic tracking-[0.05em] leading-none">
            {t('admin.title', { defaultValue: 'Admin Panel' })}
          </h1>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {stats.map((stat, idx) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="bg-primary-light/50 border border-white/5 p-4 sm:p-6 rounded-xl flex items-center gap-4 hover:border-accent-orange/20 transition-all shadow-xl min-w-0"
          >
            <div className={cn("p-3 sm:p-4 bg-primary-dark/80 rounded-xl border border-white/5 shadow-inner shrink-0", stat.colorClass)}>
              <stat.icon size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-black text-slate-600 uppercase tracking-[0.2em] font-display italic mb-1 truncate" title={stat.label}>
                {stat.label}
              </p>
              <p className={cn("font-black tracking-tight leading-snug truncate", 
                stat.value.length > 22 ? "text-[11px] text-white/95" : "text-sm sm:text-base text-white"
              )} title={stat.value}>
                {stat.value}
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Integration Status Badges: Telegram, MCP, RAG, STT */}
      <div id="status-badges-integrations" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 -mt-4 sm:-mt-6">
        {[
          {
            id: 'telegram',
            label: t('common.system_status_card.status_telegram', { defaultValue: 'Status Telegram' }),
            value: systemStatus?.telegramStatusText || t('common.system_status_card.checking', { defaultValue: 'Prüfen...' }),
            connected: systemStatus?.telegramConnected ?? false,
            icon: Send,
          },
          {
            id: 'mcp',
            label: t('common.system_status_card.status_mcp', { defaultValue: 'Status MCP' }),
            value: systemStatus?.mcpStatusText || t('common.system_status_card.checking', { defaultValue: 'Prüfen...' }),
            connected: systemStatus?.mcpConnected ?? false,
            icon: Cpu,
          },
          {
            id: 'rag',
            label: t('common.system_status_card.status_rag', { defaultValue: 'Status RAG' }),
            value: systemStatus?.ragStatusText || t('common.system_status_card.checking', { defaultValue: 'Prüfen...' }),
            connected: systemStatus?.ragConnected ?? false,
            icon: Sparkles,
          },
          {
            id: 'stt',
            label: t('common.system_status_card.status_stt', { defaultValue: 'Status STT' }),
            value: systemStatus?.sttStatusText || t('common.system_status_card.disabled', { defaultValue: 'Deaktiviert' }),
            connected: systemStatus?.sttConnected ?? false,
            icon: Mic,
          },
        ].map((badge) => (
          <div
            key={badge.id}
            id={`status-badge-${badge.id}`}
            className="bg-primary-dark/80 border border-white/5 p-3.5 sm:p-4 rounded-xl flex items-center justify-between gap-2.5 sm:gap-3 shadow-lg hover:border-white/10 transition-all min-w-0"
          >
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
              <div className={cn(
                "p-2 sm:p-2.5 rounded-lg shrink-0 border",
                badge.connected 
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" 
                  : "bg-slate-500/10 text-slate-400 border-white/5"
              )}>
                <badge.icon size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest block font-display truncate" title={badge.label}>
                  {badge.label}
                </span>
                <span className="text-xs font-bold text-white truncate block" title={badge.value}>
                  {badge.value}
                </span>
              </div>
            </div>

            <span className={cn(
              "px-2 sm:px-2.5 py-1 rounded-full text-[9px] sm:text-[10px] font-black uppercase tracking-wider shrink-0 flex items-center gap-1.5 border font-display",
              badge.connected 
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" 
                : "bg-slate-500/10 text-slate-400 border-white/5"
            )}>
              <span className={cn(
                "w-1.5 h-1.5 rounded-full shrink-0", 
                badge.connected ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
              )} />
              {badge.connected ? t('common.active', { defaultValue: 'Aktiv' }) : t('common.inactive', { defaultValue: 'Inaktiv' })}
            </span>
          </div>
        ))}
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 lg:gap-8">
        {/* Sidebar Tabs */}
        <div className="lg:col-span-1">
          {/* Mobile / Tablet Horizontal Scrollable Tabs (< lg) */}
          <div className="flex lg:hidden overflow-x-auto gap-2 pb-3 custom-scrollbar border-b border-white/5 mb-4 -mx-2 px-2">
            {adminTabs.map((tab) => {
              const hasSubItems = 'subItems' in tab && tab.subItems;
              const isTabActive = activeSubTab === tab.id || (hasSubItems && tab.subItems.some(sub => sub.id === activeSubTab));
              
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    if (hasSubItems) {
                      setActiveSubTab(tab.subItems[0].id);
                    } else {
                      setActiveSubTab(tab.id);
                    }
                  }}
                  className={cn(
                    "flex items-center gap-2 px-3.5 py-2.5 rounded-xl font-black uppercase text-[10px] tracking-wider transition-all whitespace-nowrap shrink-0 font-display",
                    isTabActive
                      ? "bg-primary-light border border-white/10 text-white shadow-lg shadow-black/40"
                      : "bg-primary-dark/60 text-slate-400 hover:bg-primary-light/50 hover:text-white border border-white/5"
                  )}
                >
                  <tab.icon size={16} className={cn("shrink-0", isTabActive ? "text-accent-orange" : "")} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Sub-items horizontal bar for Mobile / Tablet (< lg) */}
          {(() => {
            const activeParentTab = adminTabs.find(
              tab => 'subItems' in tab && tab.subItems && (activeSubTab === tab.id || tab.subItems.some(sub => sub.id === activeSubTab))
            );
            if (!activeParentTab || !activeParentTab.subItems) return null;
            return (
              <div className="flex lg:hidden overflow-x-auto gap-1.5 pb-2 mb-4 pl-1 -mx-2 px-2">
                {activeParentTab.subItems.map((sub) => (
                  <button
                    key={sub.id}
                    onClick={() => setActiveSubTab(sub.id)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold uppercase text-[9px] tracking-wider transition-all whitespace-nowrap shrink-0 font-display",
                      activeSubTab === sub.id
                        ? "bg-accent-orange/20 text-accent-orange border border-accent-orange/30 shadow-sm"
                        : "bg-primary-dark/40 text-slate-400 hover:text-white border border-white/5"
                    )}
                  >
                    <sub.icon size={12} className="shrink-0" />
                    <span>{sub.label}</span>
                  </button>
                ))}
              </div>
            );
          })()}

          {/* Desktop Vertical Sidebar (lg:) */}
          <div className="hidden lg:flex lg:flex-col space-y-1.5">
            {adminTabs.map((tab) => {
              const hasSubItems = 'subItems' in tab && tab.subItems;
              const isTabActive = activeSubTab === tab.id || (hasSubItems && tab.subItems.some(sub => sub.id === activeSubTab));
              
              return (
                <div key={tab.id} className="space-y-1">
                  <button
                    onClick={() => {
                      if (hasSubItems) {
                        setActiveSubTab(tab.subItems[0].id);
                      } else {
                        setActiveSubTab(tab.id);
                      }
                    }}
                    className={cn(
                      "w-full flex items-center gap-3 px-3.5 py-3 rounded-xl font-black uppercase text-[10px] tracking-wider transition-all text-left font-display overflow-hidden",
                      isTabActive
                        ? "bg-primary-light border border-white/10 text-white shadow-xl shadow-black/40"
                        : "text-slate-500 hover:bg-primary-light/50 hover:text-slate-300"
                    )}
                  >
                    <tab.icon size={18} className={cn("shrink-0", isTabActive ? "text-accent-orange" : "")} />
                    <span className="whitespace-nowrap truncate">{tab.label}</span>
                  </button>
                  
                  {hasSubItems && isTabActive && (
                    <div className="pl-3.5 space-y-1 border-l border-white/5 ml-4 py-1">
                      {tab.subItems.map((sub) => (
                        <button
                          key={sub.id}
                          onClick={() => setActiveSubTab(sub.id)}
                          className={cn(
                            "w-full flex items-center gap-2 px-3 py-2 rounded-lg font-bold uppercase text-[9px] tracking-wider transition-all text-left font-display overflow-hidden",
                            activeSubTab === sub.id
                              ? "bg-accent-orange/15 text-accent-orange border border-accent-orange/20"
                              : "text-slate-500 hover:text-slate-300"
                          )}
                        >
                          <sub.icon size={12} className="shrink-0" />
                          <span className="whitespace-nowrap truncate">{sub.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Content Area */}
        <div className="lg:col-span-3">
          <div className="min-h-[400px] lg:h-[calc(100vh-220px)] overflow-y-auto custom-scrollbar pr-1 sm:pr-4 space-y-8 sm:space-y-12">
            {activeSubTab === 'profile' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-4 sm:p-8 lg:p-10 shadow-inner">
                <ProfileTab timezone={timezone} setTimezone={setTimezone} />
              </motion.div>
            )}

            {activeSubTab === 'users' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-4 sm:p-8 lg:p-10 shadow-inner">
                <UsersTab />
              </motion.div>
            )}

            {activeSubTab === 'settings' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-4 sm:p-8 lg:p-10 shadow-inner">
                <SystemSettingsTab />
              </motion.div>
            )}

            {activeSubTab === 'my_company' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-4 sm:p-8 lg:p-10 shadow-inner">
                <div className="flex items-center gap-4 sm:gap-6 mb-6 sm:mb-8">
                  <div className="p-3 sm:p-5 bg-accent-orange/10 rounded-2xl border border-accent-orange/20 shadow-lg shadow-accent-orange/10"><Building2 className="text-accent-orange" size={28} /></div>
                  <div>
                    <h3 className="text-2xl sm:text-4xl font-black text-white italic uppercase tracking-tighter font-display">{t('my_company.title')}</h3>
                    <p className="text-slate-500 text-xs font-bold italic opacity-70 tracking-wider font-display uppercase">{t('my_company.description')}</p>
                  </div>
                </div>
                <MyCompanyForm />
              </motion.div>
            )}

            {activeSubTab === 'connections' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-4 sm:p-8 lg:p-10 shadow-inner">
                <ConnectionsTab />
              </motion.div>
            )}

            {activeSubTab === 'logs' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-4 sm:p-8 lg:p-10 space-y-6 sm:space-y-8 shadow-inner">
                <div>
                  <h3 className="text-2xl sm:text-3xl font-black text-white mb-2 font-display uppercase italic tracking-tighter">{t('admin.tabs.logs', { defaultValue: 'Audit-Protokolle' })}</h3>
                  <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">{t('common.ai_audit', { defaultValue: 'AI Compliance Audit' })}</p>
                </div>
                <AuditLogTable logs={auditLogs} />
              </motion.div>
            )}

            {activeSubTab === 'notifications' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-4 sm:p-8 lg:p-10 shadow-inner">
                <TemplatesTab />
              </motion.div>
            )}

            {activeSubTab === 'tpl_templates' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-4 sm:p-8 lg:p-10 shadow-inner">
                <TemplatesTab initialSection="templates" />
              </motion.div>
            )}

            {activeSubTab === 'tpl_signatures' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-4 sm:p-8 lg:p-10 shadow-inner">
                <TemplatesTab initialSection="signatures" />
              </motion.div>
            )}

            {activeSubTab === 'tpl_invoice_texts' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-4 sm:p-8 lg:p-10 shadow-inner">
                <TemplatesTab initialSection="invoice_texts" />
              </motion.div>
            )}

            {activeSubTab === 'tpl_invoice_items' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-4 sm:p-8 lg:p-10 shadow-inner">
                <TemplatesTab initialSection="invoice_items" />
              </motion.div>
            )}

            {activeSubTab === 'tpl_offer_texts' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-4 sm:p-8 lg:p-10 shadow-inner">
                <TemplatesTab initialSection="offer_texts" />
              </motion.div>
            )}

            {activeSubTab === 'louis_config' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-4 sm:p-8 lg:p-10 shadow-inner">
                <LouisAiSettingsForm />
              </motion.div>
            )}

            {activeSubTab === 'louis_memory' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-4 sm:p-8 lg:p-10 shadow-inner font-sans">
                <LouisAiMemoryForm />
              </motion.div>
            )}

            {activeSubTab === 'council_settings' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-4 sm:p-6 shadow-inner font-sans">
                <CouncilSettingsTab />
              </motion.div>
            )}

            {activeSubTab === 'louis_workflows' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-4 sm:p-8 lg:p-10 shadow-inner">
                <LouisAiWorkflowsTab />
              </motion.div>
            )}

            {activeSubTab === 'louis_jobs' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-4 sm:p-8 lg:p-10 shadow-inner">
                <AgentJobsTab />
              </motion.div>
            )}

            {activeSubTab === 'louis_governance' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-4 sm:p-8 lg:p-10 shadow-inner">
                <GovernanceRulesTab />
              </motion.div>
            )}

            {activeSubTab === 'louis_questions' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-4 sm:p-8 lg:p-10 shadow-inner">
                <AiQuestionsTab />
              </motion.div>
            )}

            {activeSubTab === 'louis_token_usage' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-4 sm:p-8 lg:p-10 shadow-inner">
                <TokenUsageTab />
              </motion.div>
            )}

            {activeSubTab === 'louis_skills' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-4 sm:p-8 lg:p-10 shadow-inner">
                <SkillsTab />
              </motion.div>
            )}

            {activeSubTab === 'data_portability' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-4 sm:p-8 lg:p-10 shadow-inner">
                <DataPortabilityTab />
              </motion.div>
            )}

            {activeSubTab === 'licenses' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-4 sm:p-8 lg:p-10 shadow-inner">
                <LicensesTab />
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
