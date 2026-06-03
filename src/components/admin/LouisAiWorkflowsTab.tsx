import React, { useState } from 'react';
import { trpc } from '../../lib/trpc';
import { toast } from 'sonner';
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
  Sparkles
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ToolChainStep {
  tool: string;
  instruction: string;
}

interface Workflow {
  id_uuid: string;
  workflow_name: string;
  workflow_description: string;
  tool_chain_sequence: ToolChainStep[];
  created_by_identity?: string;
  created_at_utc?: string;
  updated_at_utc?: string;
}


export const LouisAiWorkflowsTab = () => {
  const { t } = useTranslation(['admin', 'common']);
  const utils = trpc.useContext();
  const [searchTerm, setSearchTerm] = useState('');
  
  // Tab state
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedWorkflowForDetails, setSelectedWorkflowForDetails] = useState<Workflow | null>(null);

  // Form states (Create / Edit)
  const [workflowName, setWorkflowName] = useState('');
  const [workflowDescription, setWorkflowDescription] = useState('');
  const [toolChain, setToolChain] = useState<ToolChainStep[]>([
    { tool: 'executeCrmDataAnalyst', instruction: '' }
  ]);

  // Queries
  const { data: workflows = [], isLoading, refetch } = trpc.getWorkflows.useQuery();

  // Mutations
  const learnWorkflowMutation = trpc.learnWorkflow.useMutation({
    onSuccess: () => {
      toast.success(t('admin:toast_success_workflow', { defaultValue: 'Workflow erfolgreich gespeichert!' }));
      resetForm();
      utils.getWorkflows.invalidate();
      refetch();
    },
    onError: (err) => {
      toast.error(t('admin:toast_error_workflow', { defaultValue: 'Fehler beim Speichern des Workflows: ' }) + err.message);
    }
  });

  const deleteWorkflowMutation = trpc.deleteWorkflow.useMutation({
    onSuccess: () => {
      toast.success(t('admin:toast_success_delete_workflow', { defaultValue: 'Workflow erfolgreich gelöscht.' }));
      utils.getWorkflows.invalidate();
      refetch();
      if (selectedWorkflowForDetails) {
        setSelectedWorkflowForDetails(null);
      }
    },
    onError: (err) => {
      toast.error(t('admin:toast_error_delete_workflow', { defaultValue: 'Fehler beim Löschen des Workflows: ' }) + err.message);
    }
  });

  const resetForm = () => {
    setWorkflowName('');
    setWorkflowDescription('');
    setToolChain([{ tool: 'executeCrmDataAnalyst', instruction: '' }]);
    setEditingWorkflow(null);
    setIsCreating(false);
  };

  const handleStartCreate = () => {
    resetForm();
    setIsCreating(true);
  };

  const handleStartEdit = (workflow: Workflow) => {
    setEditingWorkflow(workflow);
    setWorkflowName(workflow.workflow_name);
    setWorkflowDescription(workflow.workflow_description || '');
    
    // Ensure tool chain is parsed correctly
    let parsedChain: ToolChainStep[] = [];
    if (Array.isArray(workflow.tool_chain_sequence)) {
      parsedChain = workflow.tool_chain_sequence;
    } else if (typeof workflow.tool_chain_sequence === 'string') {
      try {
        parsedChain = JSON.parse(workflow.tool_chain_sequence);
      } catch (e) {
        parsedChain = [];
      }
    }
    
    setToolChain(parsedChain.length > 0 ? parsedChain : [{ tool: 'executeCrmDataAnalyst', instruction: '' }]);
    setIsCreating(false);
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
      tool_chain_sequence: toolChain
    });
  };

  const handleDelete = (id: string, name: string) => {
    if (window.confirm(`Möchten Sie den Workflow "${name}" wirklich löschen?`)) {
      deleteWorkflowMutation.mutate({ id_uuid: id });
    }
  };

  // Filter workflows
  const filteredWorkflows = workflows.filter((w: Workflow) => 
    w.workflow_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    w.workflow_description.toLowerCase().includes(searchTerm.toLowerCase())
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

        {!isCreating && !editingWorkflow && (
          <button
            onClick={handleStartCreate}
            className="bg-gradient-to-tr from-accent-orange to-accent-orange/80 hover:scale-105 active:scale-95 transition-transform duration-300 text-white font-black uppercase text-[10px] tracking-widest px-5 py-3 rounded-xl flex items-center gap-2 shadow-lg hover:shadow-accent-orange/20 cursor-pointer text-center whitespace-nowrap self-stretch sm:self-auto"
          >
            <Plus size={14} />
            {t('admin:workflows_tab.new_btn', { defaultValue: 'Neuer Workflow' })}
          </button>
        )}
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
            <div className="flex justify-between items-center">
              <h5 className="text-xs font-black uppercase tracking-widest text-slate-400 font-display">
                {t('admin:workflows_tab.chain_title', { defaultValue: '📋 Ausführungskette (Tools & Anweisungen)' })}
              </h5>
              <button
                type="button"
                onClick={handleAddStep}
                className="text-accent-blue flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest font-display hover:text-white transition-colors"
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
                    </select>
                  </div>

                  {/* Instruction context */}
                  <div className="w-full md:flex-1 space-y-1.5">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest font-display">
                      {t('admin:workflows_tab.step_instruction_label', { defaultValue: 'Expliziter Prompt / Handlungsanweisung für diesen Schritt' })}
                    </label>
                    <input
                      type="text"
                      required
                      value={step.instruction}
                      onChange={(e) => handleStepChange(idx, 'instruction', e.target.value)}
                      placeholder={t('admin:workflows_tab.step_instruction_placeholder', { defaultValue: 'z.B. Hole alle ausstehenden Rechnungen mit dem Status \'pending\'' })}
                      className="w-full bg-primary-dark border border-white/5 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-accent-orange/40 transition-all font-sans"
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
                    parsedSteps = workflow.tool_chain_sequence;
                  } else if (typeof workflow.tool_chain_sequence === 'string') {
                    try {
                      parsedSteps = JSON.parse(workflow.tool_chain_sequence);
                    } catch (_) {}
                  }

                  const stepCount = parsedSteps.length;

                  return (
                    <div 
                      key={workflow.id_uuid}
                      onClick={() => setSelectedWorkflowForDetails(workflow)}
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
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed font-sans max-w-md">
                          {workflow.workflow_description}
                        </p>
                        
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          {parsedSteps.slice(0, 3).map((s, stepIdx) => (
                            <React.Fragment key={stepIdx}>
                              <span className={`text-[9px] px-2 py-0.5 rounded font-bold uppercase tracking-wider font-mono border ${getToolBadgeStyle(s.tool)}`}>
                                {s.tool.replace('execute', '')}
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
                            handleDelete(workflow.id_uuid, workflow.workflow_name);
                          }}
                          className="p-2 border border-white/5 text-slate-500 hover:text-red-500 hover:bg-red-500/5 rounded-xl transition-all"
                          title={t('admin:workflows_tab.delete_tooltip', { defaultValue: 'Workflow löschen' })}
                        >
                          <Trash2 size={14} />
                        </button>
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
                    stepsList = wf.tool_chain_sequence;
                  } else if (typeof wf.tool_chain_sequence === 'string') {
                    try {
                      stepsList = JSON.parse(wf.tool_chain_sequence);
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
                                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider font-mono border ${getToolBadgeStyle(st.tool)}`}>
                                    {getToolLabel(st.tool)}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-400 font-medium leading-relaxed italic bg-primary-dark/40 border border-white/5 p-2.5 rounded-xl">
                                  "{st.instruction}"
                                </p>
                              </div>
                            </div>
                          ))}
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

                      <div className="flex gap-2">
                        <button
                          onClick={() => handleStartEdit(wf)}
                          className="flex-1 py-2.5 border border-white/5 hover:border-accent-orange/20 text-slate-300 hover:text-accent-orange transition-all text-[10px] font-black uppercase tracking-wider font-display rounded-xl"
                        >
                          {t('common:edit', { defaultValue: 'Bearbeiten' })}
                        </button>
                        <button
                          onClick={() => handleDelete(wf.id_uuid, wf.workflow_name)}
                          className="px-3 border border-white/5 hover:text-red-500 hover:bg-red-500/5 transition-all rounded-xl text-slate-500"
                        >
                          <Trash2 size={14} />
                        </button>
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
        </div>
      )}
    </div>
  );
};
