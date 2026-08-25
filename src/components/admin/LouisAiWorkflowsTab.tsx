import React, { useState, useEffect } from 'react';
import { trpc } from '../../lib/trpc';
import { toast } from 'sonner';
import { EmailDraftsApprovalPanel } from './EmailDraftsApprovalPanel';
import { DagWorkflowEditor } from './DagWorkflowEditor';
import { IWorkflowDAG } from '../../types/workflows';
import { WORKFLOW_TEMPLATES } from '../../lib/workflowTemplates';
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
  ChevronLeft,
  ChevronRight,
  Copy,
  GitBranch,
  FlaskConical
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
  // S5-Skill-Metadaten (Frontmatter)
  skill_description?: string;
  skill_tags?: string[];
  skill_category?: string;
  skill_version?: number;
  skill_pitfalls?: Array<string | Record<string, unknown>>;
 // 4B: DAG-Struktur (visueller Graph)
  dag_structure?: IWorkflowDAG | Record<string, unknown> | string | null;
}


export const LouisAiWorkflowsTab = () => {
  const { t } = useTranslation(['admin', 'common']);
  const utils = trpc.useContext();
  
  const sanitizeSteps = (steps: unknown): ToolChainStep[] => {
    if (!Array.isArray(steps)) return [];
    return steps.map(step => {
      if (!step || typeof step !== 'object') {
        return { tool: 'executeCrmDataAnalyst', instruction: typeof step === 'string' ? step : '' };
      }
      const s = step as Record<string, unknown>;
      return {
        tool: (s.tool as string) || 'executeCrmDataAnalyst',
        instruction: (s.instruction as string) || (s.description as string) || ''
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
 // 4B: DAG-Editor-Overlay
  const [dagEditorOpen, setDagEditorOpen] = useState(false);
  const [dagEditorWorkflow, setDagEditorWorkflow] = useState<Workflow | null>(null);
  // DAG ist der einzige Workflow-Pfad —
  // das Formular hält den bearbeiteten Graph; true = Overlay aus dem Formular geöffnet
  const [formDag, setFormDag] = useState<IWorkflowDAG | null>(null);
  const [dagEditorFromForm, setDagEditorFromForm] = useState(false);

  // Trigger states
  const [triggerType, setTriggerType] = useState<'MANUAL' | 'CRM_EVENT' | 'TIMER'>('MANUAL');
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>({});
  const [expandedInstanceId, setExpandedInstanceId] = useState<string | null>(null);
  // Audit-Trail-Pagination (wie Kontakte/Unternehmen: 5/10/20 pro Seite)
  const [auditPage, setAuditPage] = useState(1);
  const [auditLimit, setAuditLimit] = useState(10);
  // P2: Workflow-Listen-Pagination (wie Audit-Trail: 5/10/20 pro Seite)
  const [workflowPage, setWorkflowPage] = useState(1);
  const [workflowLimit, setWorkflowLimit] = useState(10);

  // Sync state when details pane loads a new workflow template selection

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
  const [formTriggerConfig, setFormTriggerConfig] = useState<Record<string, unknown>>({});
  const [formIsActive, setFormIsActive] = useState<boolean>(true);
  const [formDirectSendEmail, setFormDirectSendEmail] = useState<boolean>(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Queries
  const { data: workflows = [], isLoading, refetch } = trpc.getWorkflows.useQuery();

  // Audit Log Query with 10-second Live Polling
  const { data: instances = [], refetch: refetchInstances } = trpc.getWorkflowInstancesLog.useQuery(undefined, {
    refetchInterval: 10000
  });

  // Audit-Trail: Seite korrigieren, wenn Instanzen schrumpfen (wie Contacts totalPages-Guard)
  const auditTotal = (instances as unknown as WorkflowInstance[]).length;
  const auditTotalPages = Math.max(1, Math.ceil(auditTotal / auditLimit));
  useEffect(() => {
    if (auditPage > auditTotalPages) setAuditPage(auditTotalPages);
  }, [auditTotalPages, auditPage]);

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

 // 4C (T8b): Dry-Run/Simulation — deterministische Analyse ohne Ausführung
  const [dryRunWorkflowId, setDryRunWorkflowId] = useState<string | null>(null);
  const [dryRunOpen, setDryRunOpen] = useState(false);
  const dryRunQuery = trpc.dryRunWorkflow.useQuery(
    { id_uuid: dryRunWorkflowId || '' },
    { enabled: false, retry: false }
  );

  const approveHumanGateMutation = trpc.approveWorkflowHumanGate.useMutation({
    onSuccess: () => {
      toast.success(t('admin:workflows_tab.human_gate_success', { defaultValue: 'Human Gate erfolgreich freigegeben! Der Workflow wird fortgesetzt.' }));
      reloadAll();
    },
    onError: (err) => {
      toast.error(t('admin:workflows_tab.human_gate_error', { defaultValue: 'Fehler bei der Freigabe: ' }) + err.message);
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
 // Option A: Graph-State zurücksetzen
    setFormDag(null);
    setDagEditorFromForm(false);
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
 // Option A: bestehenden Graph ins Formular laden
    setFormDag((() => {
      const raw = workflow.dag_structure;
      if (!raw) return null;
      if (typeof raw === 'string') {
        try { return JSON.parse(raw) as IWorkflowDAG; } catch { return null; }
      }
      return raw as IWorkflowDAG;
    })());
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

 // Verify all tool steps have instructions — Option A: entfällt,
    // wenn der Workflow im Graph-Editor (formDag) definiert ist (die lineare
    // toolChain ist dann nur noch Legacy-Derivat und darf den Submit nicht blocken)
    if (!formDag) {
      const invalidStep = toolChain.findIndex(step => !step.instruction.trim());
      if (invalidStep !== -1) {
        toast.error(t('admin:error_step_instruction', { index: invalidStep + 1, defaultValue: `Bitte geben Sie eine Handlungsanweisung für Schritt ${invalidStep + 1} ein.` }));
        return;
      }
    }

    learnWorkflowMutation.mutate({
      id_uuid: editingWorkflow?.id_uuid,
      workflow_name: workflowName,
      workflow_description: workflowDescription,
      tool_chain_sequence: toolChain,
      trigger_type: formTriggerType,
      trigger_config: formTriggerConfig,
      is_active: formIsActive,
      direct_send_email: formDirectSendEmail,
 // Option A: DAG ist der einzige Workflow-Pfad — der bearbeitete
      // Graph wird mitgespeichert; ohne formDag erzeugt das Backend automatisch
      // eine lineare DAG-Kette aus tool_chain_sequence
      dag_structure: formDag || undefined
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

  // P2: Workflow-Listen-Pagination (5/10/20 pro Seite, wie Audit-Trail)
  const workflowTotalPages = Math.max(1, Math.ceil(filteredWorkflows.length / workflowLimit));
  const safeWorkflowPage = Math.min(workflowPage, workflowTotalPages);
  const pageWorkflows = filteredWorkflows.slice((safeWorkflowPage - 1) * workflowLimit, safeWorkflowPage * workflowLimit);

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
      case 'executeCreateDraftOffer':
        return 'bg-amber-500/10 border-amber-500/20 text-amber-400';
      case 'executeFinalizeAndSendOffer':
        return 'bg-teal-500/10 border-teal-500/20 text-teal-400';
      case 'executeSendSmtpEmail':
      case 'send_smtp_email':
        return 'bg-indigo-500/10 border-indigo-500/20 text-indigo-400';
      case 'list_kanban_boards':
      case 'executeListKanbanBoards':
      case 'get_kanban_board_details':
      case 'executeGetKanbanBoardDetails':
      case 'create_kanban_card':
      case 'executeCreateKanbanCard':
      case 'update_kanban_card':
      case 'executeUpdateKanbanCard':
      case 'move_kanban_card':
      case 'executeMoveKanbanCard':
      case 'delete_kanban_card':
      case 'executeDeleteKanbanCard':
        return 'bg-purple-500/10 border-purple-500/20 text-purple-400';
      case 'get_templates':
      case 'executeGetTemplates':
      case 'get_template_details':
      case 'executeGetTemplateDetails':
      case 'apply_template':
      case 'executeApplyTemplate':
        return 'bg-pink-500/10 border-pink-500/20 text-pink-400';
      default:
        return 'bg-slate-500/10 border-slate-500/20 text-slate-400';
    }
  };

  const getToolLabel = (toolName: string) => {
    switch (toolName) {
      case 'executeCrmDataAnalyst':
      case 'executeDataArchitect':
        return t('admin:workflows_tab.tools.crm_analyst', { defaultValue: 'CRM Data Analyst (CRM Abfrage & Analyse)' });
      case 'executeWebSearch':
        return t('admin:workflows_tab.tools.web_search', { defaultValue: 'Web Search (Online Suche)' });
      case 'executeLocalKnowledgeSearch':
        return t('admin:workflows_tab.tools.local_knowledge', { defaultValue: 'Local Knowledge (RAG Suche)' });
      case 'executeTextGenerator':
        return t('admin:workflows_tab.tools.text_generator', { defaultValue: 'Text-Generator (Optimiertes Schreiben)' });
      case 'executeCreateDraftInvoice':
        return t('admin:workflows_tab.tools.create_draft_invoice', { defaultValue: 'Create Draft Invoice (Rechnungsentwurf)' });
      case 'executeCreateDraftCompany':
        return t('admin:workflows_tab.tools.create_draft_company', { defaultValue: 'Create Draft Company (Firmenentwurf)' });
      case 'executeCreateDraftContact':
        return t('admin:workflows_tab.tools.create_draft_contact', { defaultValue: 'Create Draft Contact (Kontaktentwurf)' });
      case 'executeCreateDraftOffer':
        return t('admin:workflows_tab.tools.create_draft_offer', { defaultValue: 'Create Draft Offer (Angebotsentwurf)' });
      case 'executeFinalizeAndSendOffer':
        return t('admin:workflows_tab.tools.finalize_and_send_offer', { defaultValue: 'Finalize & Send Offer (Angebot abschließen & senden)' });
      case 'executeSendSmtpEmail':
      case 'send_smtp_email':
        return t('admin:workflows_tab.tools.send_smtp_email', { defaultValue: 'Send SMTP Email (E-Mail-Versand)' });
      case 'list_kanban_boards':
      case 'executeListKanbanBoards':
        return t('admin:workflows_tab.tools.list_kanban_boards', { defaultValue: 'List Kanban Boards (Kanban-Boards auflisten)' });
      case 'get_kanban_board_details':
      case 'executeGetKanbanBoardDetails':
        return t('admin:workflows_tab.tools.get_kanban_board_details', { defaultValue: 'Get Kanban Board Details (Kanban-Board Details abrufen)' });
      case 'create_kanban_card':
      case 'executeCreateKanbanCard':
        return t('admin:workflows_tab.tools.create_kanban_card', { defaultValue: 'Create Kanban Card (Kanban-Karte erstellen)' });
      case 'update_kanban_card':
      case 'executeUpdateKanbanCard':
        return t('admin:workflows_tab.tools.update_kanban_card', { defaultValue: 'Update Kanban Card (Kanban-Karte aktualisieren)' });
      case 'move_kanban_card':
      case 'executeMoveKanbanCard':
        return t('admin:workflows_tab.tools.move_kanban_card', { defaultValue: 'Move Kanban Card (Kanban-Karte verschieben)' });
      case 'delete_kanban_card':
      case 'executeDeleteKanbanCard':
        return t('admin:workflows_tab.tools.delete_kanban_card', { defaultValue: 'Delete Kanban Card (Kanban-Karte löschen)' });
      case 'get_templates':
      case 'executeGetTemplates':
        return t('admin:workflows_tab.tools.get_templates', { defaultValue: 'Get Templates (Vorlagen suchen & abrufen)' });
      case 'get_template_details':
      case 'executeGetTemplateDetails':
        return t('admin:workflows_tab.tools.get_template_details', { defaultValue: 'Get Template Details (Vorlagendetails abrufen)' });
      case 'apply_template':
      case 'executeApplyTemplate':
        return t('admin:workflows_tab.tools.apply_template', { defaultValue: 'Apply Template (Vorlage anwenden & Platzhalter ersetzen)' });
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

          {/* 4C (T7): Vorlagen-Bibliothek — 1-Klick-Starter (nur beim Anlegen) */}
          {!editingWorkflow && (
            <div className="space-y-2" data-testid="workflow-templates">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest font-display">
                {t('admin:workflows_tab.templates_label', { defaultValue: 'Aus Vorlage starten (optional)' })}
              </label>
              <div className="flex flex-wrap gap-2">
                {WORKFLOW_TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    type="button"
                    data-testid={`template-${tmpl.id}`}
                    onClick={() => {
                      setWorkflowName(tmpl.nameKey.includes('zahlungserinnerung') ? 'Zahlungserinnerung' : tmpl.nameKey.includes('angebot') ? 'Angebot nachfassen' : tmpl.nameKey.includes('onboarding') ? 'Onboarding' : 'Overdue-Report');
                      setWorkflowDescription(t(tmpl.descKey, { defaultValue: '' }));
                      setToolChain(tmpl.steps.map((s) => ({ tool: s.tool, instruction: s.instruction })));
                      setFormTriggerType(tmpl.triggerType);
                      setFormTriggerConfig(tmpl.triggerConfig as Record<string, unknown>);
                      setFormDirectSendEmail(tmpl.directSendEmail === true);
                      toast.info(t('admin:workflows_tab.template_applied', { defaultValue: 'Vorlage angewendet — Schritte bitte prüfen.' }));
                    }}
                    className="px-3 py-2 bg-primary-light/30 hover:bg-primary-light/50 border border-white/10 hover:border-accent-orange/30 text-slate-300 hover:text-white text-[10px] font-black uppercase tracking-wider rounded-xl transition-all text-left"
                  >
                    <span className="block text-[11px] font-black text-white font-display">{t(tmpl.nameKey, { defaultValue: tmpl.id })}</span>
                    <span className="block text-[8px] text-slate-500 font-sans font-normal normal-case tracking-normal mt-0.5 max-w-[180px]">
                      {t(tmpl.descKey, { defaultValue: '' })}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

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
                placeholder={t('admin:workflows_tab.placeholder_id', { defaultValue: 'z.B. check_overdue_and_notify_partners' })}
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

          {/* Option A: Workflow-Graph (DAG ist der einzige Workflow-Pfad) */}
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
                data-testid="open-dag-editor-form"
                onClick={() => {
                  // Formular-Kontext: Overlay mit dem aktuellen Formular-Workflow öffnen
                  const formWorkflow: Workflow = {
                    id_uuid: editingWorkflow?.id_uuid || 'new',
                    tenant_id: '1',
                    workflow_name: workflowName || 'Neuer Workflow',
                    workflow_description: workflowDescription || '',
                    tool_chain_sequence: toolChain,
                    trigger_type: formTriggerType,
                    trigger_config: formTriggerConfig,
                    is_active: formIsActive,
                    direct_send_email: formDirectSendEmail,
                    dag_structure: formDag || undefined
                  } as unknown as Workflow;
                  setDagEditorFromForm(true);
                  setDagEditorWorkflow(formWorkflow);
                  setDagEditorOpen(true);
                }}
                className="text-accent-blue flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest font-display hover:text-white transition-colors cursor-pointer"
              >
                <GitBranch size={14} />
                {t('admin:workflows_tab.dag_edit_graph_btn', { defaultValue: 'Workflow-Graph bearbeiten' })}
              </button>
            </div>

            {/* Graph-Zusammenfassung (ersetzt den linearen Ablaufinspektor) */}
            <div className="bg-primary-dark/40 border border-cyan-500/20 rounded-xl p-4 space-y-2" data-testid="dag-form-summary">
              <div className="flex items-center gap-2 text-[10px] text-slate-400 font-sans">
                <GitBranch size={13} className="text-cyan-400 shrink-0" />
                <span>
                  {formDag && formDag.nodes?.length
                    ? t('admin:workflows_tab.dag_form_has_graph', { count: formDag.nodes.length, defaultValue: 'Graph mit {{count}} Knoten hinterlegt — im Graph-Editor bearbeiten.' })
                    : t('admin:workflows_tab.dag_form_no_graph', { defaultValue: 'Noch kein Graph hinterlegt. Klicke „Workflow-Graph bearbeiten", um Aktionen, Bedingungen, Wartezeiten, Freigaben, RAG-Suchen und Rückfragen visuell zu verknüpfen.' })}
                </span>
              </div>
              {formDag && formDag.nodes?.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {formDag.nodes.map((n) => (
                    <span key={n.node_id} className="text-[8px] font-mono font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                      {n.name}
                    </span>
                  ))}
                </div>
              ) : null}
              {!formDag && toolChain.length > 0 && (
                <p className="text-[9px] text-slate-500 font-sans">
                  {t('admin:workflows_tab.dag_form_linear_hint', { defaultValue: 'Beim Speichern wird aus den Schritten automatisch ein linearer Graph erzeugt — du kannst ihn danach jederzeit im Graph-Editor erweitern.' })}
                </p>
              )}
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
                    const val = e.target.value as 'MANUAL' | 'CRM_EVENT' | 'TIMER';
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
                        <option value="file.uploaded">{t('admin:workflows_tab.event_file_uploaded_option', { defaultValue: 'Datei wurde hochgeladen (Kontakt / Unternehmen)' })}</option>
                        <option value="knowledge.file_uploaded">{t('admin:workflows_tab.event_knowledge_uploaded_option', { defaultValue: 'Datei ins interne Wissen hochgeladen' })}</option>
                        {/* 4A T2: neue Trigger-Events */}
                        <option value="offer.created">{t('admin:workflows_tab.event_offer_created_option', { defaultValue: 'Angebot wurde erstellt' })}</option>
                        <option value="offer.finalized">{t('admin:workflows_tab.event_offer_finalized_option', { defaultValue: 'Angebot wurde finalisiert' })}</option>
                        <option value="offer.sent">{t('admin:workflows_tab.event_offer_sent_option', { defaultValue: 'Angebot wurde versendet' })}</option>
                        <option value="contact.deleted">{t('admin:workflows_tab.event_contact_deleted_option', { defaultValue: 'Kontakt wurde gelöscht' })}</option>
                        <option value="company.deleted">{t('admin:workflows_tab.event_company_deleted_option', { defaultValue: 'Unternehmen wurde gelöscht' })}</option>
                        <option value="invoice.updated">{t('admin:workflows_tab.event_invoice_updated_option', { defaultValue: 'Rechnung wurde aktualisiert' })}</option>
                        <option value="kanban.card_created">{t('admin:workflows_tab.event_kanban_card_created_option', { defaultValue: 'Kanban-Karte erstellt' })}</option>
                        <option value="kanban.card_moved">{t('admin:workflows_tab.event_kanban_card_moved_option', { defaultValue: 'Kanban-Karte verschoben' })}</option>
                        <option value="kanban.card_updated">{t('admin:workflows_tab.event_kanban_card_updated_option', { defaultValue: 'Kanban-Karte aktualisiert' })}</option>
                        <option value="kanban.card_deleted">{t('admin:workflows_tab.event_kanban_card_deleted_option', { defaultValue: 'Kanban-Karte gelöscht' })}</option>
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
                        onChange={(e) => setFormTriggerConfig({ ...formTriggerConfig, delay_seconds: Math.max(0, parseInt(e.target.value || '0', 10)) })}
                        className="w-full bg-primary-dark border border-white/5 p-2.5 rounded-xl text-xs text-white focus:outline-none focus:border-accent-orange/30 font-mono font-semibold h-11"
                      />
                    </div>

                    {/* 064 P0-5: Bedingungs-Editor — Whitelist-Felder, Operatoren ohne Regex */}
                    <div className="space-y-2">
                      <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
                        {t('admin:workflows_tab.trigger_conditions_label', { defaultValue: 'Bedingungen (Filter)' })}
                      </label>
                      {(() => {
                        const conds = Array.isArray(formTriggerConfig.conditions)
                          ? (formTriggerConfig.conditions as Array<{ field: string; operator: string; value: string }>)
                          : [];
                        // P1-2: UI-Härtung — ungültige Feld-/Operator-Werte aus
                        // Altbestand/LLM liefern einen leeren Select (verzogene UI).
                        // Fallback auf erste gültige Option statt Crash/Leere.
                        const VALID_FIELDS = ["entity_type", "entity_id", "entity_name", "file_name", "company_id", "company_name", "invoice_status", "kanban_column_id"];
                        const VALID_OPS = ["equals", "not_equals", "contains", "starts_with", "ends_with"];
                        const safeField = (f: string) => VALID_FIELDS.includes(f) ? f : VALID_FIELDS[0];
                        const safeOp = (o: string) => VALID_OPS.includes(o) ? o : VALID_OPS[0];
                        return (
                          <>
                            <div className="flex gap-2 items-center">
                              <label className="text-[10px] text-slate-500 font-semibold">
                                {t('admin:workflows_tab.cond_logic_label', { defaultValue: 'Verknüpfung:' })}
                              </label>
                              <select
                                value={formTriggerConfig.logic || 'AND'}
                                onChange={(e) => setFormTriggerConfig({ ...formTriggerConfig, logic: e.target.value as 'AND' | 'OR' })}
                                data-testid="trigger-condition-logic"
                                className="w-32 bg-primary-dark border border-white/5 p-2 rounded-lg text-xs text-white focus:outline-none focus:border-accent-orange/30 font-semibold h-8"
                              >
                                <option value="AND">{t('admin:workflows_tab.cond_logic_and', { defaultValue: 'UND (alle)' })}</option>
                                <option value="OR">{t('admin:workflows_tab.cond_logic_or', { defaultValue: 'ODER (mind. eine)' })}</option>
                              </select>
                            </div>
                            {conds.length === 0 && (
                              <p className="text-[10px] text-slate-500">
                                {t('admin:workflows_tab.trigger_conditions_hint', { defaultValue: 'Kein Filter — reagiert auf ALLE Ereignisse dieses Typs' })}
                              </p>
                            )}
                            {conds.map((c, idx) => (
                              <div key={idx} className="flex gap-2 items-center" data-testid="trigger-condition-row">
                                <select
                                  value={safeField(c.field)}
                                  onChange={(e) => {
                                    const next = [...conds];
                                    next[idx] = { ...next[idx], field: e.target.value };
                                    setFormTriggerConfig({ ...formTriggerConfig, conditions: next });
                                  }}
                                  className="w-1/3 bg-primary-dark border border-white/5 p-2 rounded-lg text-xs text-white focus:outline-none focus:border-accent-orange/30 font-semibold h-10"
                                >
                                  <option value="entity_type">{t('admin:workflows_tab.cond_field_entity_type', { defaultValue: 'Entitätstyp' })}</option>
                                  <option value="entity_id">{t('admin:workflows_tab.cond_field_entity_id', { defaultValue: 'Entitäts-ID' })}</option>
                                  <option value="entity_name">{t('admin:workflows_tab.cond_field_entity_name', { defaultValue: 'Entitätsname' })}</option>
                                  <option value="file_name">{t('admin:workflows_tab.cond_field_file_name', { defaultValue: 'Dateiname' })}</option>
                                  <option value="company_id">{t('admin:workflows_tab.cond_field_company_id', { defaultValue: 'Unternehmens-ID' })}</option>
                                  <option value="company_name">{t('admin:workflows_tab.cond_field_company_name', { defaultValue: 'Unternehmensname' })}</option>
                                  <option value="invoice_status">{t('admin:workflows_tab.cond_field_invoice_status', { defaultValue: 'Rechnungsstatus' })}</option>
                                  <option value="kanban_column_id">{t('admin:workflows_tab.cond_field_kanban_column', { defaultValue: 'Kanban-Spalte' })}</option>
                                </select>
                                <select
                                  value={safeOp(c.operator)}
                                  onChange={(e) => {
                                    const next = [...conds];
                                    next[idx] = { ...next[idx], operator: e.target.value };
                                    setFormTriggerConfig({ ...formTriggerConfig, conditions: next });
                                  }}
                                  className="w-1/4 bg-primary-dark border border-white/5 p-2 rounded-lg text-xs text-white focus:outline-none focus:border-accent-orange/30 font-semibold h-10"
                                >
                                  <option value="equals">{t('admin:workflows_tab.cond_op_equals', { defaultValue: 'gleich' })}</option>
                                  <option value="not_equals">{t('admin:workflows_tab.cond_op_not_equals', { defaultValue: 'ungleich' })}</option>
                                  <option value="contains">{t('admin:workflows_tab.cond_op_contains', { defaultValue: 'enthält' })}</option>
                                  <option value="starts_with">{t('admin:workflows_tab.cond_op_starts_with', { defaultValue: 'beginnt mit' })}</option>
                                  <option value="ends_with">{t('admin:workflows_tab.cond_op_ends_with', { defaultValue: 'endet mit' })}</option>
                                </select>
                                <input
                                  type="text"
                                  value={c.value}
                                  onChange={(e) => {
                                    const next = [...conds];
                                    next[idx] = { ...next[idx], value: e.target.value };
                                    setFormTriggerConfig({ ...formTriggerConfig, conditions: next });
                                  }}
                                  placeholder={t('admin:workflows_tab.cond_value_placeholder', { defaultValue: 'Wert…' })}
                                  className="flex-1 bg-primary-dark border border-white/5 p-2 rounded-lg text-xs text-white focus:outline-none focus:border-accent-orange/30 font-mono font-semibold h-10"
                                />
                                <button
                                  type="button"
                                  data-testid="trigger-condition-remove"
                                  onClick={() => {
                                    const next = conds.filter((_, i) => i !== idx);
                                    setFormTriggerConfig({ ...formTriggerConfig, conditions: next });
                                  }}
                                  className="text-slate-500 hover:text-red-400 text-sm px-1"
                                  title={t('admin:workflows_tab.cond_remove', { defaultValue: 'Bedingung entfernen' })}
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              data-testid="trigger-condition-add"
                              onClick={() => {
                                const next = [...conds, { field: 'company_id', operator: 'equals', value: '' }];
                                setFormTriggerConfig({ ...formTriggerConfig, conditions: next });
                              }}
                              className="text-[10px] text-accent-orange/80 hover:text-accent-orange border border-white/10 rounded-lg px-3 py-1.5 font-semibold"
                            >
                              + {t('admin:workflows_tab.cond_add', { defaultValue: 'Bedingung hinzufügen' })}
                            </button>
                          </>
                        );
                      })()}
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
                        {/* 4A T3: weekly + Cron-Expression */}
                        <option value="weekly">{t('admin:workflows_tab.frequency_weekly_option', { defaultValue: 'Wöchentlich ausführen (Wochentag + Uhrzeit)' })}</option>
                        <option value="cron">{t('admin:workflows_tab.frequency_cron_option', { defaultValue: 'Cron-Expression (5 Felder)' })}</option>
                      </select>
                    </div>
                    {formTriggerConfig.frequency !== 'hourly' && formTriggerConfig.frequency !== 'cron' && (
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
                    {formTriggerConfig.frequency === 'weekly' && (
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
                          {t('admin:workflows_tab.weekday_label', { defaultValue: 'Wochentag (1=Montag … 7=Sonntag)' })}
                        </label>
                        <select
                          value={formTriggerConfig.weekday || '1'}
                          onChange={(e) => setFormTriggerConfig({ ...formTriggerConfig, weekday: e.target.value })}
                          className="w-full bg-primary-dark border border-white/5 p-2.5 rounded-xl text-xs text-white focus:outline-none focus:border-accent-orange/30 font-semibold h-11"
                        >
                          <option value="1">{t('admin:workflows_tab.weekday_monday', { defaultValue: 'Montag' })}</option>
                          <option value="2">{t('admin:workflows_tab.weekday_tuesday', { defaultValue: 'Dienstag' })}</option>
                          <option value="3">{t('admin:workflows_tab.weekday_wednesday', { defaultValue: 'Mittwoch' })}</option>
                          <option value="4">{t('admin:workflows_tab.weekday_thursday', { defaultValue: 'Donnerstag' })}</option>
                          <option value="5">{t('admin:workflows_tab.weekday_friday', { defaultValue: 'Freitag' })}</option>
                          <option value="6">{t('admin:workflows_tab.weekday_saturday', { defaultValue: 'Samstag' })}</option>
                          <option value="7">{t('admin:workflows_tab.weekday_sunday', { defaultValue: 'Sonntag' })}</option>
                        </select>
                      </div>
                    )}
                    {formTriggerConfig.frequency === 'cron' && (
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">
                          {t('admin:workflows_tab.cron_label', { defaultValue: 'Cron-Expression (Minute Stunde Tag Monat Wochentag)' })}
                        </label>
                        <input
                          type="text"
                          placeholder="0 8 * * 1"
                          value={formTriggerConfig.cron || '0 8 * * 1'}
                          onChange={(e) => setFormTriggerConfig({ ...formTriggerConfig, cron: e.target.value })}
                          className="w-full bg-primary-dark border border-white/5 p-2.5 rounded-xl text-xs text-white focus:outline-none focus:border-accent-orange/30 font-mono font-semibold h-11"
                        />
                        <p className="text-[9px] text-slate-500">
                          {t('admin:workflows_tab.cron_hint', { defaultValue: 'z. B. "0 8 * * 1" = täglich 08:00 (Wochentag 1=Mo). Unterstützt * und */n.' })}
                        </p>
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
                {pageWorkflows.map((workflow: Workflow) => {
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
                      data-testid="workflow-card"
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
                            {workflow.is_active !== false ? t('common:active') : t('common:inactive')}
                          </span>
                          <span className={`text-[8px] font-mono font-bold uppercase bg-accent-blue/10 border border-accent-blue/20 text-accent-blue px-2 py-0.5 rounded-full`}>
                            ⚡ {workflow.trigger_type || 'MANUAL'}
                          </span>
                          {/* S5-Skill-Metadaten (Optimierung 2026-08-14) */}
                          {workflow.skill_category && (
                            <span className="text-[8px] font-mono font-bold uppercase bg-violet-500/10 border border-violet-500/20 text-violet-300 px-2 py-0.5 rounded-full">
                              {workflow.skill_category}
                            </span>
                          )}
                          {typeof workflow.skill_version === 'number' && (
                            <span className="text-[8px] font-mono font-bold uppercase bg-white/5 border border-white/10 text-slate-300 px-2 py-0.5 rounded-full">
                              v{workflow.skill_version}
                            </span>
                          )}
                          {Array.isArray(workflow.skill_tags) && workflow.skill_tags.length > 0 && (
                            <span className="text-[8px] font-mono text-slate-400">
                              #{workflow.skill_tags.join(' #')}
                            </span>
                          )}
                          {parsedSteps.some(s => s?.tool === 'executeSendSmtpEmail' || s?.tool === 'send_smtp_email') && (
                            <span className={`text-[8px] font-mono font-bold uppercase px-2 py-0.5 rounded-full border ${workflow.direct_send_email === true ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' : 'bg-slate-500/10 border-white/5 text-slate-400'}`}>
                              📧 {t('admin:workflows_tab.auto_mail_on_off', { defaultValue: 'Auto-Mail:' })} {workflow.direct_send_email === true 
                                ? t('admin:workflows_tab.auto_mail_on', { defaultValue: 'An' }) 
                                : t('admin:workflows_tab.auto_mail_off', { defaultValue: 'Aus' })}
                            </span>
                          )}
                          {/* 4B: DAG-Editor öffnen */}
                          <button
                            type="button"
                            data-testid="open-dag-editor"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDagEditorWorkflow(workflow);
                              setDagEditorOpen(true);
                            }}
                            className="text-[8px] font-mono font-black uppercase px-2 py-0.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 transition-all"
                          >
                            ⛓ {t('admin:workflows_tab.dag_open_editor', { defaultValue: 'Graph bearbeiten' })}
                          </button>
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed font-sans max-w-md">
                          {workflow.skill_description || workflow.workflow_description}
                        </p>
                        {/* S5-Pitfalls (aus dem Improvement-Loop) */}
                        {Array.isArray(workflow.skill_pitfalls) && workflow.skill_pitfalls.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {workflow.skill_pitfalls.slice(0, 2).map((p, pi) => {
                              const note = typeof p === 'string' ? p : (p as { note?: string }).note || '';
                              return (
                                <span key={pi} className="text-[9px] px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300" title={note}>
                                  ⚠️ {note.length > 60 ? note.slice(0, 60) + '…' : note}
                                </span>
                              );
                            })}
                            {workflow.skill_pitfalls.length > 2 && (
                              <span className="text-[9px] text-slate-500 font-mono">+ {workflow.skill_pitfalls.length - 2} weitere</span>
                            )}
                          </div>
                        )}
                        
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
                            <span className="text-[10px] text-red-500 font-extrabold uppercase tracking-widest pl-1">{t('admin:workflows_tab.confirm_delete')}</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteWorkflowMutation.mutate({ id_uuid: workflow.id_uuid });
                                setConfirmDeleteId(null);
                              }}
                              className="px-2.5 py-1 bg-red-500 hover:bg-red-650 text-white rounded-lg text-[10px] font-bold uppercase transition-all"
                            >
                              {t('common:yes')}
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDeleteId(null);
                              }}
                              className="px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-[10px] font-bold uppercase transition-all"
                            >
                              {t('common:no')}
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
                {/* P2: Workflow-Listen-Pagination (5/10/20 pro Seite, wie Audit-Trail) */}
                {filteredWorkflows.length > 0 && (
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-4 bg-primary-dark/40 border border-white/5 rounded-2xl">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 bg-primary-light border border-white/10 px-3 py-1.5 rounded-xl text-xs text-white">
                        <span className="text-slate-500 uppercase tracking-widest font-black text-[10px]">
                          {t('common:show', { defaultValue: 'Anzeigen' })}
                        </span>
                        <select
                          value={workflowLimit}
                          onChange={(e) => {
                            setWorkflowLimit(Number(e.target.value));
                            setWorkflowPage(1);
                          }}
                          className="bg-transparent text-white font-black uppercase text-xs focus:outline-none cursor-pointer border-none p-0 outline-none"
                        >
                          <option value={5} className="bg-primary-dark">5</option>
                          <option value={10} className="bg-primary-dark">10</option>
                          <option value={20} className="bg-primary-dark">20</option>
                        </select>
                      </div>
                      <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">
                        {t('common:pagination_entries', {
                          from: Math.min(filteredWorkflows.length, (safeWorkflowPage - 1) * workflowLimit + 1),
                          to: Math.min(filteredWorkflows.length, safeWorkflowPage * workflowLimit),
                          count: filteredWorkflows.length
                        })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setWorkflowPage(p => Math.max(1, p - 1))}
                        disabled={safeWorkflowPage <= 1}
                        className="p-2 text-slate-400 hover:text-white bg-primary-light border border-white/5 disabled:opacity-30 disabled:hover:text-slate-400 rounded-lg cursor-pointer transition-all active:scale-95"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <span className="text-xs text-slate-300 font-mono font-bold bg-primary-dark/80 px-3 py-1.5 rounded-lg border border-white/5 min-w-[50px] text-center">
                        {safeWorkflowPage} / {workflowTotalPages}
                      </span>
                      <button
                        type="button"
                        onClick={() => setWorkflowPage(p => Math.min(workflowTotalPages, p + 1))}
                        disabled={safeWorkflowPage >= workflowTotalPages}
                        className="p-2 text-slate-400 hover:text-white bg-primary-light border border-white/5 disabled:opacity-30 disabled:hover:text-slate-400 rounded-lg cursor-pointer transition-all active:scale-95"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                )}
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
 // Option A: DAG-Struktur für die Graph-Ansicht auflösen
                  let dagNodesForDisplay: IWorkflowDAG["nodes"] = [];
                  {
                    const raw = wf.dag_structure;
                    if (raw) {
                      try {
                        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
                        if (parsed && Array.isArray(parsed.nodes)) dagNodesForDisplay = parsed.nodes as IWorkflowDAG["nodes"];
                      } catch (_) {}
                    }
                  }
                  const dagNodeStyle = (t: string): string => {
                    if (t === "CONDITIONAL") return "border-purple-500/40 text-purple-400 bg-purple-500/10";
                    if (t === "WAIT") return "border-amber-500/40 text-amber-400 bg-amber-500/10";
                    if (t === "HUMAN_GATE") return "border-red-500/40 text-red-400 bg-red-500/10";
                    if (t === "RAG") return "border-cyan-500/40 text-cyan-400 bg-cyan-500/10";
                    return "border-accent-orange/40 text-accent-orange bg-accent-orange/10";
                  };

                  return (
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <p className="text-[10px] text-slate-500 font-mono leading-none">
                          {t('admin:workflows_tab.id_label', { defaultValue: 'Workflow-ID' }).replace(' / Name *', '')}
                        </p>
                        <h5 className="text-base font-black text-white font-mono break-all">{wf.workflow_name}</h5>
                        <p className="text-xs text-slate-300 leading-relaxed font-sans">{wf.workflow_description}</p>
                      </div>

                      {/* Option A: DAG-Graph-Ansicht (ersetzt lineare Sequenz-Kette) */}
                      <div className="space-y-4 pt-2">
                        <p className="text-[10px] font-black uppercase text-slate-500 tracking-widest font-display">
                          {dagNodesForDisplay.length > 0
                            ? t('admin:workflows_tab.dag_graph_view', { defaultValue: 'Workflow-Graph (DAG)' })
                            : t('admin:workflows_tab.timeline_sequence', { defaultValue: 'Sequenz-Kette' })}
                        </p>

                        {dagNodesForDisplay.length > 0 ? (
                          <div className="space-y-2 font-sans">
                            {dagNodesForDisplay.map((dn) => {
                              const next = (dn.next_node_ids || []).length;
                              const fallback = dn.fallback_node_id || null;
                              return (
                                <div key={dn.node_id} className="relative">
                                  <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${dagNodeStyle(dn.type)}`}>
                                    <span className="text-[9px] font-mono font-bold uppercase tracking-wider">{dn.node_id}</span>
                                    <span className="text-[10px] font-bold text-white truncate flex-1">{dn.name}</span>
                                    {dn.type !== "ACTION" && (
                                      <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-primary-dark border border-white/10 font-mono">{dn.type}</span>
                                    )}
                                    <span className="text-[8px] font-mono text-slate-500 truncate max-w-[160px]">{dn.tool_identifier}</span>
                                  </div>
                                  <div className="flex flex-wrap gap-1.5 mt-1 ml-3">
                                    {next > 0 && (
                                      <span className="text-[8px] font-mono text-slate-500 border border-white/10 rounded-full px-2 py-0.5">
                                        → {next} Folgeknoten: {(dn.next_node_ids || []).join(', ')}
                                      </span>
                                    )}
                                    {fallback && (
                                      <span className="text-[8px] font-mono text-red-400/80 border border-red-500/30 rounded-full px-2 py-0.5">
                                        Fallback: {fallback}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                            <p className="text-[9px] text-slate-500 pt-1">
                              {t('admin:workflows_tab.dag_graph_hint', { defaultValue: 'Bearbeite den Graphen über „Workflow-Graph bearbeiten" (visueller Editor).' })}
                            </p>
                          </div>
                        ) : (
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
                            {stepsList.length === 0 && (
                              <p className="text-xs text-slate-500 italic">
                                {t('admin:workflows_tab.no_steps_processed', { defaultValue: 'Noch keine Schritte verarbeitet.' })}
                              </p>
                            )}
                          </div>
                        )}
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
                                const val = e.target.value as 'MANUAL' | 'CRM_EVENT' | 'TIMER';
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
                                  <option value="file.uploaded">{t('admin:workflows_tab.event_file_uploaded_option', { defaultValue: 'Datei wurde hochgeladen (Kontakt / Unternehmen)' })}</option>
                        <option value="knowledge.file_uploaded">{t('admin:workflows_tab.event_knowledge_uploaded_option', { defaultValue: 'Datei ins interne Wissen hochgeladen' })}</option>
                                  {/* 4A T2: neue Trigger-Events */}
                                  <option value="offer.created">{t('admin:workflows_tab.event_offer_created_option', { defaultValue: 'Angebot wurde erstellt' })}</option>
                                  <option value="offer.finalized">{t('admin:workflows_tab.event_offer_finalized_option', { defaultValue: 'Angebot wurde finalisiert' })}</option>
                                  <option value="offer.sent">{t('admin:workflows_tab.event_offer_sent_option', { defaultValue: 'Angebot wurde versendet' })}</option>
                                  <option value="contact.deleted">{t('admin:workflows_tab.event_contact_deleted_option', { defaultValue: 'Kontakt wurde gelöscht' })}</option>
                                  <option value="company.deleted">{t('admin:workflows_tab.event_company_deleted_option', { defaultValue: 'Unternehmen wurde gelöscht' })}</option>
                                  <option value="invoice.updated">{t('admin:workflows_tab.event_invoice_updated_option', { defaultValue: 'Rechnung wurde aktualisiert' })}</option>
                                  <option value="kanban.card_created">{t('admin:workflows_tab.event_kanban_card_created_option', { defaultValue: 'Kanban-Karte erstellt' })}</option>
                                  <option value="kanban.card_moved">{t('admin:workflows_tab.event_kanban_card_moved_option', { defaultValue: 'Kanban-Karte verschoben' })}</option>
                                  <option value="kanban.card_updated">{t('admin:workflows_tab.event_kanban_card_updated_option', { defaultValue: 'Kanban-Karte aktualisiert' })}</option>
                                  <option value="kanban.card_deleted">{t('admin:workflows_tab.event_kanban_card_deleted_option', { defaultValue: 'Kanban-Karte gelöscht' })}</option>
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
                                  onChange={(e) => setTriggerConfig({ ...triggerConfig, delay_seconds: Math.max(0, parseInt(e.target.value || '0', 10)) })}
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
                                  {/* 4A T3: weekly + Cron */}
                                  <option value="weekly">{t('admin:workflows_tab.frequency_weekly_option', { defaultValue: 'Wöchentlich ausführen (Wochentag + Uhrzeit)' })}</option>
                                  <option value="cron">{t('admin:workflows_tab.frequency_cron_option', { defaultValue: 'Cron-Expression (5 Felder)' })}</option>
                                </select>
                              </div>
                              {triggerConfig.frequency !== 'hourly' && triggerConfig.frequency !== 'cron' && (
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
                              {triggerConfig.frequency === 'weekly' && (
                                <div className="space-y-1">
                                  <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                                    {t('admin:workflows_tab.weekday_label', { defaultValue: 'Wochentag (1=Montag … 7=Sonntag)' })}
                                  </label>
                                  <select
                                    value={triggerConfig.weekday || '1'}
                                    onChange={(e) => setTriggerConfig({ ...triggerConfig, weekday: e.target.value })}
                                    className="w-full bg-primary-dark border border-white/5 p-2.5 rounded-xl text-xs text-white focus:outline-none focus:border-accent-orange/30 font-semibold"
                                  >
                                    <option value="1">{t('admin:workflows_tab.weekday_monday', { defaultValue: 'Montag' })}</option>
                                    <option value="2">{t('admin:workflows_tab.weekday_tuesday', { defaultValue: 'Dienstag' })}</option>
                                    <option value="3">{t('admin:workflows_tab.weekday_wednesday', { defaultValue: 'Mittwoch' })}</option>
                                    <option value="4">{t('admin:workflows_tab.weekday_thursday', { defaultValue: 'Donnerstag' })}</option>
                                    <option value="5">{t('admin:workflows_tab.weekday_friday', { defaultValue: 'Freitag' })}</option>
                                    <option value="6">{t('admin:workflows_tab.weekday_saturday', { defaultValue: 'Samstag' })}</option>
                                    <option value="7">{t('admin:workflows_tab.weekday_sunday', { defaultValue: 'Sonntag' })}</option>
                                  </select>
                                </div>
                              )}
                              {triggerConfig.frequency === 'cron' && (
                                <div className="space-y-1">
                                  <label className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                                    {t('admin:workflows_tab.cron_label', { defaultValue: 'Cron-Expression (Minute Stunde Tag Monat Wochentag)' })}
                                  </label>
                                  <input
                                    type="text"
                                    placeholder="0 8 * * 1"
                                    value={triggerConfig.cron || '0 8 * * 1'}
                                    onChange={(e) => setTriggerConfig({ ...triggerConfig, cron: e.target.value })}
                                    className="w-full bg-primary-dark border border-white/5 p-2.5 rounded-xl text-xs text-white focus:outline-none focus:border-accent-orange/30 font-mono font-semibold"
                                  />
                                  <p className="text-[9px] text-slate-500">
                                    {t('admin:workflows_tab.cron_hint', { defaultValue: 'z. B. "0 8 * * 1" = täglich 08:00 (Wochentag 1=Mo). Unterstützt * und */n.' })}
                                  </p>
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

                      {/* 4C (T8b): Dry-Run-Button */}
                      <button
                        type="button"
                        data-testid="dry-run-btn"
                        onClick={() => {
                          setDryRunWorkflowId(wf.id_uuid || null);
                          setTimeout(() => dryRunQuery.refetch(), 50);
                          setDryRunOpen(true);
                        }}
                        className="w-full py-3 bg-primary-light/40 border border-cyan-500/30 hover:border-cyan-400/60 text-cyan-300 text-[11px] font-black uppercase tracking-wider font-display rounded-xl transition-all cursor-pointer flex items-center justify-center gap-2"
                      >
                        <FlaskConical size={12} />
                        {t('admin:workflows_tab.dry_run_btn', { defaultValue: 'Dry-Run (Analyse)' })}
                      </button>

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
                            <span className="text-[10px] text-red-500 font-extrabold uppercase tracking-widest pl-1">{t('admin:workflows_tab.confirm_delete')}</span>
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => {
                                  deleteWorkflowMutation.mutate({ id_uuid: wf.id_uuid });
                                  setConfirmDeleteId(null);
                                }}
                                className="px-2.5 py-1 bg-red-500 hover:bg-red-650 text-white rounded-lg text-[10px] font-bold uppercase transition-all"
                              >
                                {t('common:yes')}
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-2.5 py-1 bg-slate-700 hover:bg-slate-650 text-slate-200 rounded-lg text-[10px] font-bold uppercase transition-all"
                              >
                                {t('common:no')}
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
                    {t('admin:workflows_tab.audit_trail_title', { defaultValue: 'Automations-Protokoll & Live-Audit Trail' })}
                  </h4>
                  <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wide">
                    {t('admin:workflows_tab.audit_trail_subtitle', { defaultValue: 'Echtzeit-Durchführungsprotokoll und detaillierte Kettenschritt-Analytik (10s Polling)' })}
                  </p>
                </div>
              </div>
              <button 
                type="button"
                onClick={refetchInstances}
                className="px-4 py-2 bg-primary-dark hover:bg-primary-dark/80 border border-white/5 text-slate-300 font-black font-display uppercase tracking-wider text-[9px] rounded-xl transition-all cursor-pointer"
              >
                {t('admin:workflows_tab.audit_trail_refresh', { defaultValue: 'Aktualisieren' })}
              </button>
            </div>

            {instances.length === 0 ? (
              <div className="py-16 text-center border border-dashed border-white/10 rounded-2xl bg-primary-dark/20">
                <Clock className="text-slate-600 mx-auto opacity-30 mb-2 animate-spin-slow" size={32} />
                <p className="text-xs text-slate-500 italic max-w-sm mx-auto leading-relaxed">
                  {t('admin:workflows_tab.audit_trail_empty', { defaultValue: 'Bislang liegen keine Live-Ausführungsprotokolle für diesen Tenant vor. Sobald Workflows per Chat oder System-Events getriggert werden, erscheinen Protokolle hier.' })}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {(() => {
                  const allInstances = instances as unknown as WorkflowInstance[];
                  const startIndex = (auditPage - 1) * auditLimit;
                  return allInstances.slice(startIndex, startIndex + auditLimit).map((inst: WorkflowInstance) => {
                  const template = workflows.find((w: Workflow) => w.id_uuid === inst.workflow_id);
                  const wfName = template ? template.workflow_name : (inst.workflow_id || t('admin:workflows_tab.system_workflow', { defaultValue: 'System-Workflow' }));
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
                              ⏳ {t('common:status_running')}
                            </span>
                          )}
                          {inst.status === 'WAITING_FOR_DRAFT_APPROVAL' && (
                            <span className="px-2.5 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[8px] font-black rounded-lg uppercase tracking-wider font-mono">
                              🟠 {t('common:status_waiting_for_draft_approval')}
                            </span>
                          )}
                          {inst.status === 'PENDING_DELAY' && (
                            <span className="px-2.5 py-1 bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[8px] font-black rounded-lg uppercase tracking-wider font-mono">
                              🟣 {t('common:status_pending_delay')}
                            </span>
                          )}
                          {inst.status === 'COMPLETED' && (
                            <span className="px-2.5 py-1 bg-green-500/10 border border-green-500/20 text-green-400 text-[8px] font-black rounded-lg uppercase tracking-wider font-mono">
                              🟢 {t('common:status_completed')}
                            </span>
                          )}
                          {inst.status === 'FAILED' && (
                            <span className="px-2.5 py-1 bg-red-500/10 border border-red-500/20 text-red-400 text-[8px] font-black rounded-lg uppercase tracking-wider font-mono">
                              🔴 {t('common:status_failed')}
                            </span>
                          )}

                          <span className="text-[10px] font-mono text-slate-400 font-bold bg-primary-dark/60 px-2 py-1 rounded-lg border border-white/5">
                            {t('admin:workflows_tab.step_badge', { defaultValue: 'Schritt' })} {inst.current_step_index + 1}
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
                            <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest font-display mb-2">{t('admin:workflows_tab.trigger_event_payload')}</p>
                            <pre className="bg-primary-dark/80 p-4 rounded-xl border border-white/5 text-[10px] font-mono text-slate-400 overflow-x-auto max-h-[160px] shadow-inner">
                              {JSON.stringify(inst.initial_payload || {}, null, 2)}
                            </pre>
                          </div>

                          {/* DAG Graph Visualizer */}
                          {template?.dag_structure && (() => {
                            const dag = template.dag_structure as unknown as { nodes: { node_id: string; name: string; type: string; instructions_template: string; next_node_ids: string[]; rag_enabled?: boolean; }[] };
                            const nodes = dag?.nodes || [];
                            const currentNodeId = inst.current_node_id;
                            const stateResults = typeof inst.node_results === 'string'
                              ? JSON.parse(inst.node_results as string)
                              : ((inst.node_results || {}) as Record<string, Record<string, unknown>>);
                            
                            return (
                              <div className="bg-primary-dark/45 p-6 rounded-2xl border border-white/5 space-y-4">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Layers className="text-accent-blue" size={14} />
                                    <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest font-display">
                                      {t('admin:workflows_tab.played_dag_graph', { defaultValue: 'Gespielter Workflow-Knotengraph (DAG)' })}
                                    </p>
                                  </div>
                                  <span className="text-[9px] font-mono text-slate-500 bg-primary-dark/80 border border-white/5 px-2 py-0.5 rounded-md">
                                    {t('admin:workflows_tab.graph_engine_spec', { defaultValue: 'Graph-Engine v2.4 (EN 16931-kompatibel)' })}
                                  </span>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center relative overflow-hidden p-2">
                                  {nodes.map((node, nIdx) => {
                                    const isActive = currentNodeId === node.node_id;
                                    const isCompleted = !isActive && !!stateResults[node.node_id];
                                    const hasPendingGate = isActive && inst.status === "PENDING_APPROVAL";

                                    let bgStyle = "bg-primary-dark/80 border-white/5 text-slate-400";
                                    let iconColor = "text-slate-500";
                                    
                                    if (isCompleted) {
                                      bgStyle = "bg-green-500/10 border-green-500/30 text-green-200 shadow-sm shadow-green-500/5";
                                      iconColor = "text-green-400";
                                    } else if (isActive) {
                                      bgStyle = "bg-accent-blue/10 border-accent-blue/50 text-white shadow-md shadow-accent-blue/10 animate-pulse";
                                      iconColor = "text-accent-blue";
                                    }

                                    return (
                                      <React.Fragment key={node.node_id}>
                                        <div className={`p-4 rounded-xl border transition-all relative ${bgStyle}`}>
                                          <div className="flex items-center gap-3">
                                            <div className={`p-2 rounded-lg bg-primary-dark/90 ${iconColor}`}>
                                              <Cpu size={14} />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                              <p className="text-xs font-bold truncate leading-tight font-display">{node.name}</p>
                                              <p className="text-[9px] font-mono opacity-50 mt-0.5 uppercase tracking-wider">{node.type}</p>
                                            </div>
                                          </div>
                                          
                                          <div className="mt-2 text-[10px] opacity-80 leading-relaxed font-sans line-clamp-2">
                                            {node.instructions_template}
                                          </div>

                                          {node.rag_enabled && (
                                            <span className="absolute top-2 right-2 px-1.5 py-0.5 bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[7px] font-mono uppercase tracking-wider rounded">
                                              {t('admin:workflows_tab.rag_active_badge', { defaultValue: 'RAG aktiv' })}
                                            </span>
                                          )}

                                          {/* Gate Actionable Form */}
                                          {hasPendingGate && (
                                            <div className="mt-4 p-3 bg-primary-dark/90 border border-amber-500/20 rounded-xl space-y-2 animate-fade-in">
                                              <div className="flex items-center gap-1.5 text-[10px] text-amber-400 font-bold font-mono">
                                                <Sparkles size={11} className="animate-spin-slow" />
                                                <span>{t('admin:workflows_tab.request_human_gate')}</span>
                                              </div>
                                              <p className="text-[9px] text-slate-400 leading-tight">
                                                {t('admin:workflows_tab.human_gate_desc')}
                                              </p>
                                              <div className="flex gap-2 pt-1">
                                                <button
                                                  type="button"
                                                  onClick={async (e) => {
                                                    e.stopPropagation();
                                                    await approveHumanGateMutation.mutateAsync({ instance_id: inst.id_uuid || "" });
                                                  }}
                                                  disabled={approveHumanGateMutation.isPending}
                                                  className="px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-primary-dark text-[9px] font-black uppercase rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                                                >
                                                  <Check size={10} /> {t('admin:workflows_tab.approve_gate_btn')}
                                                </button>
                                              </div>
                                            </div>
                                          )}
                                        </div>

                                        {nIdx < nodes.length - 1 && (
                                          <div className="hidden md:flex justify-center text-slate-500">
                                            <ArrowRight size={16} className={`animate-pulse ${isActive ? 'text-accent-blue' : ''}`} />
                                          </div>
                                        )}
                                      </React.Fragment>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })()}

                          <div className="space-y-4">
                            <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest font-display">{t('admin:workflows_tab.activity_timeline_details')}</p>
                            
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
                                    <p className="text-xs text-slate-500 italic">{t('admin:workflows_tab.no_steps_processed', { defaultValue: 'Noch keine Schritte verarbeitet.' })}</p>
                                  );
                                }

                                return logsList.map((log: WorkflowExecutionLogEntry, lIdx: number) => (
                                  <div key={lIdx} className="relative">
                                    <span className="absolute -left-[23px] top-1.5 w-2.5 h-2.5 rounded-full bg-accent-blue ring-4 ring-primary-dark" />
                                    <div className="bg-primary-dark/60 border border-white/5 p-4 rounded-xl space-y-2">
                                      <div className="flex justify-between items-center flex-wrap gap-2">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="text-xs font-bold text-white">
                                            {t('admin:workflows_tab.step_label', { defaultValue: 'Schritt' })} {lIdx + 1}: {typeof log.tool === 'string' ? log.tool.replace('execute', 'LOUIS ') : (log.step || t('admin:workflows_tab.action_fallback', { defaultValue: 'Aktion' }))}
                                          </span>
                                          {log.mailing_status && (
                                            <span className="text-[8px] font-mono px-1.5 py-0.5 bg-accent-blue/10 text-accent-blue border border-accent-blue/20 rounded font-bold">{t('admin:workflows_tab.type_mail', { defaultValue: 'Mail' })}</span>
                                          )}
                                          {log.label_status && (
                                            <span className="text-[8px] font-mono px-1.5 py-0.5 bg-green-500/10 text-green-400 border border-green-500/20 rounded font-bold">{t('admin:workflows_tab.type_label', { defaultValue: 'Label' })}</span>
                                          )}
                                          {log.note_status && (
                                            <span className="text-[8px] font-mono px-1.5 py-0.5 bg-slate-500/10 text-slate-400 border border-white/5 rounded font-bold">{t('admin:workflows_tab.type_note', { defaultValue: 'Note' })}</span>
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
                                          ❌ {t('admin:workflows_tab.email_error', { defaultValue: 'E-Mail-Fehler:' })} {log.mailing_error}
                                        </p>
                                      )}
                                      {log.label_error && (
                                        <p className="text-[10px] font-mono text-red-400 leading-tight bg-red-500/5 p-2 rounded border border-red-500/10">
                                          ❌ {t('admin:workflows_tab.label_error', { defaultValue: 'Label-Fehler:' })} {log.label_error}
                                        </p>
                                      )}
                                      {log.note_error && (
                                        <p className="text-[10px] font-mono text-red-400 leading-tight bg-red-500/5 p-2 rounded border border-red-500/10">
                                          ❌ {t('admin:workflows_tab.note_error', { defaultValue: 'Notiz-Fehler:' })} {log.note_error}
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
                  });
                })()}
                {/* Audit-Trail-Pagination (5/10/20 pro Seite, wie Kontakte/Unternehmen) */}
                {(instances as unknown as WorkflowInstance[]).length > 0 && (
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-4 bg-primary-dark/40 border border-white/5 rounded-2xl">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 bg-primary-light border border-white/10 px-3 py-1.5 rounded-xl text-xs text-white">
                        <span className="text-slate-500 uppercase tracking-widest font-black text-[10px]">
                          {t('common:show', { defaultValue: 'Anzeigen' })}
                        </span>
                        <select
                          value={auditLimit}
                          onChange={(e) => {
                            setAuditLimit(Number(e.target.value));
                            setAuditPage(1);
                          }}
                          className="bg-transparent text-white font-black uppercase text-xs focus:outline-none cursor-pointer border-none p-0 outline-none"
                        >
                          <option value={5} className="bg-primary-dark">5</option>
                          <option value={10} className="bg-primary-dark">10</option>
                          <option value={20} className="bg-primary-dark">20</option>
                        </select>
                      </div>
                      <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">
                        {t('common:pagination_entries', {
                          from: Math.min((instances as unknown as WorkflowInstance[]).length, (auditPage - 1) * auditLimit + 1),
                          to: Math.min((instances as unknown as WorkflowInstance[]).length, auditPage * auditLimit),
                          count: (instances as unknown as WorkflowInstance[]).length
                        })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setAuditPage(p => Math.max(1, p - 1))}
                        disabled={auditPage === 1}
                        className="p-2 text-slate-400 hover:text-white bg-primary-light border border-white/5 disabled:opacity-30 disabled:hover:text-slate-400 rounded-lg cursor-pointer transition-all active:scale-95"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <span className="text-xs text-slate-300 font-mono font-bold bg-primary-dark/80 px-3 py-1.5 rounded-lg border border-white/5 min-w-[50px] text-center">
                        {auditPage} / {Math.max(1, Math.ceil((instances as unknown as WorkflowInstance[]).length / auditLimit))}
                      </span>
                      <button
                        type="button"
                        onClick={() => setAuditPage(p => Math.min(Math.max(1, Math.ceil((instances as unknown as WorkflowInstance[]).length / auditLimit)), p + 1))}
                        disabled={auditPage >= Math.max(1, Math.ceil((instances as unknown as WorkflowInstance[]).length / auditLimit))}
                        className="p-2 text-slate-400 hover:text-white bg-primary-light border border-white/5 disabled:opacity-30 disabled:hover:text-slate-400 rounded-lg cursor-pointer transition-all active:scale-95"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                )}
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
              {/* Section 1: Trigger & Event Data and Sequence Context */}
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
                      { tag: '{{id_uuid}}', desc: t('admin:workflows_tab.variables_helper.items.id_uuid', { defaultValue: 'Die eindeutige ID des betroffenen CRM-Datensatzes' }) },
                      { tag: '{{file_name}}', desc: t('admin:workflows_tab.variables_helper.items.file_name', { defaultValue: 'Der Dateiname der hochgeladenen Datei (nur bei file.uploaded)' }) },
                      { tag: '{{file_size_bytes}}', desc: t('admin:workflows_tab.variables_helper.items.file_size_bytes', { defaultValue: 'Die Größe der hochgeladenen Datei in Bytes (nur bei file.uploaded)' }) }
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

      {/* 4B: DAG-Editor-Overlay */}
      {dagEditorOpen && dagEditorWorkflow && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" data-testid="dag-editor-overlay">
          <div className="bg-primary-dark border border-white/10 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black text-white font-display flex items-center gap-2">
                <GitBranch size={16} className="text-cyan-400" />
                {t('admin:workflows_tab.dag_editor_title', { defaultValue: 'Visueller Workflow-Editor (DAG)' })}
                <span className="text-[10px] text-slate-500 font-mono font-normal">{dagEditorWorkflow.workflow_name}</span>
              </h3>
            </div>
            <DagWorkflowEditor
              workflowId={dagEditorWorkflow.id_uuid || ''}
              initialDag={(() => {
                const raw = dagEditorWorkflow.dag_structure;
                if (!raw) return null;
                if (typeof raw === 'string') {
                  try { return JSON.parse(raw) as IWorkflowDAG; } catch { return null; }
                }
                return raw as IWorkflowDAG;
              })()}
              linearSequence={(() => {
                const raw = dagEditorWorkflow.tool_chain_sequence;
                if (!raw) return [];
                if (typeof raw === 'string') {
                  try { return JSON.parse(raw) as Array<{ tool: string; instruction: string }>; } catch { return []; }
                }
                return raw as Array<{ tool: string; instruction: string }>;
              })()}
              workflowName={dagEditorWorkflow.workflow_name}
              onSave={(dag) => {
 // Option A: Aus dem Formular → Graph nur in den Formular-State
                // übernehmen (Speichern passiert mit dem Formular-Submit zusammen);
                // aus der Karten-Liste → direkt persistieren.
                if (dagEditorFromForm) {
                  setFormDag(dag);
                  setDagEditorOpen(false);
                  setDagEditorFromForm(false);
                  toast.success(t('admin:workflows_tab.dag_form_applied', { defaultValue: 'Graph übernommen — Workflow jetzt speichern.' }));
                  return;
                }
                learnWorkflowMutation.mutate({
                  id_uuid: dagEditorWorkflow.id_uuid,
                  workflow_name: dagEditorWorkflow.workflow_name,
                  workflow_description: dagEditorWorkflow.workflow_description || '',
                  tool_chain_sequence: (() => {
                    const raw = dagEditorWorkflow.tool_chain_sequence;
                    if (typeof raw === 'string') {
                      try { return JSON.parse(raw) as Array<{ tool: string; instruction: string }>; } catch { return []; }
                    }
                    return raw as Array<{ tool: string; instruction: string }>;
                  })(),
                  trigger_type: dagEditorWorkflow.trigger_type || 'MANUAL',
                  trigger_config: dagEditorWorkflow.trigger_config || {},
                  is_active: dagEditorWorkflow.is_active !== false,
                  direct_send_email: dagEditorWorkflow.direct_send_email === true,
                  dag_structure: dag as unknown as Record<string, unknown>
                }, {
                  onSuccess: () => {
                    toast.success(t('admin:workflows_tab.dag_saved_toast', { defaultValue: 'Graph gespeichert!' }));
                    setDagEditorOpen(false);
                  },
                  onError: () => {
                    toast.error(t('admin:workflows_tab.dag_save_error', { defaultValue: 'Graph konnte nicht gespeichert werden.' }));
                  }
                });
              }}
              onCancel={() => setDagEditorOpen(false)}
              onConvertLinear={() => {
                // „Linear → DAG": Editor zeigt die lineare Sequenz als Graph
                // (der Editor initialisiert sich selbst aus linearSequence, sobald
                // kein initialDag gesetzt ist — hier nur das Overlay frisch rendern)
                setDagEditorWorkflow({ ...dagEditorWorkflow, dag_structure: null });
              }}
            />
          </div>
        </div>
      )}

      {/* 4C (T8b): Dry-Run-Ergebnis-Modal */}
      {dryRunOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setDryRunOpen(false)}>
          <div
            data-testid="dry-run-modal"
            className="bg-primary-dark border border-white/10 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6 space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-black text-white font-display flex items-center gap-2">
                <FlaskConical size={16} className="text-cyan-400" />
                {t('admin:workflows_tab.dry_run_title', { defaultValue: 'Dry-Run: Simulation' })}
              </h4>
              <button onClick={() => setDryRunOpen(false)} className="text-slate-400 hover:text-white p-1 cursor-pointer">
                <X size={16} />
              </button>
            </div>

            {dryRunQuery.isFetching ? (
              <p className="text-xs text-slate-400 font-sans">{t('common:loading', { defaultValue: 'Wird ausgeführt...' })}</p>
            ) : dryRunQuery.error ? (
              <p className="text-xs text-red-400 font-sans">{String(dryRunQuery.error.message || dryRunQuery.error)}</p>
            ) : dryRunQuery.data ? (
              <div className="space-y-4 font-sans" data-testid="dry-run-result">
                {/* Status-Badge */}
                <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-black uppercase tracking-wider ${dryRunQuery.data.valid ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                  {dryRunQuery.data.valid ? <Check size={13} /> : <X size={13} />}
                  {dryRunQuery.data.valid
                    ? t('admin:workflows_tab.dry_run_valid', { defaultValue: 'Strukturell gültig' })
                    : t('admin:workflows_tab.dry_run_invalid', { defaultValue: 'Probleme gefunden' })}
                </div>

                {/* Kennzahlen */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-primary-light/20 rounded-xl p-3">
                    <p className="text-lg font-black text-white">{dryRunQuery.data.node_count}</p>
                    <p className="text-[9px] text-slate-500 uppercase tracking-widest">{t('admin:workflows_tab.dry_run_nodes', { defaultValue: 'Knoten' })}</p>
                  </div>
                  <div className="bg-primary-light/20 rounded-xl p-3">
                    <p className="text-lg font-black text-white">{dryRunQuery.data.path_count}</p>
                    <p className="text-[9px] text-slate-500 uppercase tracking-widest">{t('admin:workflows_tab.dry_run_paths', { defaultValue: 'Pfade' })}</p>
                  </div>
                  <div className="bg-primary-light/20 rounded-xl p-3">
                    <p className="text-lg font-black text-white">{dryRunQuery.data.longest_path_length}</p>
                    <p className="text-[9px] text-slate-500 uppercase tracking-widest">Max. Tiefe</p>
                  </div>
                </div>

                {/* Zusammenfassung */}
                {dryRunQuery.data.summary.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t('admin:workflows_tab.dry_run_summary', { defaultValue: 'Zusammenfassung' })}</p>
                    {dryRunQuery.data.summary.map((s, i) => (
                      <p key={i} className="text-[11px] text-slate-300 leading-relaxed">• {s}</p>
                    ))}
                  </div>
                )}

                {/* Knoten-Details */}
                <div className="space-y-1.5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t('admin:workflows_tab.dry_run_nodes', { defaultValue: 'Knoten' })}</p>
                  {dryRunQuery.data.nodes.map((n) => (
                    <div key={n.node_id} className={`rounded-xl border px-3 py-2 ${n.reachable ? 'border-white/10' : 'border-red-500/30'}`}>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-mono font-bold text-slate-400">{n.node_id}</span>
                        <span className="text-[11px] font-bold text-white truncate flex-1">{n.name}</span>
                        {n.has_side_effect && (
                          <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-400 font-mono uppercase">
                            {t('admin:workflows_tab.dry_run_side_effect', { defaultValue: 'Seiteneffekt' })}
                          </span>
                        )}
                        {!n.reachable && <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-red-500/15 border border-red-500/40 text-red-400 font-mono uppercase">Toter Pfad</span>}
                      </div>
                      {n.warnings.length > 0 ? (
                        <div className="mt-1 space-y-0.5">
                          {n.warnings.map((w, wi) => (
                            <p key={wi} className="text-[10px] text-amber-400/90">⚠ {w}</p>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[9px] text-slate-600 mt-0.5">{t('admin:workflows_tab.dry_run_no_warnings', { defaultValue: 'Keine Warnungen' })}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
