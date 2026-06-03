import React from 'react';
import { motion } from 'motion/react';
import { 
  Users, 
  Building2,
  FileText,
  ArrowRight
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trpc } from '../lib/trpc';
import { cn } from '../lib/utils';
import { Company, Contact, Invoice } from '../types';
import { OpenInvoicesCard } from '../components/dashboard/OpenInvoicesCard';
import { PendingApprovalsCard } from '../components/dashboard/PendingApprovalsCard';

export const Dashboard = ({ onNavigate }: { onNavigate?: (tab: string) => void }) => {
  const { t } = useTranslation(['dashboard', 'common']);
  
  // tRPC Queries
  const { data: companies = [], isLoading: loadingCompanies } = trpc.getCompanies.useQuery();
  const { data: contacts = [], isLoading: loadingContacts } = trpc.getContacts.useQuery();
  const { data: invoices = [], isLoading: loadingInvoices } = trpc.getInvoices.useQuery();

  const loading = loadingCompanies || loadingContacts || loadingInvoices;

  const statCards = [
    { 
      title: t('common:companies'), 
      value: companies.length, 
      icon: Building2, 
      tab: 'companies',
      color: 'text-accent-orange',
      bg: 'bg-accent-orange/10'
    },
    { 
      title: t('common:contacts'), 
      value: contacts.length, 
      icon: Users, 
      tab: 'contacts',
      color: 'text-accent-blue',
      bg: 'bg-accent-blue/10'
    },
    { 
      title: t('common:invoices'), 
      value: invoices.length, 
      icon: FileText, 
      tab: 'invoices',
      color: 'text-accent-orange',
      bg: 'bg-accent-orange/10'
    }
  ];

  return (
    <div className="space-y-12 pb-12">
      <header className="flex flex-col gap-4">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h2 className="text-4xl font-black tracking-tight text-white font-display">
            {t('common:welcome')}
          </h2>
          <p className="text-slate-500 text-lg mt-2 font-medium">
            {t('common:tagline')}
          </p>
        </motion.div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {statCards.map((stat, idx) => (
          <motion.div
            key={stat.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
          >
            <button 
              onClick={() => onNavigate?.(stat.tab)}
              className="w-full text-left block group bg-primary-light border border-white/5 p-8 rounded-xl hover:border-white/10 hover:bg-primary-light/80 transition-all relative overflow-hidden"
            >
              <div className="flex justify-between items-start mb-4">
                <div className={cn("w-14 h-14 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110 duration-500", stat.bg, stat.color)}>
                  <stat.icon size={28} />
                </div>
                <ArrowRight size={20} className="text-slate-600 group-hover:text-white transition-colors" />
              </div>
              
              <div>
                <div className="text-4xl font-black text-white mb-1">
                  {loading ? '...' : stat.value}
                </div>
                <div className="text-slate-500 font-bold uppercase tracking-widest text-[10px]">
                  {stat.title}
                </div>
              </div>

              {/* Background Glow */}
              <div className={cn("absolute -right-8 -bottom-8 w-32 h-32 blur-3xl opacity-0 group-hover:opacity-10 transition-opacity", stat.bg)}></div>
            </button>
          </motion.div>
        ))}
      </div>

      {/* Offene Posten und Ausstehende Freigaben nebeneinander */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="flex flex-col h-full"
        >
          <OpenInvoicesCard onNavigate={onNavigate} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="flex flex-col h-full"
        >
          <PendingApprovalsCard onNavigate={onNavigate} />
        </motion.div>
      </div>
    </div>
  );
};
;
