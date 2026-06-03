import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | '6xl' | 'full';
  variant?: 'dark' | 'light';
  noPadding?: boolean;
}

export const Dialog = ({ isOpen, onClose, title, children, size = 'lg', variant = 'dark', noPadding = false }: DialogProps) => {
  const { t } = useTranslation('common');

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '4xl': 'max-w-4xl',
    '6xl': 'max-w-6xl',
    'full': 'max-w-[95vw]'
  };

  const bgClass = variant === 'dark' ? 'bg-primary-dark border-white/5' : 'bg-neutral-white border-slate-100';
  const headerBgClass = variant === 'dark' ? 'bg-primary-dark/50 border-white/5' : 'bg-neutral-white border-slate-50';
  const textClass = variant === 'dark' ? 'text-neutral-white' : 'text-primary-dark';
  const headerBorderClass = variant === 'dark' ? 'border-white/5' : 'border-slate-100';

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-primary-dark/90 backdrop-blur-md z-[100]"
          />
          <div className="fixed inset-0 flex items-center justify-center p-4 z-[101] pointer-events-none overflow-y-auto no-scrollbar">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className={cn(
                "border rounded-xl w-full shadow-[0_32px_64px_-12px_rgba(0,0,0,0.8)] overflow-hidden pointer-events-auto my-auto relative",
                bgClass,
                sizeClasses[size]
              )}
            >
              {title && (
                <div className={cn("p-8 border-b flex items-center justify-between backdrop-blur-sm", headerBgClass)}>
                  <h3 className={cn("text-2xl font-black tracking-tight font-display", textClass)}>{title}</h3>
                  <button 
                    onClick={onClose}
                    className={cn(
                      "p-2 rounded-xl transition-colors",
                      variant === 'dark' ? "hover:bg-primary-light text-slate-500 hover:text-white" : "hover:bg-slate-100 text-slate-400 hover:text-slate-900"
                    )}
                  >
                    <X size={24} />
                  </button>
                </div>
              )}
              {!title && (
                <button 
                  onClick={onClose}
                  className="absolute right-8 top-8 p-2 rounded-xl transition-colors z-10 hover:bg-slate-100 text-slate-400 hover:text-slate-900"
                >
                  <X size={20} />
                </button>
              )}
              <div className={cn(!noPadding && "p-8")}>
                {children}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
};
