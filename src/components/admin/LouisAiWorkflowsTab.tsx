import React, { useState, useEffect } from 'react';
import { trpc } from '../../lib/trpc';
import { toast } from 'sonner';
import { EmailDraftsApprovalPanel } from './EmailDraftsApprovalPanel';
import { 
  Brain, 
  Trash2, 
  Edit, 
  Plus, 
  X, 
  Check, 
  Search, 
  Info, 
  Cpu, 
  Layers, 
  Play, 
  ArrowRight,
  Sparkles,
  Zap,
  Clock,
  Activity,
  ChevronDown,
  ChevronUp,
  Copy
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { WorkflowInstance, WorkflowExecutionLogEntry } from '../../types';

interface ToolChainStep {
  tool: string;
  instruction: string;
}

interface Workflow {
  id_uuid?: string;
  workflow_name?: string;
  workflow_description?: string;
  tool_chain_sequence?: ToolChainStep[];
  created_by_identity?: string;
  created_at_utc?: string;
  updated_at_utc?: string;
  trigger_type?: 'MANUAL' | 'CRM_EVENT' | 'TIMER';
  trigger_config?: Record<string, unknown> | null;
  is_active?: boolean;
  direct_send_email?: boolean;
}


export const LouisAiWorkflowsTab = () => {
  const { t } = useTranslation(['admin', 'common']);
  const utils = trpc.useContext();
  
  const sanitizeSteps = (steps: any): ToolChainStep[] => {
    if (!Array.isArray(steps)) return [];
    return steps.map(step => {
      if (!step || typeof step !== 'object') {
        return { tool: 'executeCrmDataAnalyst', instruction: typeof step === 'string' ? step : '' };
      }
      return {
        tool: step.tool || 'executeCrmDataAnalyst',
        instruction: step.instruction || step.description || ''
      };
    });
  };

  const [searchTerm, setSearchTerm] = useState('');
  const [activeSubView, setActiveSubView] = useState<'workflows' | 'drafts'>('workflows');
  
  // Tab state
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedWorkflowForDetails, setSelectedWorkflowForDetails] = useState<Workflow | null>(null);
  const [showVariablesHelp, setShowVariablesHelp] = useState(false);

  // Trigger states
  const [triggerType, setTriggerType] = useState<'MANUAL' | 'CRM_EVENT' | 'TIMER'>('MANUAL');
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>({});
  const [expandedInstanceId, setExpandedInstanceId] = useState<string | null>(null);

  // Sync state when details pane loads a new workflow template selection
  useEffect(() => {
    if (selectedWorkflowForDetails) {
      setTriggerType(selectedWorkflowForDetails.trigger_type || 'MANUAL');
      setTriggerConfig(selectedWorkflowForDetails.trigger_config || {});
    }
  }, [selectedWorkflowForDetails]);

  // Unified select handler
  const handleSelectWorkflow = (workflow: Workflow) => {
    setSelectedWorkflowForDetails(workflow);
  };

  // Form states (Create / Edit)
  const [workflowName, setWorkflowName] = useState('');
  const [workflowDescription, setWorkflowDescription] = useState('');
  const [toolChain, setToolChain] = useState<ToolChainStep[]>([
    { tool: 'executeCrmDataAnalyst', instruction: '' }
  ]);
  const [formTriggerType, setFormTriggerType] = useState<'MANUAL' | 'CRM_EVENT' | 'TIMER'>('MANUAL');
  const [formTriggerConfig, setFormTriggerConfig] = useState<any>({});
  const [formIsActive, setFormIsActive] = useState<boolean>(true);
  const [formDirectSendEmail, setFormDirectSendEmail] = useState<boolean>(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Queries
  const { data: workflows = [], isLoading, refetch } = trpc.getWorkflows.useQuery();

  // Audit Log Query with 10-second Live Polling
  const { data: instances = [], refetch: refetchInstances } = trpc.getWorkflowInstancesLog.useQuery(undefined, {
    refetchInterval: 10000
  });

  // Pending Drafts count for Tab indicator
  const { data: pendingDrafts = [], refetch: refetchPendingDrafts } = trpc.getPending.useQuery();

  const reloadAll = () => {
    refetch();
    refetchInstances();
    refetchPendingDrafts();
  };

  // Mutations
  const learnWorkflowMutation = trpc.learnWorkflow.useMutation({
    onSuccess: () => {
      toast.success(t('admin:toast_success_workflow', { defaultValue: 'Workflow erfolgreich gespeichert!' }));
      resetForm();
      utils.getWorkflows.invalidate();
      reloadAll();
    },
    onError: (err) => {
      toast.error(t('admin:toast_error_workflow', { defaultValue: 'Fehler beim Speichern des Workflows: ' }) + err.message);
    }
  });

  const deleteWorkflowMutation = trpc.deleteWorkflow.useMutation({
    onSuccess: () => {
      toast.success(t('admin:toast_success_delete_workflow', { defaultValue: 'Workflow erfolgreich gelöscht.' }));
      utils.getWorkflows.invalidate();
      reloadAll();
      if (selectedWorkflowForDetails) {
        setSelectedWorkflowForDetails(null);
      }
    },
    onError: (err) => {
      toast.error(t('admin:toast_error_delete_workflow', { defaultValue: 'Fehler beim Löschen des Workflows: ' }) + err.message);
    }
  });

  const updateTriggerMutation = trpc.updateWorkflowTrigger.useMutation({
    onSuccess: () => {
      toast.success(t('admin:toast_success_trigger', { defaultValue: 'Automatisierungstrigger erfolgreich aktualisiert!' }));
      reloadAll();
      if (selectedWorkflowForDetails) {
        // Feed modified state back into detail preview
        setSelectedWorkflowForDetails({
          ...selectedWorkflowForDetails,
          trigger_type: triggerType,
          trigger_config: triggerConfig
        });
      }
    },
    onError: (err) => {
      toast.error(t('admin:toast_error_trigger', { defaultValue: 'Fehler beim Aktiveren des Triggers: ' }) + err.message);
    }
  });

  const toggleWorkflowStatusMutation = trpc.toggleWorkflowStatus.useMutation({
    onSuccess: () => {
      toast.success(t('admin:toast_success_status', { defaultValue: 'Workflow-Aktivität erfolgreich umgeschaltet!' }));
      reloadAll();
      if (selectedWorkflowForDetails) {
        setSelectedWorkflowForDetails({
          ...selectedWorkflowForDetails,
          is_active: !selectedWorkflowForDetails.is_active
        });
      }
    },
    onError: (err) => {
      toast.error(t('admin:toast_error_status', { defaultValue: 'Status konnte nicht geändert werden: ' }) + err.message);
    }
  });

  const triggerWorkflowMutation = trpc.triggerWorkflowManually.useMutation({
    onSuccess: () => {
      toast.success(t('admin:toast_success_execute_started', { defaultValue: 'Workflow erfolgreich im Hintergrund gestartet! (Präzise 5-Minuten-Wartezeit läuft technisch ab)' }));
      reloadAll();
    },
    onError: (err) => {
      toast.error(t('admin:toast_error_execute', { defaultValue: 'Fehler beim Starten des Workflows: ' }) + err.message);
    }
  });

  const resetForm = () => {
    setWorkflowName('');
    setWorkflowDescription('');
    setToolChain([{ tool: 'executeCrmDataAnalyst', instruction: '' }]);
    setEditingWorkflow(null);
    setIsCreating(false);
    setFormTriggerType('MANUAL');
    setFormTriggerConfig({});
    setFormIsActive(true);
    setFormDirectSendEmail(false);
  };

  const handleStartCreate = () => {
    resetForm();
    setIsCreating(true);
  };

  const handleStartEdit = (workflow: Workflow) => {
    setEditingWorkflow(workflow);
    setWorkflowName(workflow.workflow_name || '');
    setWorkflowDescription(workflow.workflow_description || '');
    
    // Ensure tool chain is parsed correctly
    let parsedChain: ToolChainStep[] = [];
    if (Array.isArray(workflow.tool_chain_sequence)) {
      parsedChain = sanitizeSteps(workflow.tool_chain_sequence);
    } else if (typeof workflow.tool_chain_sequence === 'string') {
      try {
        parsedChain = sanitizeSteps(JSON.parse(workflow.tool_chain_sequence));
      } catch (e) {
        parsedChain = [];
      }
    }
    
    setToolChain(parsedChain.length > 0 ? parsedChain : [{ tool: 'executeCrmDataAnalyst', instruction: '' }]);
    setFormTriggerType(workflow.trigger_type || 'MANUAL');
    setFormTriggerConfig(workflow.trigger_config || {});
    setFormIsActive(workflow.is_active !== false);
    setFormDirectSendEmail(workflow.direct_send_email === true);
    setIsCreating(false);
  };

  const handleDuplicate = (workflow: Workflow) => {
    setEditingWorkflow(null); // This is a new workflow creation
    setWorkflowName(''); // Important: name must NOT be copied so user registers a new, unique workflow ID/name
    setWorkflowDescription(workflow.workflow_description || '');

    // Ensure tool chain is parsed correctly
    let parsedChain: ToolChainStep[] = [];
    if (Array.isArray(workflow.tool_chain_sequence)) {
      parsedChain = sanitizeSteps(workflow.tool_chain_sequence);
    } else if (typeof workflow.tool_chain_sequence === 'string') {
      try {
        parsedChain = sanitizeSteps(JSON.parse(workflow.tool_chain_sequence));
      } catch (e) {
        parsedChain = [];
      }
    }

    setToolChain(parsedChain.length > 0 ? parsedChain.map(step => ({ ...step })) : [{ tool: 'executeCrmDataAnalyst', instruction: '' }]);
    setFormTriggerType(workflow.trigger_type || 'MANUAL');
    setFormTriggerConfig(workflow.trigger_config ? { ...workflow.trigger_config } : {});
    setFormIsActive(workflow.is_active !== false);
    setFormDirectSendEmail(workflow.direct_send_email === true);
    setIsCreating(true); // Puts user directly into Creation mode
    toast.success(t('admin:workflows_tab.toast_duplicate_success', { defaultValue: 'Workflow-Vorlage geladen! Bitte vergeben Sie einen neuen Namen.' }));
  };

  const handleAddStep = () => {
    setToolChain([...toolChain, { tool: 'executeCrmDataAnalyst', instruction: '' }]);
  };

  const handleRemoveStep = (idx: number) => {
    if (toolChain.length <= 1) {
      toast.warning(t('admin:step_warning', { defaultValue: 'Ein Workflow benötigt mindestens einen Ausführungsschritt.' }));
      return;
    }
    setToolChain(toolChain.filter((_, i) => i !== idx));
  };

  const handleStepChange = (idx: number, field: keyof ToolChainStep, value: string) => {
    const updated = [...toolChain];
    updated[idx] = { ...updated[idx], [field]: value };
    setToolChain(updated);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!workflowName.trim()) {
      toast.error(t('admin:error_workflow_name', { defaultValue: 'Bitte geben Sie einen Namen für den Workflow ein.' }));
      return;
    }
    if (!workflowDescription.trim()) {
      toast.error(t('admin:error_workflow_desc', { defaultValue: 'Bitte geben Sie eine Beschreibung für den Workflow ein.' }));
      return;
    }

    // Verify all tool steps have instructions
    const invalidStep = toolChain.findIndex(step => !step.instruction.trim());
    if (invalidStep !== -1) {
      toast.error(t('admin:error_step_instruction', { index: invalidStep + 1, defaultValue: `Bitte geben Sie eine Handlungsanweisung für Schritt ${invalidStep + 1} ein.` }));
      return;
    }

    learnWorkflowMutation.mutate({
      id_uuid: editingWorkflow?.id_uuid,
      workflow_name: workflowName,
      workflow_description: workflowDescription,
      tool_chain_sequence: toolChain,
      trigger_type: formTriggerType,
      trigger_config: formTriggerConfig,
      is_active: formIsActive,
      direct_send_email: formDirectSendEmail
    });
  };

  const handleDelete = (id: string, name: string) => {
    setConfirmDeleteId(id);
  };

  // Filter workflows
  const filteredWorkflows = workflows.filter((w: Workflow) => 
    (w.workflow_name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (w.workflow_description || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getToolBadgeStyle = (toolName: string) => {
    switch (toolName) {
      case 'executeCrmDataAnalyst':
      case 'executeDataArchitect':
        return 'bg-accent-blue/10 border-accent-blue/20 text-accent-blue';
      case 'executeWebSearch':
        return 'bg-accent-orange/10 border-accent-orange/20 text-accent-orange';
      case 'executeLocalKnowledgeSearch':
        return 'bg-violet-500/10 border-violet-500/20 text-violet-400';
      case 'executeTextGenerator':
        return 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400';
      case 'executeCreateDraftInvoice':
      case 'executeCreateDraftCompany':
      case 'executeCreateDraftContact':
        return 'bg-amber-500/10 border-amber-500/20 text-amber-400';
      case 'executeSendSmtpEmail':
      case 'send_smtp_email':
        return 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400';
      default:
        return 'bg-slate-500/10 border-slate-500/20 text-slate-400';
    }
  };

  const getToolLabel = (toolName: string) => {
    switch (toolName) {
      case 'executeCrmDataAnalyst':
      case 'executeDataArchitect':
        return 'CRM Data Analyst (CRM Abfrage & Analyse)';
      case 'executeWebSearch':
        return 'Web Search (Online Suche)';
      case 'executeLocalKnowledgeSearch':
        return 'Local Knowledge (RAG Suche)';
      case 'executeTextGenerator':
        return 'Text-Generator (Optimiertes Schreiben)';
      case 'executeCreateDraftInvoice':
        return 'Create Draft Invoice (Rechnungsentwurf)';
      case 'executeCreateDraftCompany':
        return 'Create Draft Company (Firmenentwurf)';
      case 'executeCreateDraftContact':
        return 'Create Draft Contact (Kontaktentwurf)';
      case 'executeSendSmtpEmail':
      case 'send_smtp_email':
        return 'Send SMTP Email (E-Mail-Versand)';
      default:
        return toolName;
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-6">
          <div className="p-5 bg-gradient-to-tr from-accent-orange/20 to-accent-blue/20 rounded-2xl border border-white/5 shadow-xl relative glow-orange">
            <Cpu className="text-accent-orange animate-pulse" size={32} />
          </div>
          <div>
            <h3 className="text-4xl font-black text-white italic uppercase tracking-tighter font-display">
              {t('admin:workflows_tab.title', { defaultValue: 'LOUIS AI Workflows' })}
            </h3>
            <p className="text-slate-500 text-xs font-bold italic opacity-70 tracking-wider font-display uppercase animate-none">
              {t('admin:workflows_tab.desc', { defaultValue: 'Verwalte die erlernten Tools und automatisierten Sequenzen des ReAct Agenten' })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 self-stretch sm:self-auto flex-wrap sm:flex-nowrap">
          <button
            onClick={() => setShowVariablesHelp(true)}
            className="bg-primary-light/40 border border-white/10 hover:border-slate-500 hover:bg-primary-light/60 hover:scale-105 active:scale-95 transition-all text-slate-300 font-extrabold uppercase text-[10px] tracking-widest px-5 py-3 rounded-xl flex items-center gap-2 shadow-lg cursor-pointer max-h-[44px]"
            type="button"
          >
            <Info size={14} className="text-accent-blue" />
            {t('admin:workflows_tab.variables_helper.button', { defaultValue: 'Variablen-Hilfe' })}
          </button>
          {!isCreating && !editingWorkflow && (
            <button
              onClick={handleStartCreate}
              className="bg-gradient-to-tr from-accent-orange to-accent-orange/80 hover:scale-105 active:scale-95 transition-transform duration-300 text-white font-black uppercase text-[10px] tracking-widest px-5 py-3 rounded-xl flex items-center gap-2 shadow-lg hover:shadow-accent-orange/20 cursor-pointer text-center whitespace-nowrap self-stretch sm:self-auto max-h-[44px]"
              type="button"
            >
              <Plus size={14} />
              {t('admin:workflows_tab.new_btn', { defaultValue: 'Neuer Workflow' })}
            </button>
          )}
        </div>
      </div>

      {/* Info Notice */}
      <div className="bg-primary-dark/55 border border-white/5 rounded-2xl p-5 flex gap-4 text-xs text-slate-400 leading-relaxed font-sans">
        <Info className="text-accent-blue shrink-0 mt-0.5" size={20} />
        <div className="space-y-1">
          <p className="font-bold text-slate-300">
            {t('admin:workflows_tab.info_title', { defaultValue: 'Was sind LOUIS AI Workflows?' })}
          </p>
          <p dangerouslySetInnerHTML={{ 
            __html: t('admin:workflows_tab.info_desc', { 
              defaultValue: 'Wenn Sie mit der LOUIS AI sprechen, lernt die künstliche Intelligenz bei komplexen, wiederkehrenden Aufgabensequenzen neue <strong>Workflows (Custom Tools)</strong> zu registrieren. Diese Workflows bündeln verkettete Handlungen (z.B. CRM-Analysen gefolgt von einer Websuche oder RAG-Informationsgenerierung), um zeitintensive Routineaufgaben autonom im Hintergrund zu erledigen.' 
            }) 
          }} />
        </div>
      </div>

      {/* Workspace Area */}
      {isCreating || editingWorkflow ? (
        <form onSubmit={handleSubmit} className="bg-primary-light/10 border border-white/5 p-8 rounded-2xl space-y-6">
          <div className="flex items-center justify-between border-b border-white/5 pb-4">
            <div className="flex items-center gap-2">
              <Sparkles className="text-accent-orange" size={18} />
              <h4 className="text-base font-black text-white uppercase tracking-wider font-display">
                {editingWorkflow 
                  ? t('admin:workflows_tab.edit_title', { defaultValue: 'Workflow anpassen' }) 
                  : t('admin:workflows_tab.create_title', { defaultValue: 'Neuen Workflow entwerfen' })}
              </h4>
            </div>
            <button
              type="button"
              onClick={resetForm}
              className="text-slate-500 hover:text-white transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-display">
                {t('admin:workflows_tab.id_label', { defaultValue: 'Workflow-ID / Name *' })}
              </label>
              <input
                type="text"
                required
                disabled={!!editingWorkflow}
                value={workflowName}
                onChange={(e) => setWorkflowName(e.target.value)}
                className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-orange/40 transition-all font-sans disabled:opacity-50"
                placeholder="z.B. check_overdue_and_notify_partners"
              />
              <p className="text-[10px] text-slate-500 font-mono italic">
                {t('admin:workflows_tab.id_desc', { defaultValue: 'Ein eindeutiger Identifizierer ohne Sonderzeichen, den Louis direkt als Funktions-Tool ansteuern kann.' })}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-display">
                {t('admin:workflows_tab.purpose_label', { defaultValue: 'Zweck / Beschreibung *' })}
              </label>
              <input
                type="text"
                required
                value={workflowDescription}
                onChange={(e) => setWorkflowDescription(e.target.value)}
                className="w-full bg-primary-dark border border-white/5 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-accent-orange/40 transition-all font-sans"
                placeholder={t('admin:workflows_tab.purpose_placeholder', { defaultValue: 'z.B. Analysiert ausstehende Rechnungen und sucht nach Firmenprofilen im Web' })}
              />
            </div>
          </div>

          {/* Steps Designer */}
          <div className="border-t border-white/5 pt-6 space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <h5 className="text-xs font-black uppercase tracking-widest text-slate-400 font-display">
                  {t('admin:workflows_tab.chain_title', { defaultValue: '📋 Ausführungskette (Tools & Anweisungen)' })}
                </h5>
                <button
                  type="button"
                  onClick={() => setShowVariablesHelp(true)}
                  className="px-2.5 py-1 bg-primary-dark border border-white/5 hover:border-accent-blue/40 text-accent-blue hover:text-white rounded-lg text-[9px] font-black uppercase tracking-widest font-display transition-all flex items-center gap-1 cursor-pointer"
                  title={t('admin:workflows_tab.variables_helper.button', { defaultValue: 'Variablen-Hilfe' })}
                >
                  <Info size={11} />
                  {t('admin:workflows_tab.variables_helper.button', { defaultValue: 'Variablen-Hilfe' })}
                </button>
              </div>
              <button
                type="button"
                onClick={handleAddStep}
                className="text-accent-blue flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest font-display hover:text-white transition-colors cursor-pointer"
              >
                <Plus size={14} />
                {t('admin:workflows_tab.add_step_btn', { defaultValue: 'Schritt hinzufügen' })}
              </button>
            </div>

            <div className="space-y-4">
              {toolChain.map((step, idx) => (
                <div 
                  key={idx}
                  className="bg-primary-dark/40 border border-white/5 rounded-xl p-5 relative flex flex-col md:flex-row gap-4 items-start md:items-center"
                >
                  {/* Step Badge */}
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-primary-light border border-white/10 flex items-center justify-center text-xs text-white font-mono font-bold">
                      {idx + 1}
                    </span>
                  </div>

                  {/* Tool selection */}
                  <div className="w-full md:w-1/3 space-y-1.5">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest font-display">
                      {t('admin:workflows_tab.assigned_tool_label', { defaultValue: 'Zugeordnetes System-Tool' })}
                    </label>
                    <select
                      value={step.tool}
                      onChange={(e) => handleStepChange(idx, 'tool', e.target.value)}
                      className="w-full bg-primary-dark border border-white/5 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-accent-orange/40 transition-all font-sans"
                    >
                      <option value="executeCrmDataAnalyst">{t('admin:workflows_tab.tools.crm_analyst', { defaultValue: 'CRM Data Analyst (CRM Abfrage & Analyse)' })}</option>
                      <option value="executeWebSearch">{t('admin:workflows_tab.tools.web_search', { defaultValue: 'Web Search (Online Suche)' })}</option>
                      <option value="executeLocalKnowledgeSearch">{t('admin:workflows_tab.tools.local_knowledge', { defaultValue: 'Local Knowledge (RAG Suche)' })}</option>
                      <option value="executeTextGenerator">{t('admin:workflows_tab.tools.text_generator', { defaultValue: 'Text-Generator (Optimiertes Schreiben)' })}</option>
                      <option value="executeCreateDraftInvoice">{t('admin:workflows_tab.tools.create_draft_invoice', { defaultValue: 'Create Draft Invoice (Rechnungsentwurf)' })}</option>
                      <option value="executeCreateDraftCompany">{t('admin:workflows_tab.tools.create_draft_company', { defaultValue: 'Create Draft Company (Firmenentwurf)' })}</option>
                      <option value="executeCreateDraftContact">{t('admin:workflows_tab.tools.create_draft_contact', { defaultValue: 'Create Draft Contact (Kontaktentwurf)' })}</option>
                      <option value="executeSendSmtpEmail">{t('admin:workflows_tab.tools.send_smtp_email', { defaultValue: 'Send SMTP Email (E-Mail-Versand)' })}</option>
                      <option value="executeWait">{t('admin:workflows_tab.tools.wait', { defaultValue: 'Wait (Zeitverzögerung)' })}</option>
                    </select>
                  </div>

                  {/* Instruction context */}
                  <div className="w-full md:flex-1 space-y-1.5">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest font-display">
                      {t('admin:workflows_tab.step_instruction_label', { defaultValue: 'Expliziter Prompt / Handlungsanweisung für diesen Schritt' })}
                    </label>
                    <textarea
                      required
                      rows={3}
                      value={step.instruction}
                      onChange={(e) => handleStepChange(idx, 'instruction', e.target.value)}
                      placeholder={t('admin:workflows_tab.step_instruction_placeholder', { defaultValue: 'z.B. Hole alle ausstehenden Rechnungen mit dem Status \'pending\'' })}
                      className="w-full bg-primary-dark border border-white/5 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-accent-orange/40 transition-all font-sans leading-relaxed resize-y min-h-[80px]"
                    />
                  </div>

                  {/* Remove action */}
                  <button
                    type="button"
                    onClick={() => handleRemoveStep(idx)}
                    className="p-2 border border-white/5 text-slate-500 hover:text-accent-orange hover:bg-accent-orange/5 rounded-xl transition-all self-end md:self-center"
                    title={t('admin:workflows_tab.remove_step_tooltip', { defaultValue: 'Schritt entfernen' })}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Automation & Trigger Settings inside Form */}
          <div className="border-t border-white/5 pt-6 space-y-4">
            <h5 className="text-xs font-black uppercase tracking-widest text-slate-400 font-display flex items-center gap-1.5">
              <Zap size={14} className="text-accent-orange font-bold" />
              {t('admin:workflows_tab.automation_title', { defaultValue: 'Automatisierung & Trigger' })}
            </h5>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 bg-primary-dark/30 border border-white/5 p-6 rounded-2xl">
              {/* Activity Status */}
              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
                  {t('admin:workflows_tab.activity_status', { defaultValue: 'Aktivitätsstatus' })}
                </label>
                <button
                  type="button"
                  onClick={() => setFormIsActive(!formIsActive)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-wider font-display transition-all ${formIsActive ? 'bg-green-500/10 border-green-500/20 text-green-400 hover:bg-green-500/20' : 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'}`}
                >
                  {formIsActive ? <Check size={12} /> : <X size={12} />}
                  {formIsActive ? t('admin:workflows_tab.active_label', { defaultValue: 'Aktiv' }) : t('admin:workflows_tab.inactive_label', { defaultValue: 'Inaktiv' })}
                </button>
              </div>

              {/* Mailing-Freigabekontrolle */}
              {formTriggerType !== 'MANUAL' && (
                <div className="space-y-1.5 animate-fadeIn">
                  <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
                    {t('admin:workflows_tab.email_approval_label', { defaultValue: 'E-Mail-Freigabe' })}
                  </label>
                  <button
                    type="button"
                    onClick={() => setFormDirectSendEmail(!formDirectSendEmail)}
                    className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl border text-[10px] font-black uppercase tracking-wider font-display transition-all ${formDirectSendEmail ? 'bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20' : 'bg-accent-blue/10 border-accent-blue/20 text-accent-blue hover:bg-accent-blue/20'}`}
                  >
                    {formDirectSendEmail ? <Check size={12} /> : <Clock size={12} />}
                    {formDirectSendEmail ? t('admin:workflows_tab.send_direct_label', { defaultValue: 'Direkt Senden' }) : t('admin:workflows_tab.draft_approval_label', { defaultValue: 'Entwurf (Freigabe)' })}
                  </button>
                  <p className="text-[9px] text-slate-500 leading-tight">
                    {formDirectSendEmail 
                      ? t('admin:workflows_tab.direct_send_desc', { defaultValue: 'Workflows versenden E-Mails direkt.' }) 
                      : t('admin:workflows_tab.draft_send_desc', { defaultValue: 'Workflow pausiert für menschliche E-Mail Freigabe.' })}
                  </p>
                </div>
              )}

              {/* Start-Bedingung Selection */}
              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
                  {t('admin:workflows_tab.start_condition_label', { defaultValue: 'Start-Bedingung' })}
                </label>
                <select
                  value={formTriggerType}
                  onChange={(e) => {
                    const val = e.target.value as any;
                    setFormTriggerType(val);
                    if (val === 'MANUAL') {
                      setFormTriggerConfig({});
                    } else if (val === 'CRM_EVENT') {
                      setFormTriggerConfig({ event_name: 'contact.created', delay_seconds: 0 });
                    } else if (val === 'TIMER') {
                      setFormTriggerConfig({ frequency: 'daily', time: '08:30' });
                    }
                  }}
                  className="w-full bg-primary-dark border border-white/5 p-2.5 rounded-xl text-xs text-white focus:outline-none focus:border-accent-orange/30 font-semibold h-11"
                >
                  <option value="MANUAL">{t('admin:workflows_tab.manual_trigger_option', { defaultValue: 'Manuell ausführen ( LOUIS Chat )' })}</option>
                  <option value="CRM_EVENT">{t('admin:workflows_tab.event_trigger_option', { defaultValue: 'Ereignis-gesteuert ( CRM Event )' })}</option>
                  <option value="TIMER">{t('admin:workflows_tab.timer_trigger_option', { defaultValue: 'Zeitgesteuert ( Scheduler )' })}</option>
                </select>
              </div>

              {/* Dynamic trigger config parameters */}
              <div className="md:col-span-1">
                {formTriggerType === 'CRM_EVENT' && (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
                        {t('admin:workflows_tab.crm_event_label', { defaultValue: 'CRM Ereignis' })}
                      </label>
                      <select
                        value={formTriggerConfig.event_name || 'contact.created'}
                        onChange={(e) => setFormTriggerConfig({ ...formTriggerConfig, event_name: e.target.value })}
                        className="w-full bg-primary-dark border border-white/5 p-2.5 rounded-xl text-xs text-white focus:outline-none focus:border-accent-orange/30 font-semibold h-11"
                      >
                        <option value="contact.created">{t('admin:workflows_tab.event_contact_created_option', { defaultValue: 'Neuer Kontakt angelegt' })}</option>
                        <option value="company.created">{t('admin:workflows_tab.event_company_created_option', { defaultValue: 'Neues Unternehmen angelegt' })}</option>
                        <option value="invoice.created">{t('admin:workflows_tab.event_invoice_created_option', { defaultValue: 'Rechnung wurde erstellt' })}</option>
                        <option value="invoice.finalized">{t('admin:workflows_tab.event_invoice_finalized_option', { defaultValue: 'Rechnung wurde final gebucht/abgeschlossen' })}</option>
                        <option value="invoice.paid">{t('admin:workflows_tab.event_invoice_paid_option', { defaultValue: 'Rechnung wurde bezahlt' })}</option>
                        <option value="invoice.overdue">{t('admin:workflows_tab.event_invoice_overdue_option', { defaultValue: 'Rechnung ist überfällig' })}</option>
                        <option value="contact.updated">{t('admin:workflows_tab.event_contact_updated_option', { defaultValue: 'Kontakt wurde aktualisiert' })}</option>
                        <option value="company.updated">{t('admin:workflows_tab.event_company_updated_option', { defaultValue: 'Unternehmen wurde aktualisiert' })}</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
                        {t('admin:workflows_tab.delay_seconds_label', { defaultValue: 'Verzögerung (Sekunden)' })}
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={formTriggerConfig.delay_seconds || 0}
                        onChange={(e) => setFormTriggerConfig({ ...formTriggerConfig, delay_seconds: parseInt(e.target.value || '0', 10) })}
                        className="w-full bg-primary-dark border border-white/5 p-2.5 rounded-xl text-xs text-white focus:outline-none focus:border-accent-orange/30 font-mono font-semibold h-11"
                      />
                    </div>
                  </div>
                )}

                {formTriggerType === 'TIMER' && (
                  <div className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
                        {t('admin:workflows_tab.frequency_label', { defaultValue: 'Frequenz' })}
                      </label>
                      <select
                        value={formTriggerConfig.frequency || 'daily'}
                        onChange={(e) => setFormTriggerConfig({ ...formTriggerConfig, frequency: e.target.value })}
                        className="w-full bg-primary-dark border border-white/5 p-2.5 rounded-xl text-xs text-white focus:outline-none focus:border-accent-orange/30 font-semibold h-11"
                      >
                        <option value="hourly">{t('admin:workflows_tab.frequency_hourly_option', { defaultValue: 'Stündlich ausführen' })}</option>
                        <option value="daily">{t('admin:workflows_tab.frequency_daily_option', { defaultValue: 'Täglich ausführen' })}</option>
                      </select>
                    </div>
                    {formTriggerConfig.frequency !== 'hourly' && (
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
                          {t('admin:workflows_tab.run_at_time_label', { defaultValue: 'Ausführen um (Uhrzeit HH:MM)' })}
                        </label>
                        <input
                          type="text"
                          placeholder="08:30"
                          value={formTriggerConfig.time || '08:30'}
                          onChange={(e) => setFormTriggerConfig({ ...formTriggerConfig, time: e.target.value })}
                          className="w-full bg-primary-dark border border-white/5 p-2.5 rounded-xl text-xs text-white focus:outline-none focus:border-accent-orange/30 font-mono font-semibold h-11"
                        />
                      </div>
                    )}
                  </div>
                )}

                {formTriggerType === 'MANUAL' && (
                  <div className="text-slate-500 text-xs italic pt-6">
                    {t('admin:workflows_tab.manual_activation_info', { defaultValue: 'Aktivierung erfolgt manuell im Chat-Interface' })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Form Actions */}
          <div className="border-t border-white/5 pt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={resetForm}
              className="px-5 py-3 border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 transition-all rounded-xl font-bold uppercase text-[10px] tracking-widest cursor-pointer"
            >
              {t('common:cancel', { defaultValue: 'Abbrechen' })}
            </button>
            <button
              type="submit"
              disabled={learnWorkflowMutation.isPending}
              className="bg-gradient-to-tr from-accent-orange to-accent-orange/80 hover:scale-105 active:scale-95 transition-transform duration-300 text-white font-black uppercase text-[10px] tracking-widest px-6 py-3 rounded-xl flex items-center gap-1.5 shadow-lg hover:shadow-accent-orange/20 cursor-pointer"
            >
              {learnWorkflowMutation.isPending ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Check size={14} />
              )}
              {t('common:save', { defaultValue: 'Speichern' })}
            </button>
          </div>
        </form>
      ) : activeSubView === 'drafts' ? (
        <EmailDraftsApprovalPanel />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main List */}
          <div className="lg:col-span-2 space-y-4">
            {/* Search Filter */}
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
              <input
                type="text"
                placeholder={t('admin:workflows_tab.search_placeholder', { defaultValue: 'Workflows nach Name oder Nutzen selektieren...' })}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-primary-light/20 border border-white/5 rounded-2xl pl-12 pr-4 py-3 text-sm text-white focus:outline-none focus:border-accent-orange/40 transition-all font-sans shadow-inner placeholder:text-slate-500"
              />
            </div>

            {isLoading ? (
              <div className="flex flex-col items-center gap-3 justify-center py-20 bg-primary-light/10 border border-white/5 rounded-3xl">
                <div className="w-8 h-8 border-2 border-accent-orange border-t-transparent rounded-full animate-spin" />
                <span className="text-xs font-mono text-slate-500 uppercase tracking-widest leading-relaxed">
                  {t('admin:workflows_tab.loading_workflows', { defaultValue: 'Sondiere registrierte Workflows...' })}
                </span>
              </div>
            ) : filteredWorkflows.length === 0 ? (
              <div className="p-12 text-center bg-primary-light/10 border border-white/5 rounded-3xl space-y-3">
                <Layers className="text-slate-600 mx-auto" size={40} />
                <p className="text-sm text-slate-400 font-bold">
                  {t('admin:workflows_tab.empty_title', { defaultValue: 'Keine erlernten Workflows gefunden' })}
                </p>
                <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                  {t('admin:workflows_tab.empty_desc', { defaultValue: 'Bislang wurden keine benutzerdefinierten Workflows für diesen Tenant indiziert. Sie können oben rechts einen neuen Ablauf generieren!' })}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredWorkflows.map((workflow: Workflow) => {
                  let parsedSteps: ToolChainStep[] = [];
                  if (Array.isArray(workflow.tool_chain_sequence)) {
                    parsedSteps = sanitizeSteps(workflow.tool_chain_sequence);
                  } else if (typeof workflow.tool_chain_sequence === 'string') {
                    try {
                      parsedSteps = sanitizeSteps(JSON.parse(workflow.tool_chain_sequence));
                    } catch (_) {}
                  }

                  const stepCount = parsedSteps.length;

                  return (
                    <div 
                      key={workflow.id_uuid}
                      onClick={() => handleSelectWorkflow(workflow)}
                      className={`bg-primary-light/30 border p-6 rounded-2xl group flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 cursor-pointer hover:bg-primary-light/40 hover:border-accent-orange/20 transition-all duration-300 relative overflow-hidden shadow-lg ${selectedWorkflowForDetails?.id_uuid === workflow.id_uuid ? 'border-accent-orange/30 bg-primary-light/50 shadow-accent-orange/5' : 'border-white/5'}`}
                    >
                      <div className="absolute top-0 left-0 w-1 bg-accent-orange/40 h-full opacity-0 group-hover:opacity-100 transition-opacity" />
                      
                      <div className="space-y-2 flex-1">
                        <div className="flex flex-wrap items-center gap-3">
                          <h4 className="text-base font-black text-white font-mono group-hover:text-accent-orange transition-colors">
                            {workflow.workflow_name}
                          </h4>
                          <span className="text-[9px] font-mono font-black uppercase bg-primary-dark/80 px-2 py-0.5 rounded-full text-slate-400 border border-white/5 flex items-center gap-1">
                            <Layers size={10} className="text-accent-orange" />
                            {stepCount} {stepCount === 1 ? t('admin:workflows_tab.step_badge', { defaultValue: 'Schritt' }) : t('admin:workflows_tab.steps_badge', { defaultValue: 'Schritte' })}
                          </span>

                          {/* Dynamic trigger and status badges in list */}
                          <span className={`text-[8px] font-mono font-bold uppercase px-2 py-0.5 rounded-full border ${workflow.is_active !== false ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                            {workflow.is_active !== false ? 'Aktiv' : 'Inaktiv'}
                          </span>
                          <span className="text-[8px] font-mono font-bold uppercase bg-accent-blue/10 border border-accent-blue/20 text-accent-blue px-2 py-0.5 rounded-full">
                            ⚡ {workflow.trigger_type || 'MANUAL'}
                          </span>
                          {parsedSteps.some(s => s?.tool === 'executeSendSmtpEmail' || s?.tool === 'send_smtp_email') && (
                            <span className={`text-[8px] font-mono font-bold uppercase px-2 py-0.5 rounded-full border ${workflow.direct_send_email === true ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' : 'bg-slate-500/10 border-white/5 text-slate-400'}`}>
                              📧 {t('admin:workflows_tab.auto_mail_on_off', { defaultValue: 'Auto-Mail:' })} {workflow.direct_send_email === true 
                                ? t('admin:workflows_tab.auto_mail_on', { defaultValue: 'An' }) 
                                : t('admin:workflows_tab.auto_mail_off', { defaultValue: 'Aus' })}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed font-sans max-w-md">
                          {workflow.workflow_description}
                        </p>
                        
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          {parsedSteps.slice(0, 3).map((s, stepIdx) => (
                            <React.Fragment key={stepIdx}>
                              <span className={`text-[9px] px-2 py-0.5 rounded font-bold uppercase tracking-wider font-mono border ${getToolBadgeStyle(s?.tool || '')}`}>
                                {(s?.tool || 'unknown').replace('execute', '')}
                              </span>
                              {stepIdx < parsedSteps.slice(0, 3).length - 1 && (
                                <ArrowRight size={10} className="text-slate-600" />
                              )}
                            </React.Fragment>
                          ))}
                          {stepCount > 3 && (
                            <>
                              <ArrowRight size={10} className="text-slate-600" />
                              <span className="text-[9px] text-slate-500 font-mono">+ {stepCount - 3} {t('admin:workflows_tab.more_steps', { defaultValue: 'weitere' })}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end border-t border-white/5 sm:border-0 pt-3 sm:pt-0">
                        {confirmDeleteId === workflow.id_uuid ? (
                          <div className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/20 px-2.5 py-1.5 rounded-xl">
                            <span className="text-[10px] text-red-500 font-extrabold uppercase tracking-widest pl-1">Sicher?</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteWorkflowMutation.mutate({ id_uuid: workflow.id_uuid });
                                setConfirmDeleteId(null);
                              }}
                              className="px-2.5 py-1 bg-red-500 hover:bg-red-650 text-white rounded-lg text-[10px] font-bold uppercase transition-all"
                            >
                              Ja
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDeleteId(null);
                              }}
                              className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-[10px] font-bold uppercase transition-all"
                            >
                              Nein
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDuplicate(workflow);
                              }}
                              className="p-2 border border-white/5 text-slate-500 hover:text-accent-blue hover:bg-accent-blue/5 rounded-xl transition-all"
                              title={t('admin:workflows_tab.duplicate_tooltip', { defaultValue: 'Workflow duplizieren' })}
                            >
                              <Copy size={14} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartEdit(workflow);
                              }}
                              className="p-2 border border-white/5 text-slate-500 hover:text-accent-orange hover:bg-accent-orange/5 rounded-xl transition-all"
                              title={t('admin:workflows_tab.edit_tooltip', { defaultValue: 'Workflow bearbeiten' })}
                            >
                              <Edit size={14} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDeleteId(workflow.id_uuid);
                              }}
                              className="p-2 border border-white/5 text-slate-500 hover:text-red-500 hover:bg-red-500/5 rounded-xl transition-all"
                              title={t('admin:workflows_tab.delete_tooltip', { defaultValue: 'Workflow löschen' })}
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Details / Flow Inspector Pane */}
          <div className="lg:col-span-1">
            <div className="bg-primary-light/10 border border-white/5 rounded-3xl p-6 sticky top-6 space-y-6">
              <h4 className="text-xs font-black uppercase tracking-widest text-slate-400 font-display border-b border-white/5 pb-3 flex items-center gap-1.5">
                <Play size={14} className="text-accent-orange" />
                {t('admin:workflows_tab.inspector_title', { defaultValue: 'Ablaufs-Inspektor (Tool Chain Flow)' })}
              </h4>

              {selectedWorkflowForDetails ? (
                (() => {
                  const wf = selectedWorkflowForDetails;
                  let stepsList: ToolChainStep[] = [];
                  if (Array.isArray(wf.tool_chain_sequence)) {
                    stepsList = sanitizeSteps(wf.tool_chain_sequence);
                  } else if (typeof wf.tool_chain_sequence === 'string') {
                    try {
                      stepsList = sanitizeSteps(JSON.parse(wf.tool_chain_sequence));
                    } catch (_) {}
                  }

                  return (
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <p className="text-[10px] text-slate-500 font-mono leading-none">
                          {t('admin:workflows_tab.id_label', { defaultValue: 'Workflow-ID' }).replace(' / Name *', '')}
                        </p>
                        <h5 className="text-base font-black text-white font-mono break-all">{wf.workflow_name}</h5>
                        <p className="text-xs text-slate-300 leading-relaxed font-sans">{wf.workflow_description}</p>
                      </div>

                      {/* Timeline Steps visual flowchart */}
                      <div className="space-y-4 pt-2">
                        <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest font-display">
                          {t('admin:workflows_tab.timeline_sequence', { defaultValue: 'Sequenz-Kette' })}
                        </p>
                        
                        <div className="relative pl-5 border-l border-white/10 space-y-6 ml-2.5">
                          {stepsList.map((st, sIdx) => (
                            <div key={sIdx} className="relative">
                              {/* Step Node Dot */}
                              <span className="absolute -left-[27px] top-1.5 w-3.5 h-3.5 rounded-full bg-accent-orange border-2 border-primary-dark flex items-center justify-center text-[7px] text-white font-bold" />
                              
                              <div className="space-y-1 font-sans">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-bold text-white">
                                    {t('admin:workflows_tab.step_badge', { defaultValue: 'Schritt' })} {sIdx + 1}:
                                  </span>
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider font-mono border ${getToolBadgeStyle(st?.tool || '')}`}>
                                    {getToolLabel(st?.tool || '')}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-400 font-medium leading-relaxed italic bg-primary-dark/40 border border-white/5 p-2.5 rounded-xl">
                                  "{st?.instruction || ''}"
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Trigger Configuration Section */}
                      <div className="space-y-4 border-t border-white/5 pt-6 font-sans">
                        <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest font-display flex items-center gap-1.5">
                          <Zap size={10} className="text-accent-orange font-bold" />
                          {t('admin:workflows_tab.automation_title', { defaultValue: 'Automatisierung & Trigger' })}
                        </p>

                        <div className="space-y-4 bg-primary-dark/30 border border-white/5 p-4 rounded-2xl">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-300">
                              {t('admin:workflows_tab.activity_status', { defaultValue: 'Aktivitätsstatus' })}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const newStatus = wf.is_active === false ? true : false;
                                toggleWorkflowStatusMutation.mutate({ id_uuid: wf.id_uuid, is_active: newStatus });
                              }}
                              disabled={toggleWorkflowStatusMutation.isPending}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[10px] font-black uppercase tracking-wider font-display transition-all ${wf.is_active !== false ? 'bg-green-500/10 border-green-500/20 text-green-400 hover:bg-green-500/20' : 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'}`}
                            >
                              {wf.is_active !== false ? <Check size={12} /> : <X size={12} />}
                              {wf.is_active !== false ? t('admin:workflows_tab.active_label', { defaultValue: 'Aktiv' }) : t('admin:workflows_tab.inactive_label', { defaultValue: 'Inaktiv' })}
                            </button>
                          </div>

                          {stepsList.some(s => s?.tool === 'executeSendSmtpEmail' || s?.tool === 'send_smtp_email') && (
                            <div className="flex items-center justify-between border-t border-white/5 pt-3">
                              <span className="text-xs font-semibold text-slate-300">
                                {t('admin:workflows_tab.email_approval_label', { defaultValue: 'E-Mail-Freigabe' })}
                              </span>
                              <span className={`px-3 py-1.5 rounded-xl border text-[10px] font-black uppercase tracking-wider font-display ${wf.direct_send_email === true ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' : 'bg-slate-500/10 border-white/5 text-slate-400'}`}>
                                {wf.direct_send_email === true 
                                  ? t('admin:workflows_tab.send_direct_label', { defaultValue: 'Direkt Senden' }) 
                                  : t('admin:workflows_tab.draft_approval_label', { defaultValue: 'Entwurf (Freigabe)' })}
                              </span>
                            </div>
                          )}

                          <div className="space-y-1">
                            <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                              {t('admin:workflows_tab.start_condition_label', { defaultValue: 'Start-Bedingung' })}
                            </label>
                            <select
                              value={triggerType}
                              onChange={(e) => {
                                const val = e.target.value as any;
                                setTriggerType(val);
                                if (val === 'MANUAL') setTriggerConfig({});
                                else if (val === 'CRM_EVENT') setTriggerConfig({ event_name: 'contact.created', delay_seconds: 0 });
                                else if (val === 'TIMER') setTriggerConfig({ frequency: 'daily', time: '08:30' });
                              }}
                              className="w-full bg-primary-dark border border-white/5 p-2.5 rounded-xl text-xs text-white focus:outline-none focus:border-accent-orange/30 font-semibold"
                            >
                              <option value="MANUAL">{t('admin:workflows_tab.manual_trigger_option', { defaultValue: 'Manuell ausführen ( LOUIS Chat )' })}</option>
                              <option value="CRM_EVENT">{t('admin:workflows_tab.event_trigger_option', { defaultValue: 'Ereignis-gesteuert ( CRM Event )' })}</option>
                              <option value="TIMER">{t('admin:workflows_tab.timer_trigger_option', { defaultValue: 'Zeitgesteuert ( Scheduler )' })}</option>
                            </select>
                          </div>

                          {triggerType === 'CRM_EVENT' && (
                            <div className="space-y-3 pt-2 border-t border-white/5">
                              <div className="space-y-1">
                                <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                                  {t('admin:workflows_tab.crm_event_label', { defaultValue: 'CRM Ereignis' })}
                                </label>
                                <select
                                  value={triggerConfig.event_name || 'contact.created'}
                                  onChange={(e) => setTriggerConfig({ ...triggerConfig, event_name: e.target.value })}
                                  className="w-full bg-primary-dark border border-white/5 p-2.5 rounded-xl text-xs text-white focus:outline-none focus:border-accent-orange/30 font-semibold"
                                >
                                  <option value="contact.created">{t('admin:workflows_tab.event_contact_created_option', { defaultValue: 'Neuer Kontakt angelegt' })}</option>
                                  <option value="company.created">{t('admin:workflows_tab.event_company_created_option', { defaultValue: 'Neues Unternehmen angelegt' })}</option>
                                  <option value="invoice.created">{t('admin:workflows_tab.event_invoice_created_option', { defaultValue: 'Rechnung wurde erstellt' })}</option>
                                  <option value="invoice.finalized">{t('admin:workflows_tab.event_invoice_finalized_option', { defaultValue: 'Rechnung wurde final gebucht/abgeschlossen' })}</option>
                                  <option value="invoice.paid">{t('admin:workflows_tab.event_invoice_paid_option', { defaultValue: 'Rechnung wurde bezahlt' })}</option>
                                  <option value="invoice.overdue">{t('admin:workflows_tab.event_invoice_overdue_option', { defaultValue: 'Rechnung ist überfällig' })}</option>
                                  <option value="contact.updated">{t('admin:workflows_tab.event_contact_updated_option', { defaultValue: 'Kontakt wurde aktualisiert' })}</option>
                                  <option value="company.updated">{t('admin:workflows_tab.event_company_updated_option', { defaultValue: 'Unternehmen wurde aktualisiert' })}</option>
                                </select>
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                                  {t('admin:workflows_tab.delay_seconds_label', { defaultValue: 'Verzögerung (Sekunden)' })}
                                </label>
                                <input
                                  type="number"
                                  min="0"
                                  value={triggerConfig.delay_seconds || 0}
                                  onChange={(e) => setTriggerConfig({ ...triggerConfig, delay_seconds: parseInt(e.target.value || '0', 10) })}
                                  className="w-full bg-primary-dark border border-white/5 p-2.5 rounded-xl text-xs text-white focus:outline-none focus:border-accent-orange/30 font-mono font-semibold"
                                />
                              </div>
                            </div>
                          )}

                          {triggerType === 'TIMER' && (
                            <div className="space-y-3 pt-2 border-t border-white/5">
                              <div className="space-y-1">
                                <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                                  {t('admin:workflows_tab.frequency_label', { defaultValue: 'Frequenz' })}
                                </label>
                                <select
                                  value={triggerConfig.frequency || 'daily'}
                                  onChange={(e) => setTriggerConfig({ ...triggerConfig, frequency: e.target.value })}
                                  className="w-full bg-primary-dark border border-white/5 p-2.5 rounded-xl text-xs text-white focus:outline-none focus:border-accent-orange/30 font-semibold"
                                >
                                  <option value="hourly">{t('admin:workflows_tab.frequency_hourly_option', { defaultValue: 'Stündlich ausführen' })}</option>
                                  <option value="daily">{t('admin:workflows_tab.frequency_daily_option', { defaultValue: 'Täglich ausführen' })}</option>
                                </select>
                              </div>
                              {triggerConfig.frequency !== 'hourly' && (
                                <div className="space-y-1">
                                  <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                                    {t('admin:workflows_tab.run_at_time_label', { defaultValue: 'Ausführen um (Uhrzeit HH:MM)' })}
                                  </label>
                                  <input
                                    type="text"
                                    placeholder="08:30"
                                    value={triggerConfig.time || '08:30'}
                                    onChange={(e) => setTriggerConfig({ ...triggerConfig, time: e.target.value })}
                                    className="w-full bg-primary-dark border border-white/5 p-2.5 rounded-xl text-xs text-white focus:outline-none focus:border-accent-orange/30 font-mono font-semibold"
                                  />
                                </div>
                              )}
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() => updateTriggerMutation.mutate({ id_uuid: wf.id_uuid, trigger_type: triggerType, trigger_config: triggerConfig })}
                            disabled={updateTriggerMutation.isPending}
                            className="w-full mt-2 py-2 bg-accent-blue hover:bg-accent-blue/80 text-white text-[10px] font-black uppercase tracking-wider font-display rounded-xl transition-all cursor-pointer"
                          >
                            {updateTriggerMutation.isPending 
                              ? t('dashboard:pending_approvals_banner.saving', { defaultValue: 'Speichert...' }) 
                              : t('admin:workflows_tab.save_trigger_btn', { defaultValue: 'Trigger-Einstellungen speichern' })}
                          </button>
                        </div>
                      </div>

                      {/* Meta information */}
                      <div className="border-t border-white/5 pt-4 text-[10px] font-mono text-slate-500 space-y-1">
                        {wf.created_at_utc && (
                          <div className="flex justify-between">
                            <span>{t('admin:workflows_tab.meta_created', { defaultValue: 'Angelegt am:' })}</span>
                            <span>{new Date(wf.created_at_utc).toLocaleDateString()}</span>
                          </div>
                        )}
                        {wf.updated_at_utc && (
                          <div className="flex justify-between">
                            <span>{t('admin:workflows_tab.meta_modified', { defaultValue: 'Zuletzt geändert:' })}</span>
                            <span>{new Date(wf.updated_at_utc).toLocaleDateString()}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span>{t('admin:workflows_tab.meta_author', { defaultValue: 'Urheber:' })}</span>
                          <span className="text-accent-blue">{wf.created_by_identity || 'ai_assistant'}</span>
                        </div>
                      </div>

                      {/* Execute Now Button */}
                      <button
                        type="button"
                        onClick={() => triggerWorkflowMutation.mutate({ id_uuid: wf.id_uuid })}
                        disabled={triggerWorkflowMutation.isPending}
                        className="w-full py-3 bg-gradient-to-r from-accent-orange to-amber-500 hover:from-accent-orange/90 hover:to-amber-500/90 text-white text-[11px] font-black uppercase tracking-wider font-display rounded-xl transition-all cursor-pointer shadow-lg shadow-accent-orange/10 flex items-center justify-center gap-2"
                      >
                        <Play size={12} fill="white" />
                        {triggerWorkflowMutation.isPending 
                          ? t('common:loading', { defaultValue: 'Wird ausgeführt...' }) 
                          : t('admin:workflows_tab.execute_now_btn', { defaultValue: 'Workflow jetzt ausführen (Hintergrund)' })}
                      </button>

                      <div className="flex gap-2 items-center">
                        {confirmDeleteId === wf.id_uuid ? (
                          <div className="flex-1 flex items-center justify-between gap-1.5 bg-red-500/10 border border-red-500/20 p-2 rounded-xl">
                            <span className="text-[10px] text-red-500 font-extrabold uppercase tracking-widest pl-1">Sicher?</span>
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => {
                                  deleteWorkflowMutation.mutate({ id_uuid: wf.id_uuid });
                                  setConfirmDeleteId(null);
                                }}
                                className="px-2.5 py-1 bg-red-500 hover:bg-red-650 text-white rounded-lg text-[10px] font-bold uppercase transition-all"
                              >
                                Ja
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-2.5 py-1 bg-slate-700 hover:bg-slate-650 text-slate-200 rounded-lg text-[10px] font-bold uppercase transition-all"
                              >
                                Nein
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => handleDuplicate(wf)}
                              className="px-3 py-2.5 border border-white/5 hover:border-accent-blue/20 hover:text-accent-blue transition-all rounded-xl text-slate-500"
                              title={t('admin:workflows_tab.duplicate_tooltip', { defaultValue: 'Workflow duplizieren' })}
                            >
                              <Copy size={14} />
                            </button>
                            <button
                              onClick={() => handleStartEdit(wf)}
                              className="flex-1 py-2.5 border border-white/5 hover:border-accent-orange/20 text-slate-300 hover:text-accent-orange transition-all text-[10px] font-black uppercase tracking-wider font-display rounded-xl"
                            >
                              {t('common:edit', { defaultValue: 'Bearbeiten' })}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(wf.id_uuid)}
                              className="px-3 py-2.5 border border-white/5 hover:text-red-500 hover:bg-red-500/5 transition-all rounded-xl text-slate-500"
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="py-20 text-center border border-dashed border-white/10 rounded-2xl">
                  <Cpu className="text-slate-600 mx-auto opacity-40 mb-3" size={24} />
                  <p className="text-xs text-slate-500 italic max-w-[180px] mx-auto leading-relaxed">
                    {t('admin:workflows_tab.inspector_empty', { defaultValue: 'Wählen Sie einen Workflow aus der Liste aus, um die detaillierte Kette und Handlungsabläufe im Inspektor zu indizieren.' })}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Historical Audit Trail of executions across entire workspace */}
          <div className="lg:col-span-3 mt-12 bg-primary-light/5 border border-white/5 rounded-3xl p-8 space-y-8">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="flex items-center gap-4">
                <div className="p-4 bg-accent-blue/10 border border-accent-blue/20 rounded-2xl text-accent-blue shadow-lg">
                  <Activity size={24} className="animate-pulse" />
                </div>
                <div>
                  <h4 className="text-xl font-black text-white uppercase italic tracking-tight font-display">
                    Automations-Protokoll & Live-Audit Trail
                  </h4>
                  <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wide">
                    Echtzeit-Durchführungsprotokoll und detaillierte Kettenschritt-Analytik (10s Polling)
                  </p>
                </div>
              </div>
              <button 
                type="button"
                onClick={refetchInstances}
                className="px-4 py-2 bg-primary-dark hover:bg-primary-dark/80 border border-white/5 text-slate-300 font-black font-display uppercase tracking-wider text-[9px] rounded-xl transition-all cursor-pointer"
              >
                Aktualisieren
              </button>
            </div>

            {instances.length === 0 ? (
              <div className="py-16 text-center border border-dashed border-white/10 rounded-2xl bg-primary-dark/20">
                <Clock className="text-slate-600 mx-auto opacity-30 mb-2 animate-spin-slow" size={32} />
                <p className="text-xs text-slate-500 italic max-w-sm mx-auto leading-relaxed">
                  Bislang liegen keine Live-Ausführungsprotokolle für diesen Tenant vor. Sobald Workflows per Chat oder System-Events getriggert werden, erscheinen Protokolle hier.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {instances.map((inst: WorkflowInstance) => {
                  const template = workflows.find((w: Workflow) => w.id_uuid === inst.workflow_id);
                  const wfName = template ? template.workflow_name : (inst.workflow_id || 'System-Workflow');
                  const isExpanded = expandedInstanceId === inst.id_uuid;
                  
                  return (
                    <div 
                      key={inst.id_uuid} 
                      className={`border rounded-2xl overflow-hidden transition-all duration-300 shadow-lg ${isExpanded ? 'bg-primary-dark/50 border-accent-blue/30' : 'bg-primary-light/10 border-white/5 hover:bg-primary-light/15 hover:border-white/10'}`}
                    >
                      {/* Accordion Row Header */}
                      <div 
                        onClick={() => setExpandedInstanceId(isExpanded ? null : inst.id_uuid)}
                        className="p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 cursor-pointer select-none"
                      >
                        <div className="flex items-center gap-4">
                          <div className="font-sans">
                            <h5 className="text-sm font-black text-white font-mono break-all leading-tight">
                              {wfName}
                            </h5>
                            <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[10px] font-mono text-slate-500">
                              <span>ID: {inst.id_uuid.substring(0, 8)}...</span>
                              <span>•</span>
                              <span>Unternehmer-Ident: {inst.tenant_id ? inst.tenant_id.substring(0, 8) : 'sys_tenant'}...</span>
                              <span>•</span>
                              <span>Zeit: {inst.created_at_utc ? new Date(inst.created_at_utc).toLocaleString() : ''}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 self-stretch md:self-auto justify-between md:justify-end">
                          {/* Status Badge */}
                          {inst.status === 'RUNNING' && (
                            <span className="px-2.5 py-1 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-[8px] font-black rounded-lg uppercase tracking-wider font-mono">
                              ⏳ In Arbeit
                            </span>
                          )}
                          {inst.status === 'WAITING_FOR_DRAFT_APPROVAL' && (
                            <span className="px-2.5 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[8px] font-black rounded-lg uppercase tracking-wider font-mono">
                              🟠 Freigabe ausstehend
                            </span>
                          )}
                          {inst.status === 'PENDING_DELAY' && (
                            <span className="px-2.5 py-1 bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[8px] font-black rounded-lg uppercase tracking-wider font-mono">
                              🟣 Verzögert
                            </span>
                          )}
                          {inst.status === 'COMPLETED' && (
                            <span className="px-2.5 py-1 bg-green-500/10 border border-green-500/20 text-green-400 text-[8px] font-black rounded-lg uppercase tracking-wider font-mono">
                              🟢 Abgeschlossen
                            </span>
                          )}
                          {inst.status === 'FAILED' && (
                            <span className="px-2.5 py-1 bg-red-500/10 border border-red-500/20 text-red-400 text-[8px] font-black rounded-lg uppercase tracking-wider font-mono">
                              🔴 Fehlgeschlagen
                            </span>
                          )}

                          <span className="text-[10px] font-mono text-slate-400 font-bold bg-primary-dark/60 px-2 py-1 rounded-lg border border-white/5">
                            Schritt {inst.current_step_index + 1}
                          </span>

                          <button type="button" className="text-slate-500 hover:text-white p-1 transition-all">
                            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </button>
                        </div>
                      </div>

                      {/* Expanded Details and Log Payload timeline */}
                      {isExpanded && (
                        <div className="border-t border-white/5 bg-primary-dark/25 p-6 font-sans space-y-6">
                          <div>
                            <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest font-display mb-2">Auslösender Event-Payload</p>
                            <pre className="bg-primary-dark/80 p-4 rounded-xl border border-white/5 text-[10px] font-mono text-slate-400 overflow-x-auto max-h-[160px] shadow-inner">
                              {JSON.stringify(inst.initial_payload || {}, null, 2)}
                            </pre>
                          </div>

                          <div className="space-y-4">
                            <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest font-display">Aktivitätsprotokoll & Timeline-Details</p>
                            
                            <div className="space-y-4 relative pl-4 border-l border-white/10 ml-2">
                              {(() => {
                                let logsList: WorkflowExecutionLogEntry[] = [];
                                if (Array.isArray(inst.execution_log)) {
                                  logsList = inst.execution_log;
                                } else if (typeof inst.execution_log === 'string') {
                                  try {
                                    logsList = JSON.parse(inst.execution_log);
                                  } catch (_) {}
                                }

                                if (logsList.length === 0) {
                                  return (
                                    <p className="text-xs text-slate-500 italic">Noch keine Schritte verarbeitet.</p>
                                  );
                                }

                                return logsList.map((log: WorkflowExecutionLogEntry, lIdx: number) => (
                                  <div key={lIdx} className="relative">
                                    <span className="absolute -left-[23px] top-1.5 w-2.5 h-2.5 rounded-full bg-accent-blue ring-4 ring-primary-dark" />
                                    <div className="bg-primary-dark/60 border border-white/5 p-4 rounded-xl space-y-2">
                                      <div className="flex justify-between items-center flex-wrap gap-2">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="text-xs font-bold text-white">
                                            Schritt {lIdx + 1}: {typeof log.tool === 'string' ? log.tool.replace('execute', 'LOUIS ') : (log.step || 'Aktion')}
                                          </span>
                                          {log.mailing_status && (
                                            <span className="text-[8px] font-mono px-1.5 py-0.5 bg-accent-blue/10 text-accent-blue border border-accent-blue/20 rounded font-bold">Mail</span>
                                          )}
                                          {log.label_status && (
                                            <span className="text-[8px] font-mono px-1.5 py-0.5 bg-green-500/10 text-green-400 border border-green-500/20 rounded font-bold">Label</span>
                                          )}
                                          {log.note_status && (
                                            <span className="text-[8px] font-mono px-1.5 py-0.5 bg-slate-500/10 text-slate-400 border border-white/5 rounded font-bold">Note</span>
                                          )}
                                        </div>
                                        <span className="text-[8px] font-mono text-slate-500">
                                          {log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : ''}
                                        </span>
                                      </div>

                                      {log.instruction && (
                                        <p className="text-xs text-slate-400 italic">
                                          "{log.instruction}"
                                        </p>
                                      )}

                                      {log.outputs?.text && (
                                        <div className="bg-primary-dark/90 p-3.5 rounded-lg border border-white/5 mt-2 text-xs text-slate-300 font-normal leading-relaxed whitespace-pre-wrap shadow-inner font-mono">
                                          {log.outputs.text}
                                        </div>
                                      )}

                                      {log.mailing_status && (
                                        <p className="text-[10px] font-mono text-accent-blue leading-tight bg-accent-blue/5 p-2 rounded border border-accent-blue/10">
                                          📬 {log.mailing_status}
                                        </p>
                                      )}
                                      {log.label_status && (
                                        <p className="text-[10px] font-mono text-green-400 leading-tight bg-green-500/5 p-2 rounded border border-green-500/10">
                                          🏷️ {log.label_status}
                                        </p>
                                      )}
                                      {log.note_status && (
                                        <p className="text-[10px] font-mono text-slate-400 leading-tight bg-white/5 p-2 rounded border border-white/5">
                                          📝 {log.note_status}
                                        </p>
                                      )}
                                      
                                      {log.mailing_error && (
                                        <p className="text-[10px] font-mono text-red-400 leading-tight bg-red-500/5 p-2 rounded border border-red-500/10">
                                          ❌ E-Mail-Fehler: {log.mailing_error}
                                        </p>
                                      )}
                                      {log.label_error && (
                                        <p className="text-[10px] font-mono text-red-400 leading-tight bg-red-500/5 p-2 rounded border border-red-500/10">
                                          ❌ Label-Fehler: {log.label_error}
                                        </p>
                                      )}
                                      {log.note_error && (
                                        <p className="text-[10px] font-mono text-red-400 leading-tight bg-red-500/5 p-2 rounded border border-red-500/10">
                                          ❌ Notiz-Fehler: {log.note_error}
                                        </p>
                                      )}

                                      {log.details && (
                                        <p className="text-xs text-slate-300 font-normal leading-relaxed">
                                          {log.details}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                ));
                              })()}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Variables Help Modal */}
      {showVariablesHelp && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-[9999] flex items-center justify-center p-4">
          <div 
            className="bg-primary-dark/95 border border-white/10 rounded-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Glowing visual effect */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-accent-blue via-accent-orange to-accent-blue" />
            
            {/* Header */}
            <div className="p-6 border-b border-white/5 flex justify-between items-start gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-accent-blue/10 rounded-xl border border-accent-blue/20 text-accent-blue">
                  <Info size={22} />
                </div>
                <div>
                  <h4 className="text-xl font-black text-white uppercase tracking-wider font-display">
                    {t('admin:workflows_tab.variables_helper.title', { defaultValue: 'Ablaufs- & Vorlagen-Variablen' })}
                  </h4>
                  <p className="text-slate-400 text-xs mt-1">
                    {t('admin:workflows_tab.variables_helper.desc', { defaultValue: 'Diese Variablen können in E-Mail-Vorlagen, Signaturen oder direkt in den Handlungsanweisungen Ihrer Workflows verwendet werden.' })}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowVariablesHelp(false)}
                className="p-2 border border-white/5 text-slate-500 hover:text-white hover:bg-white/5 rounded-xl transition-all cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal content area with scrollbar */}
            <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
              {/* Section 1: Trigger & Event-Daten and Sequence Context */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Trigger Panel */}
                <div className="bg-primary-light/10 border border-white/5 p-5 rounded-2xl space-y-4">
                  <div className="border-b border-white/5 pb-2">
                    <h5 className="text-[11px] font-black uppercase tracking-widest text-accent-orange font-display">
                      ⚡ {t('admin:workflows_tab.variables_helper.sections.trigger', { defaultValue: 'Ereignis- & Trigger-Daten (CRM-Events)' })}
                    </h5>
                    <p className="text-[10px] text-slate-500 font-sans italic mt-1">
                      {t('admin:workflows_tab.variables_helper.sections.trigger_desc', { defaultValue: 'Variablen aus dem auslösenden Ereignis des Workflows.' })}
                    </p>
                  </div>

                  <div className="space-y-4">
                    {[
                      { tag: '{{event_name}}', desc: t('admin:workflows_tab.variables_helper.items.event_name', { defaultValue: 'Der Name des auslösenden Events (z.B. contact.created)' }) },
                      { tag: '{{id_uuid}}', desc: t('admin:workflows_tab.variables_helper.items.id_uuid', { defaultValue: 'Die eindeutige ID des betroffenen CRM-Datensatzes' }) }
                    ].map((item) => (
                      <div key={item.tag} className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(item.tag);
                            toast.success(t('admin:workflows_tab.variables_helper.items.copied', { defaultValue: 'Variable in die Zwischenablage kopiert!' }) + ' -> ' + item.tag);
                          }}
                          className="self-start px-2 py-1 bg-primary-dark border border-white/10 hover:border-accent-orange/30 hover:bg-white/5 rounded-lg text-xs font-mono font-bold text-accent-orange/90 transition-all flex items-center gap-1.5 cursor-pointer"
                          title={t('common:copy_to_clipboard', { defaultValue: 'In die Zwischenablage kopieren' })}
                        >
                          {item.tag}
                        </button>
                        <span className="text-xs text-slate-400 font-sans pl-1">{item.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Sequence & Context Transfer Panel */}
                <div className="bg-primary-light/10 border border-white/5 p-5 rounded-2xl space-y-4">
                  <div className="border-b border-white/5 pb-2">
                    <h5 className="text-[11px] font-black uppercase tracking-widest text-accent-blue font-display">
                      🧠 {t('admin:workflows_tab.variables_helper.sections.sequence', { defaultValue: 'Sequenzübergreifende Variablen (ReAct Agent)' })}
                    </h5>
                    <p className="text-[10px] text-slate-500 font-sans italic mt-1">
                      {t('admin:workflows_tab.variables_helper.sections.sequence_desc', { defaultValue: 'Unterstützung für den Datentransfer in intelligenten Tool-Ketten.' })}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-1.5 self-start px-2 py-1 bg-primary-dark border border-white/10 rounded-lg text-xs font-mono font-bold text-accent-blue/90">
                      {t('admin:workflows_tab.variables_helper.items.step_context_badge', { defaultValue: 'Workflow-Gedächtnis / Step Memory' })}
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed font-sans pl-1">
                      {t('admin:workflows_tab.variables_helper.items.sequence_memory', { defaultValue: 'Der ReAct-Agent behält die Antworten aus vorherigen Schritten (z.B. Websuche oder CRM Data Analyst) automatisch im Gedächtnis, sodass Sie sich im nächsten Schritt per Freitext-Prompt direkt darauf beziehen können (z.B. "Schreibe eine E-Mail basierend auf den im vorherigen Schritt gefundenen Informationen").' })}
                    </p>
                  </div>
                </div>
              </div>

              {/* Section 2: Mailing & Template Placeholders */}
              <div className="bg-primary-light/10 border border-white/5 p-5 rounded-2xl space-y-4">
                <div className="border-b border-white/5 pb-2">
                  <h5 className="text-[11px] font-black uppercase tracking-widest text-[#a855f7] font-display">
                    📨 {t('admin:workflows_tab.variables_helper.sections.templates', { defaultValue: 'E-Mail- & Rechnungsdaten (Mailing-Vorlagen)' })}
                  </h5>
                  <p className="text-[10px] text-slate-500 font-sans italic mt-1">
                    {t('admin:workflows_tab.variables_helper.sections.templates_desc', { defaultValue: 'Platzhalter, die in E-Mail-Texten, Betreffzeilen und Signaturen verwendet werden können.' })}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {[
                    { tag: '{{invoice_number}}', desc: t('admin:workflows_tab.variables_helper.items.invoice_number', { defaultValue: 'Die Rechnungsnummer (z.B. RE-2026-0001)' }) },
                    { tag: '{{due_date}}', desc: t('admin:workflows_tab.variables_helper.items.due_date', { defaultValue: 'Das Fälligkeitsdatum der Rechnung' }) },
                    { tag: '{{total_gross}}', desc: t('admin:workflows_tab.variables_helper.items.total_gross', { defaultValue: 'Der Rechnungs-Bruttobetrag' }) },
                    { tag: '{{currency}}', desc: t('admin:workflows_tab.variables_helper.items.currency', { defaultValue: 'Die Währung (z.B. EUR)' }) },
                    { tag: '{{my_company_name}}', desc: t('admin:workflows_tab.variables_helper.items.my_company_name', { defaultValue: 'Der Name Ihres eigenen angemeldeten Unternehmens' }) },
                    { tag: '{{my_contact_person}}', desc: t('admin:workflows_tab.variables_helper.items.my_contact_person', { defaultValue: 'Der Name des zuständigen Ansprechpartners' }) },
                    { tag: '{{recipient_name}}', desc: t('admin:workflows_tab.variables_helper.items.recipient_name', { defaultValue: 'Vollständiger Name des Empfängers (Vor- und Nachname)' }) },
                    { tag: '{{recipient_first_name}}', desc: t('admin:workflows_tab.variables_helper.items.recipient_first_name', { defaultValue: 'Vorname des Empfängers' }) },
                    { tag: '{{recipient_last_name}}', desc: t('admin:workflows_tab.variables_helper.items.recipient_last_name', { defaultValue: 'Nachname des Empfängers' }) },
                    { tag: '{{recipient_salutation}}', desc: t('admin:workflows_tab.variables_helper.items.recipient_salutation', { defaultValue: 'Automatische, formelle Anrede (Sehr geehrte(r) Frau/Herr...)' }) },
                    { tag: '{{recipient_company}}', desc: t('admin:workflows_tab.variables_helper.items.recipient_company', { defaultValue: 'Firmenname des Empfängerunternehmens' }) },
                    { tag: '{{recipient_street}}', desc: t('admin:workflows_tab.variables_helper.items.recipient_street', { defaultValue: 'Straße und Hausnummer des Empfängers' }) },
                    { tag: '{{recipient_city}}', desc: t('admin:workflows_tab.variables_helper.items.recipient_city', { defaultValue: 'Ort/Stadt' }) },
                    { tag: '{{recipient_postal_code}}', desc: t('admin:workflows_tab.variables_helper.items.recipient_postal_code', { defaultValue: 'Postleitzahl' }) },
                    { tag: '{{recipient_address}}', desc: t('admin:workflows_tab.variables_helper.items.recipient_address', { defaultValue: 'Mehrzeiliger, formatierter Adressblock' }) },
                    { tag: '{{recipient_email}}', desc: t('admin:workflows_tab.variables_helper.items.recipient_email', { defaultValue: 'E-Mail-Adresse des Kontakts' }) },
                    { tag: '{{recipient_phone}}', desc: t('admin:workflows_tab.variables_helper.items.recipient_phone', { defaultValue: 'Telefonnummer des Kontakts' }) }
                  ].map((item) => (
                    <div key={item.tag} className="bg-primary-dark/40 border border-white/5 p-3 rounded-xl flex flex-col gap-1 hover:border-white/10 hover:bg-primary-dark/60 transition-colors">
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(item.tag);
                          toast.success(t('admin:workflows_tab.variables_helper.items.copied', { defaultValue: 'Variable in die Zwischenablage kopiert!' }) + ' -> ' + item.tag);
                        }}
                        className="self-start px-2 py-0.5 bg-primary-dark border border-white/10 hover:border-[#a855f7]/40 hover:bg-white/5 rounded-lg text-xs font-mono font-bold text-[#c084fc] transition-all flex items-center gap-1.5 cursor-pointer"
                        title={t('common:copy_to_clipboard', { defaultValue: 'In die Zwischenablage kopieren' })}
                      >
                        {item.tag}
                      </button>
                      <span className="text-[11px] text-slate-400 font-sans leading-relaxed">{item.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 bg-primary-dark border-t border-white/5 flex justify-end">
              <button
                type="button"
                onClick={() => setShowVariablesHelp(false)}
                className="px-5 py-2.5 bg-primary-light/30 border border-white/10 hover:bg-primary-light/50 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer"
              >
                {t('common:close', { defaultValue: 'Schließen' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
