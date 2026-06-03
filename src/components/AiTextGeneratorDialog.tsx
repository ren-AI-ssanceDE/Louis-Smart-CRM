import React, { useState, useEffect, useRef } from 'react';
import { trpc } from '../lib/trpc';
import { 
  Sparkles, 
  X, 
  Send, 
  Check, 
  MessageSquare, 
  Brain,
  FileText,
  ThumbsUp,
  RotateCcw
} from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface AiTextGeneratorDialogProps {
  isOpen: boolean;
  onClose: () => void;
  fieldId: string;
  fieldValue: string;
  context: string; // "E-Mail Haupttext" | "Vorlage" etc.
  onAccept: (newValue: string) => void;
}

export const AiTextGeneratorDialog: React.FC<AiTextGeneratorDialogProps> = ({
  isOpen,
  onClose,
  fieldId,
  fieldValue,
  context,
  onAccept
}) => {
  const { t } = useTranslation(['common', 'ai_generator']);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputVal, setInputVal] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // tRPC Mutation for generation
  const generateMutation = trpc.generateText.useMutation({
    onSuccess: (data) => {
      setMessages(prev => [...prev, { role: 'assistant', content: data.text }]);
    },
    onError: (err) => {
      toast.error(t('ai_generator:generation_failed') + err.message);
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: t('ai_generator:api_key_hint', { message: err.message })
      }]);
    }
  });

  // Trigger init on first open
  useEffect(() => {
    if (isOpen) {
      setMessages([]);
      setInputVal('');
      
      // Auto trigger first generic improvement suggestion
      const defaultInstruction = fieldValue.trim() 
        ? t('ai_generator:improve_default_prompt')
        : t('ai_generator:create_default_prompt');
      
      setMessages([{ role: 'user', content: defaultInstruction }]);
      generateMutation.mutate({
        fieldId,
        currentValue: fieldValue,
        context,
        userInstructions: defaultInstruction,
        chatHistory: []
      });
    }
  }, [isOpen, fieldId, context, t]);

  // Autoscroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, generateMutation.isPending]);

  if (!isOpen) return null;

  const handleSend = (instruction: string) => {
    if (!instruction.trim() || generateMutation.isPending) return;

    const newMsg: Message = { role: 'user', content: instruction };
    const history = [...messages];
    
    setMessages(prev => [...prev, newMsg]);
    setInputVal('');

    generateMutation.mutate({
      fieldId,
      currentValue: fieldValue,
      context,
      userInstructions: instruction,
      chatHistory: history
    });
  };

  const quickPrompts = [
    { label: t('ai_generator:quick_professional_label'), prompt: t('ai_generator:quick_professional_prompt') },
    { label: t('ai_generator:quick_shorter_label'), prompt: t('ai_generator:quick_shorter_prompt') },
    { label: t('ai_generator:quick_friendly_label'), prompt: t('ai_generator:quick_friendly_prompt') },
    { label: t('ai_generator:quick_longer_label'), prompt: t('ai_generator:quick_longer_prompt') }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fade-in" id="ai-text-gen-overlay">
      <div 
        className="w-full max-w-2xl bg-primary-light border-2 border-emerald-500/20 rounded-3xl flex flex-col max-h-[85vh] shadow-[0_0_50px_rgba(16,185,129,0.15)] overflow-hidden"
        id="ai-text-gen-box"
      >
        {/* Modal Header */}
        <div className="flex justify-between items-center bg-primary-dark/80 border-b border-white/5 py-4 px-6">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/10 rounded-xl text-emerald-400">
              <Sparkles size={18} className="animate-pulse" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-wider font-display flex items-center gap-2">
                {t('ai_generator:title')}
              </h3>
              <p className="text-[10px] text-slate-500 font-sans mt-0.5">
                {t('ai_generator:context_label')}: <span className="text-slate-400 font-semibold">{context}</span> &middot; {t('ai_generator:field_id_label')}: <span className="font-mono text-[9px] bg-white/5 px-1 py-0.5 rounded text-emerald-400">{fieldId}</span>
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 border border-white/5 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-all"
            id="ai-text-gen-close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Chat Stream View */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-[250px] bg-primary-dark/20 font-sans">
          
          {/* Current Element Value Preview */}
          {fieldValue.trim() && (
            <div className="p-3 bg-primary-dark/40 border border-white/5 rounded-2xl">
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-500 font-display block mb-1">
                {t('ai_generator:original_text_preview')}
              </span>
              <p className="text-xs text-slate-400 italic line-clamp-3 leading-relaxed">
                "{fieldValue}"
              </p>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div 
              key={idx} 
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div 
                className={`max-w-[85%] rounded-2xl p-4 text-xs leading-relaxed ${
                  msg.role === 'user' 
                    ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300' 
                    : 'bg-primary-dark/80 border border-white/5 text-slate-100 whitespace-pre-wrap'
                }`}
              >
                {/* Message Header */}
                <span className="text-[9px] font-black uppercase tracking-widest block mb-1 opacity-50 font-display">
                  {msg.role === 'user' ? t('ai_generator:instruction_label') : t('ai_generator:ai_writer_label')}
                </span>
                
                {msg.content}

                {/* Accept copy action (Assistant responses only) */}
                {msg.role === 'assistant' && (
                  <div className="mt-4 pt-3 border-t border-white/5 flex gap-2 justify-end">
                    <button
                      onClick={() => {
                        onAccept(msg.content);
                        toast.success(t('ai_generator:accept_success'));
                        onClose();
                      }}
                      className="bg-emerald-500 hover:scale-105 active:scale-95 transition-transform duration-200 text-slate-900 font-black uppercase text-[10px] tracking-widest px-4 py-2 rounded-xl flex items-center gap-1 cursor-pointer"
                    >
                      <Check size={12} strokeWidth={3} />
                      {t('ai_generator:apply_btn')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Assistant Typing Loop Indicator */}
          {generateMutation.isPending && (
            <div className="flex items-start">
              <div className="bg-primary-dark/80 border border-white/5 rounded-2xl p-4">
                <span className="text-[9px] font-black uppercase tracking-widest block mb-2 opacity-50 font-display">
                  {t('ai_generator:ai_writer_label')}
                </span>
                <div className="flex items-center gap-1 py-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce delay-0" />
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce delay-150" />
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce delay-300" />
                </div>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Action Controls & Input Deck */}
        <div className="p-4 bg-primary-dark/80 border-t border-white/5 space-y-3">
          
          {/* Quick instructions suggestions */}
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin no-scrollbar">
            {quickPrompts.map((q, qIdx) => (
              <button
                key={qIdx}
                onClick={() => handleSend(q.prompt)}
                disabled={generateMutation.isPending}
                className="px-3 py-1.5 bg-primary-light border border-white/5 text-[10px] font-bold text-slate-400 hover:text-emerald-400 hover:border-emerald-500/20 active:scale-95 transition-all rounded-lg whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                {q.label}
              </button>
            ))}
          </div>

          {/* TextInput bar */}
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              handleSend(inputVal);
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              disabled={generateMutation.isPending}
              placeholder={t('ai_generator:input_placeholder')}
              className="flex-1 bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-xs text-white focus:outline-none focus:border-emerald-500/40 transition-all font-sans disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={generateMutation.isPending || !inputVal.trim()}
              className="bg-emerald-500 text-slate-900 font-bold px-4 rounded-xl flex items-center justify-center hover:scale-105 active:scale-95 transition-transform duration-200 disabled:opacity-50 disabled:scale-100 cursor-pointer"
            >
              <Send size={14} strokeWidth={2.5} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
