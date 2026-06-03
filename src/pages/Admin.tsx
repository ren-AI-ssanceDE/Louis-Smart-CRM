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
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import { trpc } from '../lib/trpc';

import { AuditLogTable } from '../components/admin/AuditLogTable';
import { ConnectionsTab } from '../components/admin/ConnectionsTab';
import { MyCompanyForm } from '../components/admin/MyCompanyForm';
import { ProfileTab } from '../components/admin/ProfileTab';
import { SystemSettingsTab } from '../components/admin/SystemSettingsTab';
import { TemplatesTab } from '../components/admin/TemplatesTab';
import { DataPortabilityTab } from '../components/admin/DataPortabilityTab';
import { LouisAiSettingsForm } from '../components/admin/LouisAiSettingsForm';
import { LouisAiWorkflowsTab } from '../components/admin/LouisAiWorkflowsTab';
import { LicensesTab } from '../components/admin/LicensesTab';

export const Admin = ({ timezone, setTimezone }: { timezone: string, setTimezone: (tz: string) => void }) => {
  const { t } = useTranslation(['admin', 'common']);
  const [activeSubTab, setActiveSubTab] = useState('profile');

  // Fetch live system status
  const { data: systemStatus } = trpc.getSystemStatus.useQuery();

  // Audit Logs
  const { data: auditLogs = [] } = trpc.getAuditLogs.useQuery(undefined, {
    enabled: activeSubTab === 'logs'
  });

  const stats = [
    {
      id: 'db',
      label: t('admin:status_db', { defaultValue: 'Status Datenbank' }),
      value: systemStatus?.dbStatusText || 'Verbinde...',
      icon: Database,
      colorClass: systemStatus?.dbConnected ? 'text-green-400' : 'text-accent-orange'
    },
    {
      id: 'ai',
      label: t('admin:status_ai_conn', { defaultValue: 'Status KI-Anbindung' }),
      value: systemStatus?.aiStatusText || 'Prüfe...',
      icon: Brain,
      colorClass: systemStatus?.aiStatusText && systemStatus.aiStatusText.includes('Bereit') ? 'text-green-400' : 'text-accent-orange'
    },
    {
      id: 'mail',
      label: t('admin:status_email_dispatch', { defaultValue: 'Status E-Mail Versand' }),
      value: systemStatus?.emailStatusText || 'Lade...',
      icon: Mail,
      colorClass: systemStatus?.emailStatusText && systemStatus.emailStatusText.includes('Bereit') ? 'text-green-400' : 'text-slate-500'
    },
    {
      id: 'size',
      label: t('admin:status_db_sizes', { defaultValue: 'Status Datenbankgrössen' }),
      value: systemStatus?.dbSizeText || 'Berechne...',
      icon: Server,
      colorClass: 'text-accent-blue'
    },
  ];

  const adminTabs = [
    { id: 'profile', label: t('tabs.profile'), icon: User },
    { id: 'settings', label: t('common:settings'), icon: Settings },
    { id: 'my_company', label: t('tabs.my_company'), icon: Building2 },
    { id: 'louis_config', label: 'LOUIS AI Config', icon: Brain },
    { id: 'louis_workflows', label: 'LOUIS AI Workflows', icon: Cpu },
    { id: 'data_portability', label: t('tabs.data_portability'), icon: FileSpreadsheet },
    { id: 'notifications', label: t('tabs.notifications'), icon: FileText },
    { id: 'connections', label: t('tabs.connections'), icon: Link },
    { id: 'logs', label: t('tabs.logs'), icon: Activity },
    { id: 'licenses', label: t('tabs.licenses'), icon: ShieldCheck },
  ];

  return (
    <div className="space-y-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-1.5 bg-accent-blue/10 rounded-sm">
              <ShieldCheck className="text-accent-blue" size={20} />
            </div>
            <h2 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.4em] font-display">{t('intelligence')}</h2>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white font-display uppercase italic tracking-[0.05em] leading-none">{t('title')}</h1>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, idx) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="bg-primary-light/50 border border-white/5 p-6 rounded-xl flex items-center gap-4 hover:border-accent-orange/20 transition-all shadow-xl"
          >
            <div className={cn("p-4 bg-primary-dark/80 rounded-xl border border-white/5 shadow-inner shrink-0", stat.colorClass)}>
              <stat.icon size={24} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-black text-slate-600 uppercase tracking-[0.2em] font-display italic mb-1">{stat.label}</p>
              <p className={cn("font-black tracking-tight leading-snug truncate", 
                stat.value.length > 22 ? "text-[11px] text-white/95" : "text-base text-white"
              )} title={stat.value}>
                {stat.value}
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Sidebar Tabs */}
        <div className="lg:col-span-1 space-y-2">
          {adminTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={cn(
                "w-full flex items-center gap-3 px-6 py-4 rounded-xl font-black uppercase text-[10px] tracking-widest transition-all text-left font-display",
                activeSubTab === tab.id
                  ? "bg-primary-light border border-white/10 text-white shadow-2xl shadow-black/40"
                  : "text-slate-600 hover:bg-primary-light/50 hover:text-slate-400"
              )}
            >
              <tab.icon size={18} className={activeSubTab === tab.id ? "text-accent-orange" : ""} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="lg:col-span-3">
          <div className="h-[calc(100vh-220px)] overflow-y-auto custom-scrollbar pr-4 space-y-12">
            {activeSubTab === 'profile' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-12 shadow-inner">
                <ProfileTab timezone={timezone} setTimezone={setTimezone} />
              </motion.div>
            )}

            {activeSubTab === 'settings' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-12 shadow-inner">
                <SystemSettingsTab />
              </motion.div>
            )}

            {activeSubTab === 'my_company' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-12 shadow-inner">
                <div className="flex items-center gap-6 mb-8">
                  <div className="p-5 bg-accent-orange/10 rounded-2xl border border-accent-orange/20 shadow-lg shadow-accent-orange/10"><Building2 className="text-accent-orange" size={32} /></div>
                  <div>
                    <h3 className="text-4xl font-black text-white italic uppercase tracking-tighter font-display">{t('my_company.title')}</h3>
                    <p className="text-slate-500 text-xs font-bold italic opacity-70 tracking-wider font-display uppercase">{t('my_company.description')}</p>
                  </div>
                </div>
                <MyCompanyForm />
              </motion.div>
            )}

            {activeSubTab === 'connections' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-12 shadow-inner">
                <ConnectionsTab />
              </motion.div>
            )}

            {activeSubTab === 'logs' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-10 space-y-8 shadow-inner">
                <div>
                  <h3 className="text-3xl font-black text-white mb-2 font-display uppercase italic tracking-tighter">{t('tabs.logs')}</h3>
                  <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">{t('common:ai_audit')}</p>
                </div>
                <AuditLogTable logs={auditLogs} />
              </motion.div>
            )}

            {activeSubTab === 'notifications' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-12 shadow-inner">
                <TemplatesTab />
              </motion.div>
            )}

            {activeSubTab === 'louis_config' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-12 shadow-inner">
                <LouisAiSettingsForm />
              </motion.div>
            )}

            {activeSubTab === 'louis_workflows' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-10 shadow-inner">
                <LouisAiWorkflowsTab />
              </motion.div>
            )}

            {activeSubTab === 'data_portability' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-12 shadow-inner">
                <DataPortabilityTab />
              </motion.div>
            )}

            {activeSubTab === 'licenses' && (
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="bg-primary-light/30 border border-white/5 rounded-xl p-12 shadow-inner">
                <LicensesTab />
              </motion.div>
            )}


          </div>
        </div>
      </div>
    </div>
  );
};
