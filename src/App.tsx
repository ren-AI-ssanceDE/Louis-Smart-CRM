import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { trpc } from './lib/trpc';
import { Sidebar } from './components/layout/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { Companies } from './pages/Companies';
import { Contacts } from './pages/Contacts';
import { Invoices } from './pages/Invoices';
import { Admin } from './pages/Admin';
import { LouisAi } from './pages/LouisAi';
import { Login } from './components/Login';
import { useTranslation } from 'react-i18next';
import { Toaster } from 'sonner';
import './i18n/config';

function AppContent() {
  const { t } = useTranslation('common');
  const { data: sessionData, isLoading, refetch } = trpc.getSession.useQuery();
  const [activeTab, setActiveTab] = React.useState('dashboard');
  const [timezone, setTimezone] = React.useState('Europe/Berlin');
  const [isLouisAiOpen, setIsLouisAiOpen] = React.useState(false);
  const [panelWidth, setPanelWidth] = React.useState(500);
  const [isResizing, setIsResizing] = React.useState(false);

  React.useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Right spacing is 24px (right-6), so panel thickness is window.innerWidth - rightOffset - mouseX
      const rightGap = 24;
      const calculatedWidth = window.innerWidth - rightGap - e.clientX;
      const minWidth = 360;
      const maxWidth = window.innerWidth - 80; // Keep space on the screen
      setPanelWidth(Math.max(minWidth, Math.min(maxWidth, calculatedWidth)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  React.useEffect(() => {
    // Force focus the iframe window immediately on load so inputs can accept focus
    try {
      window.focus();
    } catch (e) {
      console.warn("Could not focus window on startup:", e);
    }

    const handleDocumentClick = () => {
      try {
        window.focus();
      } catch (e) {
        // Safe catch for constrained iframe browser security
      }
    };

    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('mousedown', handleDocumentClick);

    const handleNavigate = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      if (customEvent.detail) {
        if (customEvent.detail === 'louis-ai') {
          setIsLouisAiOpen(true);
        } else {
          setActiveTab(customEvent.detail);
        }
      }
    };
    window.addEventListener('navigate-to-tab', handleNavigate);

    return () => {
      document.removeEventListener('click', handleDocumentClick);
      document.removeEventListener('mousedown', handleDocumentClick);
      window.removeEventListener('navigate-to-tab', handleNavigate);
    };
  }, []);

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return <Dashboard onNavigate={setActiveTab} />;
      case 'companies': return <Companies />;
      case 'contacts': return <Contacts />;
      case 'invoices': return <Invoices />;
      case 'admin': return <Admin timezone={timezone} setTimezone={setTimezone} />;
      default: return (
        <div className="flex items-center justify-center h-full text-slate-400 italic">
          {t('module_not_implemented', { tab: activeTab })}
        </div>
      );
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen w-screen flex flex-col items-center justify-center bg-primary-dark text-neutral-white">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-accent-orange border-t-transparent rounded-full animate-spin" />
          <p className="text-xs font-mono tracking-widest text-slate-400 uppercase">{t('loading_node')}</p>
        </div>
      </div>
    );
  }

  // Show login screen if not authenticated
  if (sessionData && !sessionData.isAuthenticated) {
    return <Login onLoginSuccess={() => refetch()} />;
  }

  return (
    <div className="flex h-screen bg-primary-dark font-sans text-neutral-white antialiased overflow-hidden">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        timezone={timezone} 
        isLouisAiOpen={isLouisAiOpen}
        setIsLouisAiOpen={setIsLouisAiOpen}
      />
      
      <main className="flex-1 h-full overflow-y-auto p-8 relative no-scrollbar">
        {/* Deep background accent */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-accent-orange/10 blur-[150px] rounded-full -mr-64 -mt-64" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-accent-blue/10 blur-[120px] rounded-full -ml-32 -mb-32" />

        <div className="w-full relative z-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            >
              {renderContent()}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Floating Pop-out Louis AI */}
      <AnimatePresence>
        {isLouisAiOpen && (
          <motion.div
            initial={{ opacity: 0, x: 100, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            style={{ width: `${panelWidth}px` }}
            className={`fixed top-6 right-6 bottom-6 max-w-[calc(100vw-80px)] z-50 bg-primary-dark/95 backdrop-blur-md rounded-3xl border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.6)] flex flex-col overflow-hidden ${isResizing ? 'select-none cursor-ew-resize' : ''}`}
          >
            {/* Draggable border for resizing */}
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizing(true);
              }}
              className="absolute left-0 top-0 bottom-0 w-2.5 cursor-ew-resize hover:bg-accent-orange/30 active:bg-accent-orange/50 transition-colors z-50 flex items-center justify-center group"
            >
              <div className="w-[2px] h-10 bg-white/20 group-hover:bg-accent-orange rounded-full transition-colors" />
            </div>
            
            {/* Inner contents */}
            <div className="flex-1 h-full pl-2.5">
              <LouisAi onClose={() => setIsLouisAiOpen(false)} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  const [queryClient] = React.useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 3,
        gcTime: 1000 * 60 * 10,
        refetchOnWindowFocus: false,
        retry: 2,
      }
    }
  }));
  const [trpcClient] = React.useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: '/api/trpc',
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <Toaster theme="dark" position="top-center" richColors toastOptions={{ style: { zIndex: 99999 } }} />
        <AppContent />
      </QueryClientProvider>
    </trpc.Provider>
  );
}
