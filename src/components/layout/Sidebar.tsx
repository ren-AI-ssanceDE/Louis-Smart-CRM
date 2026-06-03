import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Building2, 
  Contact, 
  FileText, 
  LayoutDashboard, 
  Settings,
  Menu,
  X,
  Lock,
  Unlock,
  GripVertical,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Brain
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { trpc } from '../../lib/trpc';
import {
  DndContext, 
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  TouchSensor
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  timezone: string;
  isLouisAiOpen: boolean;
  setIsLouisAiOpen: (open: boolean) => void;
}

interface MenuItem {
  id: string;
  icon: React.ElementType;
  label: string;
}

interface SortableSidebarItemProps {
  item: MenuItem;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isOpen: boolean;
  isLocked: boolean;
  isLouisAiOpen: boolean;
  setIsLouisAiOpen: (open: boolean) => void;
}

const SortableSidebarItem: React.FC<SortableSidebarItemProps> = ({ 
  item, 
  activeTab, 
  setActiveTab, 
  isOpen, 
  isLocked,
  isLouisAiOpen,
  setIsLouisAiOpen
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: item.id, disabled: isLocked });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 'auto',
  };

  const isActive = item.id === 'louis-ai' ? isLouisAiOpen : activeTab === item.id;

  const handleClick = () => {
    if (item.id === 'louis-ai') {
      setIsLouisAiOpen(!isLouisAiOpen);
    } else {
      setActiveTab(item.id);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-all duration-300 group relative touch-none cursor-pointer",
        !isOpen && "justify-center px-0",
        isDragging ? "bg-primary-light shadow-2xl opacity-80" : 
        isActive 
          ? "bg-primary-light border border-white/5 text-white shadow-xl" 
          : "text-slate-500 hover:bg-primary-light hover:text-white"
      )}
      onClick={handleClick}
      {...(isLocked ? {} : { ...attributes, ...listeners })}
    >
      {isActive && !isDragging && (
        <motion.div 
          layoutId="active-indicator"
          className="absolute left-[-4px] w-1.5 h-6 bg-accent-orange rounded-full shadow-[0_0_10px_rgba(255,103,22,0.6)]"
        />
      )}
      
      {!isLocked && (
        <GripVertical size={14} className={cn(
          "shrink-0 transition-colors",
          isDragging ? "text-accent-orange" : "text-slate-800 group-hover:text-slate-600"
        )} />
      )}

      <item.icon size={20} className={cn(
        "shrink-0 transition-transform duration-300",
        !isDragging && "group-hover:scale-110",
        isActive ? "text-accent-orange" : "group-hover:text-accent-blue"
      )} />
      
      {isOpen && (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="font-bold text-sm tracking-wide truncate"
        >
          {item.label}
        </motion.span>
      )}
    </div>
  );
};

export const Sidebar = ({ activeTab, setActiveTab, timezone, isLouisAiOpen, setIsLouisAiOpen }: SidebarProps) => {
  const { t, i18n } = useTranslation(['common', 'sidebar']);
  const [isOpen, setIsOpen] = React.useState(true);
  const [isLocked, setIsLocked] = React.useState(true);
  const { data: sessionData } = trpc.getSession.useQuery();

  const handleLogout = async () => {
    try {
      const getCsrfRes = await fetch('/api/auth/csrf');
      const { csrfToken } = await getCsrfRes.json();
      
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = '/api/auth/signout';
      
      const csrfInput = document.createElement('input');
      csrfInput.type = 'hidden';
      csrfInput.name = 'csrfToken';
      csrfInput.value = csrfToken;
      form.appendChild(csrfInput);
      
      document.body.appendChild(form);
      form.submit();
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const [menuItems, setMenuItems] = React.useState<MenuItem[]>([
    { id: 'dashboard', icon: LayoutDashboard, label: t('dashboard') },
    { id: 'companies', icon: Building2, label: t('companies') },
    { id: 'contacts', icon: Contact, label: t('contacts') },
    { id: 'invoices', icon: FileText, label: t('invoices') },
    { id: 'louis-ai', icon: Brain, label: t('louis-ai') || 'Louis AI' },
  ]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Sync translation labels if they change
  React.useEffect(() => {
    setMenuItems(prev => prev.map(item => ({
      ...item,
      label: t(item.id)
    })));
  }, [t]);

  const [time, setTime] = React.useState(new Date());

  React.useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString(i18n.language, { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      timeZone: timezone 
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setMenuItems((items) => {
        const oldIndex = items.findIndex((i) => i.id === active.id);
        const newIndex = items.findIndex((i) => i.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  return (
    <div className={cn(
      "h-screen bg-primary-dark text-neutral-white transition-all duration-500 flex flex-col border-r border-white/5 shrink-0",
      isOpen ? "w-64" : "w-20"
    )}>
      <div className="p-8 flex items-center justify-between border-b border-white/5">
        {isOpen && (
          <motion.h1 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-lg font-black tracking-tighter text-white flex items-center gap-2 font-display uppercase italic"
          >
            Louis <span className="text-accent-orange font-medium text-[10px] tracking-widest uppercase not-italic">{t('sidebar:smart_crm')}</span>
            <span className="bg-accent-orange h-1.5 w-1.5 rounded-full shadow-[0_0_8px_rgba(255,103,22,0.8)] shrink-0" />
          </motion.h1>
        )}
        {!isOpen && (
           <div className="w-full flex justify-center">
             <div className="bg-accent-orange h-2 w-2 rounded-full shadow-[0_0_8px_rgba(255,103,22,0.8)]" />
           </div>
        )}
      </div>

      <div className="flex-1 px-4 mt-6 overflow-y-auto no-scrollbar">
        <div className="mb-4 flex items-center justify-between px-2">
          {isOpen && (
            <p className="text-[10px] font-black text-slate-800 uppercase tracking-[0.2em] font-display italic">{t('common:navigation')}</p>
          )}
          <button 
            onClick={() => setIsLocked(!isLocked)}
            className={cn(
              "p-1.5 rounded-lg transition-all hover:bg-primary-light",
              isLocked ? "text-slate-800 hover:text-slate-600" : "text-accent-orange bg-accent-orange/5 shadow-inner"
            )}
            title={isLocked ? t('common:locked') : t('common:preview_mode')}
          >
            {isLocked ? <Lock size={12} /> : <Unlock size={12} />}
          </button>
        </div>

        <DndContext 
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext 
            items={menuItems.map(i => i.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-1">
              {menuItems.map((item) => (
                <SortableSidebarItem 
                  key={item.id} 
                  item={item} 
                  activeTab={activeTab} 
                  setActiveTab={setActiveTab} 
                  isOpen={isOpen}
                  isLocked={isLocked}
                  isLouisAiOpen={isLouisAiOpen}
                  setIsLouisAiOpen={setIsLouisAiOpen}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <div className={cn("p-6 space-y-4 border-t border-white/5 transition-all text-center", !isOpen && "px-2")}>
        <div className={cn(
          "flex flex-col items-center justify-center mb-4 transition-all duration-500",
          !isOpen && "opacity-0 h-0 overflow-hidden"
        )}>
          <p className="text-[10px] font-black text-slate-700 uppercase tracking-[0.3em] font-display mb-1 italic">{t('common:system_time')}</p>
          <p className="text-xl font-black text-white font-mono tracking-tighter leading-none">{formatTime(time)}</p>
        </div>
        
        <button 
          onClick={() => setActiveTab('admin')}
          className={cn(
            "w-full flex items-center gap-3 p-3 bg-primary-light border border-white/5 rounded-xl relative overflow-hidden group transition-all text-left",
            !isOpen && "justify-center p-2",
            activeTab === 'admin' ? "ring-2 ring-accent-orange bg-primary-light" : "hover:bg-primary-light"
          )}
        >
          <div className="absolute inset-0 bg-gradient-to-r from-accent-orange/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className={cn(
            "rounded-lg bg-gradient-to-tr from-accent-orange to-accent-blue flex items-center justify-center font-bold text-white shadow-lg overflow-hidden shrink-0 relative z-10 transition-all",
            isOpen ? "w-10 h-10" : "w-12 h-12"
          )}>
             <div className="w-full h-full flex items-center justify-center backdrop-blur-sm bg-white/10 text-white">
               <Settings size={isOpen ? 18 : 22} className="group-hover:rotate-45 transition-transform duration-500" />
             </div>
          </div>
          {isOpen && (
            <div className="overflow-hidden relative z-10">
              <p className="text-xs font-black truncate text-neutral-white uppercase tracking-widest font-display italic">{t('common:admin')}</p>
            </div>
          )}
        </button>

        {sessionData?.isAuthenticated && (
          <button 
            onClick={handleLogout}
            className={cn(
              "w-full flex items-center gap-3 p-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-xl relative overflow-hidden group transition-all text-left mt-2",
              !isOpen && "justify-center p-2"
            )}
            title={t('common:logout')}
          >
            <div className={cn(
              "rounded-lg bg-red-500 flex items-center justify-center font-bold text-white shadow-md shrink-0 relative z-10 transition-all",
              isOpen ? "w-10 h-10" : "w-12 h-12"
            )}>
               <LogOut size={isOpen ? 16 : 20} className="group-hover:scale-110 transition-transform duration-300" />
            </div>
            {isOpen && (
              <div className="overflow-hidden relative z-10">
                <p className="text-xs font-black truncate text-red-200 uppercase tracking-widest font-display italic">{t('common:logout')}</p>
                <p className="text-[10px] text-slate-500 font-mono truncate">{sessionData.user?.email}</p>
              </div>
            )}
          </button>
        )}

        {isOpen && (
          <div className="text-[9px] text-slate-600 font-bold uppercase tracking-widest select-none text-center pt-2">
            {t('common:gpl_license_prefix', { defaultValue: 'GPLv3 Lizenzgeber: ' })} <a href="https://www.ren-ai-ssance.de" target="_blank" rel="noopener noreferrer" className="text-accent-orange/70 hover:text-accent-orange transition-colors">ren-AI-ssance®</a>
          </div>
        )}

        <div className="flex justify-center">
          <div 
            onClick={() => setIsOpen(!isOpen)}
            className="cursor-pointer text-slate-400 hover:text-white transition-all transform hover:scale-110 p-2"
            title={isOpen ? t('common:close') : t('common:open')}
          >
            {isOpen ? <ChevronLeft size={24} strokeWidth={2.5} /> : <ChevronRight size={24} strokeWidth={2.5} />}
          </div>
        </div>
      </div>
    </div>
  );
};


