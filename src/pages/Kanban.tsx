import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { 
  KanbanSquare, 
  Plus, 
  Search, 
  Filter, 
  MoreVertical, 
  Edit3, 
  Trash2, 
  Calendar, 
  User, 
  Building2, 
  Contact, 
  Tag, 
  ChevronLeft, 
  ChevronRight, 
  Star, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  Layers,
  Sparkles,
  MoveHorizontal,
  X
} from 'lucide-react';
import { trpc } from '../lib/trpc';
import { Dialog } from '../components/ui/Dialog';
import { toast } from 'sonner';
import { KanbanBoard, KanbanColumn, KanbanCard, KanbanBoardData } from '../types';

export const Kanban: React.FC = () => {
  const { t } = useTranslation(['kanban', 'common']);
  const utils = trpc.useUtils();

  // Selected Board State
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);

  // Filters State
  const [searchTerm, setSearchTerm] = useState('');
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterUser, setFilterUser] = useState<string>('all');
  const [filterCompany, setFilterCompany] = useState<string>('all');

  // Modal States
  const [isBoardModalOpen, setIsBoardModalOpen] = useState(false);
  const [editingBoard, setEditingBoard] = useState<KanbanBoard | null>(null);
  const [boardTitle, setBoardTitle] = useState('');
  const [boardDescription, setBoardDescription] = useState('');
  const [boardColor, setBoardColor] = useState('#3b82f6');
  const [boardIsDefault, setBoardIsDefault] = useState(false);

  const [isColumnModalOpen, setIsColumnModalOpen] = useState(false);
  const [editingColumn, setEditingColumn] = useState<KanbanColumn | null>(null);
  const [columnTitle, setColumnTitle] = useState('');
  const [columnColorAccent, setColumnColorAccent] = useState('#64748b');

  const [isCardModalOpen, setIsCardModalOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<KanbanCard | null>(null);
  const [cardTargetColumnId, setCardTargetColumnId] = useState<string>('');
  const [cardTitle, setCardTitle] = useState('');
  const [cardDescription, setCardDescription] = useState('');
  const [cardPriority, setCardPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [cardDueDate, setCardDueDate] = useState('');
  const [cardAssignedUser, setCardAssignedUser] = useState('');
  const [cardCompanyId, setCardCompanyId] = useState<string>('');
  const [cardContactId, setCardContactId] = useState<string>('');
  const [cardLabels, setCardLabels] = useState<string[]>([]);
  const [labelInput, setLabelInput] = useState('');

  // Searchable Company & Contact Select State
  const [companySearch, setCompanySearch] = useState('');
  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [isContactDropdownOpen, setIsContactDropdownOpen] = useState(false);

  // Drag & Drop State
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);

  // Delete Confirmation Modal State
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState<{
    type: 'board' | 'column' | 'card';
    id: string;
    title: string;
  } | null>(null);

  // Canvas Horizontal Scroll Ref & Helpers
  const boardContainerRef = React.useRef<HTMLDivElement>(null);
  const pillsContainerRef = React.useRef<HTMLDivElement>(null);

  const handleScrollBoard = (direction: 'left' | 'right') => {
    if (boardContainerRef.current) {
      const scrollAmount = direction === 'left' ? -320 : 320;
      boardContainerRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const handleScrollPills = (direction: 'left' | 'right') => {
    if (pillsContainerRef.current) {
      const scrollAmount = direction === 'left' ? -200 : 200;
      pillsContainerRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const handleScrollToColumn = (columnId: string) => {
    const colElement = document.getElementById(`kanban-col-${columnId}`);
    if (colElement) {
      colElement.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    }
  };

  // Queries
  const { data: boards, isLoading: isLoadingBoards } = trpc.getBoards.useQuery();

  React.useEffect(() => {
    if (!selectedBoardId && boards && boards.length > 0) {
      const defaultBoard = boards.find(b => b.is_default) || boards[0];
      if (defaultBoard.id_uuid) {
        setSelectedBoardId(defaultBoard.id_uuid);
      }
    }
  }, [boards, selectedBoardId]);

  const activeBoardId = selectedBoardId || (boards && boards.length > 0 ? (boards.find(b => b.is_default) || boards[0]).id_uuid : null);

  const { data: boardDetails, isLoading: isLoadingDetails } = trpc.getBoardDetails.useQuery(
    { board_id_uuid: activeBoardId! },
    { enabled: !!activeBoardId }
  );

  const { data: companies } = trpc.getCompanies.useQuery();
  const { data: contacts } = trpc.getContacts.useQuery();

  // Mutations
  const createBoardMutation = trpc.createBoard.useMutation({
    onSuccess: (res) => {
      toast.success(t('kanban:board_created', { defaultValue: 'Kanban-Board erfolgreich erstellt' }));
      utils.getBoards.invalidate();
      setSelectedBoardId(res.id_uuid);
      setIsBoardModalOpen(false);
    },
    onError: (err) => toast.error(t('kanban:error_creating', { defaultValue: 'Fehler beim Erstellen: ' }) + err.message)
  });

  const updateBoardMutation = trpc.updateBoard.useMutation({
    onSuccess: () => {
      toast.success(t('kanban:board_updated', { defaultValue: 'Board aktualisiert' }));
      utils.getBoards.invalidate();
      if (activeBoardId) utils.getBoardDetails.invalidate({ board_id_uuid: activeBoardId });
      setIsBoardModalOpen(false);
    },
    onError: (err) => toast.error(t('kanban:error_updating', { defaultValue: 'Fehler beim Aktualisieren: ' }) + err.message)
  });

  const deleteBoardMutation = trpc.deleteBoard.useMutation({
    onSuccess: () => {
      toast.success(t('kanban:board_deleted', { defaultValue: 'Board gelöscht' }));
      setSelectedBoardId(null);
      utils.getBoards.invalidate();
      setIsBoardModalOpen(false);
    },
    onError: (err) => toast.error(t('kanban:error_deleting', { defaultValue: 'Fehler beim Löschen: ' }) + err.message)
  });

  const createColumnMutation = trpc.createColumn.useMutation({
    onSuccess: () => {
      toast.success(t('kanban:column_created', { defaultValue: 'Spalte erstellt' }));
      if (activeBoardId) utils.getBoardDetails.invalidate({ board_id_uuid: activeBoardId });
      setIsColumnModalOpen(false);
    },
    onError: (err) => toast.error(t('kanban:error', { defaultValue: 'Fehler: ' }) + err.message)
  });

  const updateColumnMutation = trpc.updateColumn.useMutation({
    onSuccess: () => {
      toast.success(t('kanban:column_updated', { defaultValue: 'Spalte aktualisiert' }));
      if (activeBoardId) utils.getBoardDetails.invalidate({ board_id_uuid: activeBoardId });
      setIsColumnModalOpen(false);
    },
    onError: (err) => toast.error(t('kanban:error', { defaultValue: 'Fehler: ' }) + err.message)
  });

  const deleteColumnMutation = trpc.deleteColumn.useMutation({
    onSuccess: () => {
      toast.success(t('kanban:column_deleted', { defaultValue: 'Spalte gelöscht' }));
      if (activeBoardId) utils.getBoardDetails.invalidate({ board_id_uuid: activeBoardId });
      setIsColumnModalOpen(false);
    },
    onError: (err) => toast.error(t('kanban:error', { defaultValue: 'Fehler: ' }) + err.message)
  });

  const reorderColumnsMutation = trpc.reorderColumns.useMutation({
    onSuccess: () => {
      toast.success(t('kanban:column_order_updated', { defaultValue: 'Spalten-Reihenfolge aktualisiert' }));
      if (activeBoardId) utils.getBoardDetails.invalidate({ board_id_uuid: activeBoardId });
    },
    onError: (err) => toast.error(t('kanban:error_moving', { defaultValue: 'Fehler beim Verschieben: ' }) + err.message)
  });

  const createCardMutation = trpc.createCard.useMutation({
    onSuccess: () => {
      toast.success(t('kanban:task_created', { defaultValue: 'Aufgabe erstellt' }));
      if (activeBoardId) utils.getBoardDetails.invalidate({ board_id_uuid: activeBoardId });
      setIsCardModalOpen(false);
    },
    onError: (err) => toast.error(t('kanban:error', { defaultValue: 'Fehler: ' }) + err.message)
  });

  const updateCardMutation = trpc.updateCard.useMutation({
    onSuccess: () => {
      toast.success(t('kanban:task_updated', { defaultValue: 'Aufgabe aktualisiert' }));
      if (activeBoardId) utils.getBoardDetails.invalidate({ board_id_uuid: activeBoardId });
      setIsCardModalOpen(false);
    },
    onError: (err) => toast.error(t('kanban:error', { defaultValue: 'Fehler: ' }) + err.message)
  });

  const deleteCardMutation = trpc.deleteCard.useMutation({
    onSuccess: () => {
      toast.success(t('kanban:task_deleted', { defaultValue: 'Aufgabe gelöscht' }));
      if (activeBoardId) utils.getBoardDetails.invalidate({ board_id_uuid: activeBoardId });
      setIsCardModalOpen(false);
    },
    onError: (err) => toast.error(t('kanban:error', { defaultValue: 'Fehler: ' }) + err.message)
  });

  const moveCardMutation = trpc.moveCard.useMutation({
    onSuccess: () => {
      if (activeBoardId) utils.getBoardDetails.invalidate({ board_id_uuid: activeBoardId });
    },
    onError: (err) => toast.error(t('kanban:error_moving', { defaultValue: 'Fehler beim Verschieben: ' }) + err.message)
  });

  // Unique lists for filter options
  const assignedUsersList = useMemo(() => {
    if (!boardDetails) return [];
    const set = new Set<string>();
    boardDetails.columns.forEach(col => {
      col.cards.forEach(card => {
        if (card.assigned_user) set.add(card.assigned_user);
      });
    });
    return Array.from(set);
  }, [boardDetails]);

  // Card filter logic
  const filteredColumns = useMemo(() => {
    if (!boardDetails) return [];
    return boardDetails.columns.map(col => {
      const filteredCards = col.cards.filter(card => {
        // Search term
        if (searchTerm) {
          const term = searchTerm.toLowerCase();
          const matchTitle = card.title.toLowerCase().includes(term);
          const matchDesc = (card.description || '').toLowerCase().includes(term);
          const matchUser = (card.assigned_user || '').toLowerCase().includes(term);
          const matchLabels = (card.labels || []).some(l => l.toLowerCase().includes(term));
          if (!matchTitle && !matchDesc && !matchUser && !matchLabels) return false;
        }
        // Priority
        if (filterPriority !== 'all' && card.priority !== filterPriority) return false;
        // User
        if (filterUser !== 'all' && card.assigned_user !== filterUser) return false;
        // Company
        if (filterCompany !== 'all' && card.company_id_uuid !== filterCompany) return false;

        return true;
      });

      return {
        ...col,
        cards: filteredCards
      };
    });
  }, [boardDetails, searchTerm, filterPriority, filterUser, filterCompany]);

  // Stats
  const stats = useMemo(() => {
    if (!boardDetails) return { total: 0, urgent: 0, completed: 0, inProgress: 0 };
    let total = 0;
    let urgent = 0;
    let completed = 0;
    let inProgress = 0;

    boardDetails.columns.forEach(col => {
      const isDoneCol = col.title.toLowerCase().includes('erledigt') || col.title.toLowerCase().includes('done') || col.title.toLowerCase().includes('abgeschlossen');
      const isInProgressCol = col.title.toLowerCase().includes('bearbeitung') || col.title.toLowerCase().includes('progress');

      col.cards.forEach(card => {
        total++;
        if (card.priority === 'urgent') urgent++;
        if (isDoneCol) completed++;
        if (isInProgressCol) inProgress++;
      });
    });

    return { total, urgent, completed, inProgress };
  }, [boardDetails]);

  // Handlers for Board Modal
  const handleOpenNewBoardModal = () => {
    setEditingBoard(null);
    setBoardTitle('');
    setBoardDescription('');
    setBoardColor('#3b82f6');
    setBoardIsDefault(false);
    setIsBoardModalOpen(true);
  };

  const handleOpenEditBoardModal = (board: { id_uuid?: string; title?: string; description?: string | null; color?: string; is_default?: boolean }) => {
    setEditingBoard({
      id_uuid: board.id_uuid,
      tenant_id: '1',
      title: board.title || '',
      description: board.description || '',
      color: board.color || '#3b82f6',
      is_default: board.is_default || false,
      created_at_utc: new Date(),
      updated_at_utc: new Date()
    });
    setBoardTitle(board.title || '');
    setBoardDescription(board.description || '');
    setBoardColor(board.color || '#3b82f6');
    setBoardIsDefault(board.is_default || false);
    setIsBoardModalOpen(true);
  };

  const handleSaveBoard = (e: React.FormEvent) => {
    e.preventDefault();
    if (!boardTitle.trim()) return toast.error(t('kanban:enter_title_prompt', { defaultValue: 'Bitte einen Titel angeben' }));

    if (editingBoard && editingBoard.id_uuid) {
      updateBoardMutation.mutate({
        id_uuid: editingBoard.id_uuid,
        title: boardTitle,
        description: boardDescription,
        color: boardColor,
        is_default: boardIsDefault
      });
    } else {
      createBoardMutation.mutate({
        title: boardTitle,
        description: boardDescription,
        color: boardColor,
        is_default: boardIsDefault
      });
    }
  };

  // Handlers for Column Modal
  const handleOpenNewColumnModal = () => {
    if (!activeBoardId) return;
    setEditingColumn(null);
    setColumnTitle('');
    setColumnColorAccent('#64748b');
    setIsColumnModalOpen(true);
  };

  const handleOpenEditColumnModal = (col: KanbanColumn) => {
    setEditingColumn(col);
    setColumnTitle(col.title);
    setColumnColorAccent(col.color_accent || '#64748b');
    setIsColumnModalOpen(true);
  };

  const handleSaveColumn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!columnTitle.trim() || !activeBoardId) return toast.error(t('kanban:title_required', { defaultValue: 'Titel erforderlich' }));

    if (editingColumn) {
      updateColumnMutation.mutate({
        id_uuid: editingColumn.id_uuid,
        board_id: activeBoardId,
        title: columnTitle,
        position: editingColumn.position,
        color_accent: columnColorAccent
      });
    } else {
      const nextPos = boardDetails ? boardDetails.columns.length : 0;
      createColumnMutation.mutate({
        board_id: activeBoardId,
        title: columnTitle,
        position: nextPos,
        color_accent: columnColorAccent
      });
    }
  };

  const filteredCompaniesForCard = useMemo(() => {
    if (!companies) return [];
    if (!companySearch.trim()) return companies;
    const q = companySearch.toLowerCase();
    return companies.filter(c =>
      (c.full_legal_name && c.full_legal_name.toLowerCase().includes(q)) ||
      (c.short_code && c.short_code.toLowerCase().includes(q)) ||
      (c.city && c.city.toLowerCase().includes(q))
    );
  }, [companies, companySearch]);

  const filteredContactsForCard = useMemo(() => {
    if (!contacts) return [];
    if (!contactSearch.trim()) return contacts;
    const q = contactSearch.toLowerCase();
    return contacts.filter(c =>
      (c.first_name && c.first_name.toLowerCase().includes(q)) ||
      (c.last_name && c.last_name.toLowerCase().includes(q)) ||
      (c.email_address && c.email_address.toLowerCase().includes(q)) ||
      (c.company_name && c.company_name.toLowerCase().includes(q))
    );
  }, [contacts, contactSearch]);

  const handleMoveColumnDirection = (colIdx: number, direction: 'left' | 'right') => {
    if (!boardDetails?.columns || !activeBoardId) return;
    const cols = [...boardDetails.columns];
    const targetIdx = direction === 'left' ? colIdx - 1 : colIdx + 1;
    if (targetIdx < 0 || targetIdx >= cols.length) return;

    // Swap columns
    const temp = cols[colIdx];
    cols[colIdx] = cols[targetIdx];
    cols[targetIdx] = temp;

    const columnIdsInOrder = cols.map(c => c.id_uuid);
    reorderColumnsMutation.mutate({
      board_id_uuid: activeBoardId,
      column_ids_in_order: columnIdsInOrder
    });
  };

  // Handlers for Card Modal
  const handleOpenNewCardModal = (columnId: string) => {
    if (!activeBoardId) return;
    setEditingCard(null);
    setCardTargetColumnId(columnId);
    setCardTitle('');
    setCardDescription('');
    setCardPriority('medium');
    setCardDueDate('');
    setCardAssignedUser('');
    setCardCompanyId('');
    setCardContactId('');
    setCardLabels([]);
    setLabelInput('');
    setCompanySearch('');
    setIsCompanyDropdownOpen(false);
    setContactSearch('');
    setIsContactDropdownOpen(false);
    setIsCardModalOpen(true);
  };

  const handleOpenEditCardModal = (card: KanbanCard) => {
    setEditingCard(card);
    setCardTargetColumnId(card.column_id);
    setCardTitle(card.title);
    setCardDescription(card.description || '');
    setCardPriority(card.priority || 'medium');
    setCardDueDate(card.due_date || '');
    setCardAssignedUser(card.assigned_user || '');
    setCardCompanyId(card.company_id_uuid || '');
    setCardContactId(card.contact_id_uuid || '');
    setCardLabels(card.labels || []);
    setLabelInput('');
    setCompanySearch('');
    setIsCompanyDropdownOpen(false);
    setContactSearch('');
    setIsContactDropdownOpen(false);
    setIsCardModalOpen(true);
  };

  const handleAddLabel = () => {
    const trimmed = labelInput.trim();
    if (trimmed && !cardLabels.includes(trimmed)) {
      setCardLabels([...cardLabels, trimmed]);
      setLabelInput('');
    }
  };

  const handleRemoveLabel = (labelToRemove: string) => {
    setCardLabels(cardLabels.filter(l => l !== labelToRemove));
  };

  const handleSaveCard = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cardTitle.trim() || !activeBoardId || !cardTargetColumnId) return toast.error(t('kanban:title_and_column_required', { defaultValue: 'Titel und Spalte erforderlich' }));

    if (editingCard) {
      updateCardMutation.mutate({
        id_uuid: editingCard.id_uuid,
        board_id: activeBoardId,
        column_id: cardTargetColumnId,
        title: cardTitle,
        description: cardDescription,
        priority: cardPriority,
        position: editingCard.position,
        due_date: cardDueDate || null,
        assigned_user: cardAssignedUser || null,
        company_id_uuid: cardCompanyId || null,
        contact_id_uuid: cardContactId || null,
        labels: cardLabels
      });
    } else {
      const targetCol = boardDetails?.columns.find(c => c.id_uuid === cardTargetColumnId);
      const nextPos = targetCol ? targetCol.cards.length : 0;

      createCardMutation.mutate({
        board_id: activeBoardId,
        column_id: cardTargetColumnId,
        title: cardTitle,
        description: cardDescription,
        priority: cardPriority,
        position: nextPos,
        due_date: cardDueDate || null,
        assigned_user: cardAssignedUser || null,
        company_id_uuid: cardCompanyId || null,
        contact_id_uuid: cardContactId || null,
        labels: cardLabels
      });
    }
  };

  // Drag & Drop Handlers
  const handleDragStart = (e: React.DragEvent, cardId: string) => {
    e.dataTransfer.setData('text/plain', cardId);
    e.dataTransfer.effectAllowed = 'move';
    setDraggedCardId(cardId);
  };

  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverColumnId !== columnId) {
      setDragOverColumnId(columnId);
    }
  };

  const handleDragLeave = () => {
    setDragOverColumnId(null);
  };

  const handleDrop = (e: React.DragEvent, targetColumnId: string) => {
    e.preventDefault();
    setDragOverColumnId(null);
    const cardId = e.dataTransfer.getData('text/plain') || draggedCardId;
    if (!cardId) return;

    // Calculate new position
    const targetCol = boardDetails?.columns.find(c => c.id_uuid === targetColumnId);
    const newPos = targetCol ? targetCol.cards.length : 0;

    moveCardMutation.mutate({
      card_id_uuid: cardId,
      target_column_id_uuid: targetColumnId,
      new_position: newPos
    });
    setDraggedCardId(null);
  };

  // Quick move card left or right
  const handleMoveCardDirection = (card: KanbanCard, direction: 'left' | 'right') => {
    if (!boardDetails) return;
    const currentColIndex = boardDetails.columns.findIndex(c => c.id_uuid === card.column_id);
    if (currentColIndex === -1) return;

    const targetColIndex = direction === 'left' ? currentColIndex - 1 : currentColIndex + 1;
    if (targetColIndex < 0 || targetColIndex >= boardDetails.columns.length) return;

    const targetCol = boardDetails.columns[targetColIndex];
    moveCardMutation.mutate({
      card_id_uuid: card.id_uuid,
      target_column_id_uuid: targetCol.id_uuid,
      new_position: targetCol.cards.length
    });
  };

  const getPriorityBadgeClass = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'high': return 'bg-accent-orange/10 text-accent-orange border-accent-orange/20';
      case 'medium': return 'bg-accent-blue/10 text-accent-blue border-accent-blue/20';
      case 'low': return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
      default: return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  };

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case 'urgent': return t('kanban:priority_urgent', { defaultValue: 'Dringend' });
      case 'high': return t('kanban:priority_high', { defaultValue: 'Hoch' });
      case 'medium': return t('kanban:priority_medium', { defaultValue: 'Mittel' });
      case 'low': return t('kanban:priority_low', { defaultValue: 'Niedrig' });
      default: return priority;
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header & Navigation */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-3 bg-accent-orange/10 rounded-2xl border border-accent-orange/20 text-accent-orange">
              <KanbanSquare size={26} />
            </div>
            <div>
              <h1 className="text-3xl font-black text-white uppercase tracking-tight font-display italic">
                Kanban <span className="text-accent-orange">Board</span>
              </h1>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest font-display italic">
                {t('kanban:subtitle', { defaultValue: 'Projekte, Aufgaben & CRM-Workflows verwalten' })}
              </p>
            </div>
          </div>
        </div>

        {/* Board Switcher & Board Actions */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <select
              value={activeBoardId || ''}
              onChange={(e) => setSelectedBoardId(e.target.value)}
              className="bg-primary-light border border-white/10 text-white font-bold text-sm px-4 py-2.5 rounded-xl appearance-none pr-10 focus:outline-none focus:border-accent-orange transition-colors cursor-pointer"
            >
              {boards?.map((b) => (
                <option key={b.id_uuid} value={b.id_uuid} className="bg-primary-dark text-white">
                  {b.is_default ? `⭐ ${b.title}` : b.title}
                </option>
              ))}
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
              ▼
            </div>
          </div>

          <button
            onClick={handleOpenNewBoardModal}
            className="flex items-center gap-2 px-4 py-2.5 bg-accent-orange hover:bg-accent-orange/90 text-white font-bold text-sm rounded-xl transition-all shadow-lg shadow-accent-orange/20"
          >
            <Plus size={18} />
            <span className="hidden sm:inline">{t('kanban:new_board', { defaultValue: 'Neues Board' })}</span>
          </button>

          {boardDetails?.board && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleOpenEditBoardModal(boardDetails.board)}
                className="p-2.5 bg-primary-light hover:bg-white/10 text-slate-300 hover:text-white rounded-xl border border-white/10 transition-colors"
                title={t('kanban:board_settings', { defaultValue: 'Board Einstellungen' })}
              >
                <Edit3 size={18} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (boardDetails?.board?.id_uuid) {
                    setConfirmDeleteTarget({
                      type: 'board',
                      id: boardDetails.board.id_uuid,
                      title: boardDetails.board.title
                    });
                  }
                }}
                className="p-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl border border-red-500/20 transition-colors"
                title={t('kanban:delete_board', { defaultValue: 'Board löschen' })}
              >
                <Trash2 size={18} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Metrics Cards Banner */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-primary-light/50 border border-white/5 rounded-2xl p-3 sm:p-4 flex items-center gap-2.5 sm:gap-4 min-w-0">
          <div className="p-2.5 sm:p-3 bg-blue-500/10 text-blue-400 rounded-xl border border-blue-500/20 shrink-0">
            <Layers size={20} className="sm:w-[22px] sm:h-[22px]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate">{t('kanban:total_tasks', { defaultValue: 'Gesamt Aufgaben' })}</p>
            <p className="text-xl sm:text-2xl font-black text-white">{stats.total}</p>
          </div>
        </div>

        <div className="bg-primary-light/50 border border-white/5 rounded-2xl p-3 sm:p-4 flex items-center gap-2.5 sm:gap-4 min-w-0">
          <div className="p-2.5 sm:p-3 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20 shrink-0">
            <Clock size={20} className="sm:w-[22px] sm:h-[22px]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate">{t('kanban:in_progress', { defaultValue: 'In Bearbeitung' })}</p>
            <p className="text-xl sm:text-2xl font-black text-white">{stats.inProgress}</p>
          </div>
        </div>

        <div className="bg-primary-light/50 border border-white/5 rounded-2xl p-3 sm:p-4 flex items-center gap-2.5 sm:gap-4 min-w-0">
          <div className="p-2.5 sm:p-3 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20 shrink-0">
            <CheckCircle2 size={20} className="sm:w-[22px] sm:h-[22px]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate">{t('kanban:completed', { defaultValue: 'Abgeschlossen' })}</p>
            <p className="text-xl sm:text-2xl font-black text-white">{stats.completed}</p>
          </div>
        </div>

        <div className="bg-primary-light/50 border border-white/5 rounded-2xl p-3 sm:p-4 flex items-center gap-2.5 sm:gap-4 min-w-0">
          <div className="p-2.5 sm:p-3 bg-red-500/10 text-red-400 rounded-xl border border-red-500/20 shrink-0">
            <AlertCircle size={20} className="sm:w-[22px] sm:h-[22px]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate">{t('kanban:urgent', { defaultValue: 'Dringend' })}</p>
            <p className="text-xl sm:text-2xl font-black text-red-400">{stats.urgent}</p>
          </div>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="bg-primary-light/30 border border-white/5 rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Search Input */}
        <div className="relative w-full md:w-80">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder={t('kanban:search_placeholder', { defaultValue: 'Aufgaben & Tags durchsuchen...' })}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-primary-dark/80 border border-white/10 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-accent-orange transition-colors"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {/* Priority filter */}
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-slate-500" />
            <select
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              className="bg-primary-dark border border-white/10 text-xs font-bold text-slate-300 px-3 py-2 rounded-xl focus:outline-none focus:border-accent-orange cursor-pointer"
            >
              <option value="all">{t('kanban:filter_priority_all', { defaultValue: 'Priorität: Alle' })}</option>
              <option value="urgent">{t('kanban:priority_urgent', { defaultValue: 'Dringend' })}</option>
              <option value="high">{t('kanban:priority_high', { defaultValue: 'Hoch' })}</option>
              <option value="medium">{t('kanban:priority_medium', { defaultValue: 'Mittel' })}</option>
              <option value="low">{t('kanban:priority_low', { defaultValue: 'Niedrig' })}</option>
            </select>
          </div>

          {/* Assigned User filter */}
          {assignedUsersList.length > 0 && (
            <select
              value={filterUser}
              onChange={(e) => setFilterUser(e.target.value)}
              className="bg-primary-dark border border-white/10 text-xs font-bold text-slate-300 px-3 py-2 rounded-xl focus:outline-none focus:border-accent-orange cursor-pointer"
            >
              <option value="all">{t('kanban:filter_user_all', { defaultValue: 'Bearbeiter: Alle' })}</option>
              {assignedUsersList.map(u => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          )}

          {/* Company filter */}
          {companies && companies.length > 0 && (
            <select
              value={filterCompany}
              onChange={(e) => setFilterCompany(e.target.value)}
              className="bg-primary-dark border border-white/10 text-xs font-bold text-slate-300 px-3 py-2 rounded-xl focus:outline-none focus:border-accent-orange cursor-pointer max-w-[180px] truncate"
            >
              <option value="all">{t('kanban:filter_company_all', { defaultValue: 'Firma: Alle' })}</option>
              {companies.map(c => (
                <option key={c.id_uuid} value={c.id_uuid}>{c.full_legal_name}</option>
              ))}
            </select>
          )}

          {(searchTerm || filterPriority !== 'all' || filterUser !== 'all' || filterCompany !== 'all') && (
            <button
              onClick={() => {
                setSearchTerm('');
                setFilterPriority('all');
                setFilterUser('all');
                setFilterCompany('all');
              }}
              className="text-xs text-accent-orange hover:underline font-bold px-2"
            >
              {t('kanban:reset_filters', { defaultValue: 'Filter zurücksetzen' })}
            </button>
          )}

          {/* Board Horizontal Scroll Controls */}
          <div className="flex items-center gap-1 border-l border-white/10 pl-2 shrink-0">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider hidden lg:inline mr-1">
              {t('kanban:board_label', { defaultValue: 'Board:' })}
            </span>
            <button
              onClick={() => handleScrollBoard('left')}
              className="p-2 bg-primary-dark hover:bg-white/10 text-slate-300 hover:text-white rounded-xl border border-white/10 transition-colors"
              title={t('kanban:scroll_board_left', { defaultValue: 'Board nach links scrollen' })}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => handleScrollBoard('right')}
              className="p-2 bg-primary-dark hover:bg-white/10 text-slate-300 hover:text-white rounded-xl border border-white/10 transition-colors"
              title={t('kanban:scroll_board_right', { defaultValue: 'Board nach rechts scrollen' })}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Kanban Board Canvas */}
      {isLoadingDetails ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <div className="w-8 h-8 border-4 border-accent-orange border-t-transparent rounded-full animate-spin mr-3" />
          <span>{t('kanban:loading_board_details', { defaultValue: 'Lade Board Details...' })}</span>
        </div>
      ) : !boardDetails ? (
        <div className="text-center py-20 text-slate-500 font-bold">
          {t('kanban:no_board_found', { defaultValue: 'Kein Kanban Board gefunden. Erstellen Sie ein neues Board.' })}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Column Jump Pills & Horizontal Scroll Controls for Small Screens / Touch */}
          {filteredColumns.length > 0 && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 bg-primary-light/20 border border-white/5 rounded-xl p-2 min-w-0">
              <div 
                ref={pillsContainerRef}
                className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 max-w-full min-w-0 flex-1 scroll-smooth"
              >
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-2 shrink-0 hidden sm:inline">
                  {t('kanban:columns_label', { defaultValue: 'Spalten:' })}
                </span>
                {filteredColumns.map((col) => (
                  <button
                    key={col.id_uuid}
                    onClick={() => handleScrollToColumn(col.id_uuid)}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-bold text-slate-300 hover:text-white shrink-0 border border-white/5 transition-all"
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: col.color_accent || '#64748b' }}
                    />
                    <span className="truncate max-w-[120px]">{col.title}</span>
                    <span className="text-[10px] text-slate-400 font-mono">({col.cards.length})</span>
                  </button>
                ))}
              </div>

              {/* Scroll Buttons for Spaltenübersicht Pills */}
              <div className="flex items-center justify-end gap-1 shrink-0">
                <button
                  onClick={() => handleScrollPills('left')}
                  className="p-1.5 bg-primary-dark hover:bg-white/10 text-slate-300 hover:text-white rounded-lg border border-white/10 transition-colors"
                  title={t('kanban:scroll_columns_left', { defaultValue: 'Spaltenübersicht nach links scrollen' })}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() => handleScrollPills('right')}
                  className="p-1.5 bg-primary-dark hover:bg-white/10 text-slate-300 hover:text-white rounded-lg border border-white/10 transition-colors"
                  title={t('kanban:scroll_columns_right', { defaultValue: 'Spaltenübersicht nach rechts scrollen' })}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Kanban Board Columns Horizontal Scroll Canvas */}
          <div 
            ref={boardContainerRef}
            className="flex gap-4 sm:gap-6 overflow-x-auto pb-6 pt-2 kanban-scrollbar min-h-[550px] snap-x snap-mandatory scroll-smooth"
          >
            {filteredColumns.map((col, colIdx) => (
              <div
                key={col.id_uuid}
                id={`kanban-col-${col.id_uuid}`}
                onDragOver={(e) => handleDragOver(e, col.id_uuid)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, col.id_uuid)}
                className={`w-[85vw] max-w-[340px] sm:w-80 shrink-0 snap-start bg-primary-light/40 border transition-all rounded-2xl flex flex-col max-h-[75vh] ${
                  dragOverColumnId === col.id_uuid 
                    ? 'border-accent-orange bg-accent-orange/5 shadow-[0_0_20px_rgba(255,103,22,0.15)]' 
                    : 'border-white/5 hover:border-white/10'
                }`}
              >
                {/* Column Header */}
                <div className="p-3.5 sm:p-4 border-b border-white/5 flex items-center justify-between bg-primary-dark/40 rounded-t-2xl gap-2 min-w-0">
                  <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                    <div
                      className="w-3 h-3 rounded-full shadow-sm shrink-0"
                      style={{ backgroundColor: col.color_accent || '#64748b' }}
                    />
                    <h3 
                      className="font-bold text-sm text-white tracking-wide truncate min-w-0"
                      title={col.title}
                    >
                      {col.title}
                    </h3>
                    <span className="text-xs font-mono font-bold px-2 py-0.5 bg-white/10 rounded-full text-slate-300 shrink-0">
                      {col.cards.length}
                    </span>
                  </div>

                  <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
                    {colIdx > 0 && (
                      <button
                        onClick={() => handleMoveColumnDirection(colIdx, 'left')}
                        className="p-1 sm:p-1.5 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                        title={t('kanban:move_column_left', { defaultValue: 'Spalte nach links verschieben' })}
                      >
                        <ChevronLeft size={14} />
                      </button>
                    )}
                    {colIdx < filteredColumns.length - 1 && (
                      <button
                        onClick={() => handleMoveColumnDirection(colIdx, 'right')}
                        className="p-1 sm:p-1.5 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                        title={t('kanban:move_column_right', { defaultValue: 'Spalte nach rechts verschieben' })}
                      >
                        <ChevronRight size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => handleOpenNewCardModal(col.id_uuid)}
                      className="p-1 sm:p-1.5 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                      title={t('kanban:add_task', { defaultValue: 'Aufgabe hinzufügen' })}
                    >
                      <Plus size={16} />
                    </button>
                    <button
                      onClick={() => handleOpenEditColumnModal(col)}
                      className="p-1 sm:p-1.5 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors"
                      title={t('kanban:edit_column', { defaultValue: 'Spalte bearbeiten' })}
                    >
                      <Edit3 size={14} />
                    </button>
                    {boardDetails.columns.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          if (col.id_uuid) {
                            setConfirmDeleteTarget({
                              type: 'column',
                              id: col.id_uuid,
                              title: col.title
                            });
                          }
                        }}
                        className="p-1 sm:p-1.5 hover:bg-red-500/20 text-slate-500 hover:text-red-400 rounded-lg transition-colors"
                        title={t('kanban:delete_column', { defaultValue: 'Spalte löschen' })}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

              {/* Cards List in Column */}
              <div className="p-3 overflow-y-auto space-y-3 flex-1 no-scrollbar">
                {col.cards.length === 0 ? (
                  <div className="text-center py-10 border-2 border-dashed border-white/5 rounded-xl text-xs text-slate-600 font-bold select-none">
                    {t('kanban:no_tasks', { defaultValue: 'Keine Aufgaben' })}
                  </div>
                ) : (
                  col.cards.map((card) => {
                    const linkedCompany = companies?.find(c => c.id_uuid === card.company_id_uuid);
                    const linkedContact = contacts?.find(c => c.id_uuid === card.contact_id_uuid);

                    return (
                      <motion.div
                        key={card.id_uuid}
                        layout
                        draggable
                        onDragStart={(e: React.DragEvent) => handleDragStart(e, card.id_uuid)}
                        className={`bg-primary-dark border border-white/10 hover:border-accent-orange/50 rounded-xl p-4 shadow-lg cursor-grab active:cursor-grabbing group transition-all relative ${
                          draggedCardId === card.id_uuid ? 'opacity-40 border-dashed border-accent-orange' : ''
                        }`}
                      >
                        {/* Top Metadata: Priority & Actions */}
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md border ${getPriorityBadgeClass(card.priority)}`}>
                            {getPriorityLabel(card.priority)}
                          </span>

                          {/* Quick Card Controls */}
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-primary-dark/90 px-1 py-0.5 rounded-lg border border-white/10">
                            {colIdx > 0 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  handleMoveCardDirection(card, 'left');
                                }}
                                className="p-1 text-slate-400 hover:text-white hover:bg-white/10 rounded"
                                title={t('kanban:move_left', { defaultValue: 'Nach links verschieben' })}
                              >
                                <ChevronLeft size={12} />
                              </button>
                            )}
                            {colIdx < filteredColumns.length - 1 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  handleMoveCardDirection(card, 'right');
                                }}
                                className="p-1 text-slate-400 hover:text-white hover:bg-white/10 rounded"
                                title={t('kanban:move_right', { defaultValue: 'Nach rechts verschieben' })}
                              >
                                <ChevronRight size={12} />
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                handleOpenEditCardModal(card);
                              }}
                              className="p-1 text-slate-400 hover:text-white hover:bg-white/10 rounded"
                              title={t('common:edit', { defaultValue: 'Bearbeiten' })}
                            >
                              <Edit3 size={12} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                if (card.id_uuid) {
                                  setConfirmDeleteTarget({
                                    type: 'card',
                                    id: card.id_uuid,
                                    title: card.title
                                  });
                                }
                              }}
                              className="p-1 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded"
                              title={t('common:delete', { defaultValue: 'Löschen' })}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>

                        {/* Card Title & Description */}
                        <h4 className="font-bold text-sm text-white mb-1 leading-snug line-clamp-2">
                          {card.title}
                        </h4>
                        {card.description && (
                          <p className="text-xs text-slate-400 line-clamp-2 mb-3 leading-relaxed">
                            {card.description}
                          </p>
                        )}

                        {/* Labels / Tags */}
                        {card.labels && card.labels.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-3">
                            {card.labels.map((lbl) => (
                              <span key={lbl} className="text-[10px] font-bold px-2 py-0.5 bg-white/5 border border-white/10 text-slate-300 rounded-md">
                                #{lbl}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* CRM Links (Company & Contact) */}
                        {(linkedCompany || linkedContact) && (
                          <div className="flex flex-wrap gap-2 mb-3 pt-2 border-t border-white/5">
                            {linkedCompany && (
                              <div className="flex items-center gap-1 text-[11px] font-semibold text-accent-blue bg-accent-blue/10 px-2 py-0.5 rounded-md border border-accent-blue/20 truncate max-w-full">
                                <Building2 size={12} className="shrink-0" />
                                <span className="truncate">{linkedCompany.full_legal_name}</span>
                              </div>
                            )}
                            {linkedContact && (
                              <div className="flex items-center gap-1 text-[11px] font-semibold text-accent-orange bg-accent-orange/10 px-2 py-0.5 rounded-md border border-accent-orange/20 truncate max-w-full">
                                <Contact size={12} className="shrink-0" />
                                <span className="truncate">{linkedContact.first_name} {linkedContact.last_name}</span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Footer Info: Due Date & Assigned User */}
                        <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium pt-2 border-t border-white/5">
                          {card.due_date ? (
                            <div className={`flex items-center gap-1 font-bold ${
                              new Date(card.due_date) < new Date() && !col.title.toLowerCase().includes('erledigt')
                                ? 'text-red-400' 
                                : 'text-slate-400'
                            }`}>
                              <Calendar size={12} />
                              <span>{new Date(card.due_date).toLocaleDateString('de-DE')}</span>
                            </div>
                          ) : (
                            <div />
                          )}

                          {card.assigned_user && (
                            <div className="flex items-center gap-1 text-slate-300 font-bold bg-white/5 px-2 py-0.5 rounded-full border border-white/10">
                              <User size={10} className="text-accent-orange" />
                              <span>{card.assigned_user}</span>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </div>

              {/* Column Footer: Quick Add Card */}
              <div className="p-3 border-t border-white/5 bg-primary-dark/20 rounded-b-2xl">
                <button
                  onClick={() => handleOpenNewCardModal(col.id_uuid)}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white rounded-xl text-xs font-bold transition-all border border-white/5"
                >
                  <Plus size={14} />
                  <span>{t('kanban:add_task', { defaultValue: 'Aufgabe hinzufügen' })}</span>
                </button>
              </div>
            </div>
          ))}

          {/* Add Column Button */}
          <button
            onClick={handleOpenNewColumnModal}
            className="w-[85vw] max-w-[340px] sm:w-80 shrink-0 snap-start h-24 border-2 border-dashed border-white/10 hover:border-accent-orange/50 bg-primary-light/10 hover:bg-accent-orange/5 rounded-2xl flex items-center justify-center gap-2 text-slate-400 hover:text-accent-orange font-bold text-sm transition-all"
          >
            <Plus size={20} />
            <span>{t('kanban:add_column', { defaultValue: 'Spalte hinzufügen' })}</span>
          </button>
        </div>
      </div>
      )}

      {/* --- MODALS --- */}

      {/* 1. Board Modal */}
      <Dialog
        isOpen={isBoardModalOpen}
        onClose={() => setIsBoardModalOpen(false)}
        title={editingBoard ? t('kanban:edit_board', { defaultValue: 'Board bearbeiten' }) : t('kanban:create_board', { defaultValue: 'Neues Board erstellen' })}
        size="md"
      >
        <form onSubmit={handleSaveBoard} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              {t('kanban:board_title_label', { defaultValue: 'Board Titel *' })}
            </label>
            <input
              type="text"
              required
              value={boardTitle}
              onChange={(e) => setBoardTitle(e.target.value)}
              placeholder={t('kanban:board_title_placeholder', { defaultValue: 'z.B. Vertriebs-Pipeline' })}
              className="w-full px-4 py-2.5 bg-primary-dark border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-accent-orange"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              {t('common:description', { defaultValue: 'Beschreibung' })}
            </label>
            <textarea
              rows={3}
              value={boardDescription}
              onChange={(e) => setBoardDescription(e.target.value)}
              placeholder={t('kanban:board_desc_placeholder', { defaultValue: 'Optionale Beschreibung des Boards...' })}
              className="w-full px-4 py-2.5 bg-primary-dark border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-accent-orange"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              {t('kanban:accent_color', { defaultValue: 'Akzentfarbe' })}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={boardColor}
                onChange={(e) => setBoardColor(e.target.value)}
                className="w-10 h-10 rounded-xl bg-transparent border border-white/10 cursor-pointer"
              />
              <span className="text-xs font-mono text-slate-400">{boardColor}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="is_default"
              checked={boardIsDefault}
              onChange={(e) => setBoardIsDefault(e.target.checked)}
              className="w-4 h-4 accent-accent-orange rounded"
            />
            <label htmlFor="is_default" className="text-xs font-bold text-slate-300 cursor-pointer">
              {t('kanban:set_as_default_board', { defaultValue: 'Als Standard-Board festlegen' })}
            </label>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-white/10">
            {editingBoard && (
              <button
                type="button"
                onClick={() => {
                  if (editingBoard.id_uuid) {
                    setConfirmDeleteTarget({
                      type: 'board',
                      id: editingBoard.id_uuid,
                      title: editingBoard.title
                    });
                    setIsBoardModalOpen(false);
                  }
                }}
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold text-xs rounded-xl border border-red-500/20 transition-colors"
              >
                {t('kanban:delete_board', { defaultValue: 'Board löschen' })}
              </button>
            )}
            <div className="flex items-center gap-3 ml-auto">
              <button
                type="button"
                onClick={() => setIsBoardModalOpen(false)}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 font-bold text-xs rounded-xl transition-colors"
              >
                {t('common:cancel', { defaultValue: 'Abbrechen' })}
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-accent-orange hover:bg-accent-orange/90 text-white font-bold text-xs rounded-xl transition-colors shadow-lg shadow-accent-orange/20"
              >
                {t('common:save', { defaultValue: 'Speichern' })}
              </button>
            </div>
          </div>
        </form>
      </Dialog>

      {/* 2. Column Modal */}
      <Dialog
        isOpen={isColumnModalOpen}
        onClose={() => setIsColumnModalOpen(false)}
        title={editingColumn ? t('kanban:edit_column', { defaultValue: 'Spalte bearbeiten' }) : t('kanban:create_column', { defaultValue: 'Neue Spalte erstellen' })}
        size="md"
      >
        <form onSubmit={handleSaveColumn} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              {t('kanban:column_title_label', { defaultValue: 'Spalten Titel *' })}
            </label>
            <input
              type="text"
              required
              value={columnTitle}
              onChange={(e) => setColumnTitle(e.target.value)}
              placeholder={t('kanban:column_title_placeholder', { defaultValue: 'z.B. Qualifiziert, Angebot gesendet' })}
              className="w-full px-4 py-2.5 bg-primary-dark border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-accent-orange"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              {t('kanban:column_color', { defaultValue: 'Spalten-Farbe' })}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={columnColorAccent}
                onChange={(e) => setColumnColorAccent(e.target.value)}
                className="w-10 h-10 rounded-xl bg-transparent border border-white/10 cursor-pointer"
              />
              <span className="text-xs font-mono text-slate-400">{columnColorAccent}</span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-white/10">
            {editingColumn && boardDetails?.columns && boardDetails.columns.length > 1 ? (
              <button
                type="button"
                onClick={() => {
                  if (editingColumn.id_uuid) {
                    setConfirmDeleteTarget({
                      type: 'column',
                      id: editingColumn.id_uuid,
                      title: editingColumn.title
                    });
                    setIsColumnModalOpen(false);
                  }
                }}
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold text-xs rounded-xl border border-red-500/20 transition-colors"
              >
                {t('kanban:delete_column', { defaultValue: 'Spalte löschen' })}
              </button>
            ) : <div />}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsColumnModalOpen(false)}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 font-bold text-xs rounded-xl transition-colors"
              >
                {t('common:cancel', { defaultValue: 'Abbrechen' })}
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-accent-orange hover:bg-accent-orange/90 text-white font-bold text-xs rounded-xl transition-colors shadow-lg shadow-accent-orange/20"
              >
                {t('common:save', { defaultValue: 'Speichern' })}
              </button>
            </div>
          </div>
        </form>
      </Dialog>

      {/* 3. Card Modal */}
      <Dialog
        isOpen={isCardModalOpen}
        onClose={() => setIsCardModalOpen(false)}
        title={editingCard ? t('kanban:edit_task', { defaultValue: 'Aufgabe bearbeiten' }) : t('kanban:create_task', { defaultValue: 'Neue Aufgabe erstellen' })}
        size="4xl"
      >
        <form onSubmit={handleSaveCard} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              {t('kanban:task_title_label', { defaultValue: 'Titel der Aufgabe *' })}
            </label>
            <input
              type="text"
              required
              value={cardTitle}
              onChange={(e) => setCardTitle(e.target.value)}
              placeholder={t('kanban:task_title_placeholder', { defaultValue: 'z.B. Angebot nachfassen oder Erstgespräch vorbereiten' })}
              className="w-full px-4 py-2.5 bg-primary-dark border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-accent-orange"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                {t('kanban:column', { defaultValue: 'Spalte' })}
              </label>
              <select
                value={cardTargetColumnId}
                onChange={(e) => setCardTargetColumnId(e.target.value)}
                className="w-full px-4 py-2.5 bg-primary-dark border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-accent-orange cursor-pointer"
              >
                {boardDetails?.columns.map(c => (
                  <option key={c.id_uuid} value={c.id_uuid}>{c.title}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                {t('kanban:priority', { defaultValue: 'Priorität' })}
              </label>
              <select
                value={cardPriority}
                onChange={(e) => setCardPriority(e.target.value as 'low' | 'medium' | 'high' | 'urgent')}
                className="w-full px-4 py-2.5 bg-primary-dark border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-accent-orange cursor-pointer"
              >
                <option value="low">{t('kanban:priority_low', { defaultValue: 'Niedrig' })}</option>
                <option value="medium">{t('kanban:priority_medium', { defaultValue: 'Mittel' })}</option>
                <option value="high">{t('kanban:priority_high', { defaultValue: 'Hoch' })}</option>
                <option value="urgent">{t('kanban:priority_urgent', { defaultValue: 'Dringend' })}</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              {t('kanban:description_notes', { defaultValue: 'Beschreibung & Notizen' })}
            </label>
            <textarea
              rows={4}
              value={cardDescription}
              onChange={(e) => setCardDescription(e.target.value)}
              placeholder={t('kanban:task_desc_placeholder', { defaultValue: 'Detaillierte Beschreibung der Aufgabe, Notizen, Vorbereitung...' })}
              className="w-full px-4 py-2.5 bg-primary-dark border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-accent-orange"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                {t('kanban:due_date', { defaultValue: 'Fälligkeitsdatum' })}
              </label>
              <input
                type="date"
                value={cardDueDate}
                onChange={(e) => setCardDueDate(e.target.value)}
                className="w-full px-4 py-2.5 bg-primary-dark border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-accent-orange"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                {t('kanban:assigned_user', { defaultValue: 'Zugewiesener Bearbeiter' })}
              </label>
              <input
                type="text"
                value={cardAssignedUser}
                onChange={(e) => setCardAssignedUser(e.target.value)}
                placeholder={t('kanban:assigned_user_placeholder', { defaultValue: 'Name z.B. Max Mustermann' })}
                className="w-full px-4 py-2.5 bg-primary-dark border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-accent-orange"
              />
            </div>
          </div>

          {/* CRM Searchable Linking */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-white/5 border border-white/5 rounded-2xl">
            {/* Searchable Company Picker */}
            <div className="relative">
              <label className="block text-xs font-bold text-accent-blue uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Building2 size={14} /> {t('kanban:linked_company', { defaultValue: 'Verknüpftes Unternehmen' })}
              </label>

              {(() => {
                const selectedCompany = companies?.find(c => c.id_uuid === cardCompanyId);
                if (selectedCompany) {
                  return (
                    <div className="flex items-center justify-between p-2.5 bg-accent-blue/10 border border-accent-blue/30 rounded-xl text-white text-sm font-semibold">
                      <div className="flex items-center gap-2 truncate">
                        <Building2 size={16} className="text-accent-blue shrink-0" />
                        <span className="truncate">{selectedCompany.full_legal_name}</span>
                        {selectedCompany.city && (
                          <span className="text-xs text-slate-400 font-normal">({selectedCompany.city})</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCardCompanyId('');
                          setCompanySearch('');
                        }}
                        className="p-1 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors ml-2 shrink-0"
                        title={t('kanban:remove_link', { defaultValue: 'Verknüpfung aufheben' })}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                }

                return (
                  <div className="relative">
                    <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={companySearch}
                      onFocus={() => setIsCompanyDropdownOpen(true)}
                      onChange={(e) => {
                        setCompanySearch(e.target.value);
                        setIsCompanyDropdownOpen(true);
                      }}
                      placeholder={t('kanban:search_company_placeholder', { defaultValue: 'Firma suchen (z.B. BMW, Muster GmbH)...' })}
                      className="w-full pl-9 pr-8 py-2.5 bg-primary-dark border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-accent-blue"
                    />
                    {companySearch && (
                      <button
                        type="button"
                        onClick={() => setCompanySearch('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                      >
                        <X size={14} />
                      </button>
                    )}

                    {isCompanyDropdownOpen && (
                      <div className="absolute z-50 left-0 right-0 mt-1 bg-primary-dark border border-white/15 rounded-xl shadow-2xl max-h-52 overflow-y-auto divide-y divide-white/5">
                        {filteredCompaniesForCard.length === 0 ? (
                          <div className="p-3 text-xs text-slate-500 font-bold text-center">
                            {t('kanban:no_company_found', { defaultValue: 'Keine Firma gefunden' })}
                          </div>
                        ) : (
                          filteredCompaniesForCard.map(comp => (
                            <button
                              key={comp.id_uuid}
                              type="button"
                              onClick={() => {
                                setCardCompanyId(comp.id_uuid);
                                setIsCompanyDropdownOpen(false);
                                setCompanySearch('');
                              }}
                              className="w-full text-left p-2.5 hover:bg-white/10 flex items-center justify-between transition-colors text-xs text-white"
                            >
                              <div className="font-semibold truncate">
                                {comp.full_legal_name}
                              </div>
                              {comp.city && (
                                <span className="text-[11px] text-slate-400 ml-2 shrink-0">{comp.city}</span>
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Searchable Contact Picker */}
            <div className="relative">
              <label className="block text-xs font-bold text-accent-orange uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Contact size={14} /> {t('kanban:linked_contact', { defaultValue: 'Verknüpfter Kontakt' })}
              </label>

              {(() => {
                const selectedContact = contacts?.find(c => c.id_uuid === cardContactId);
                if (selectedContact) {
                  return (
                    <div className="flex items-center justify-between p-2.5 bg-accent-orange/10 border border-accent-orange/30 rounded-xl text-white text-sm font-semibold">
                      <div className="flex items-center gap-2 truncate">
                        <Contact size={16} className="text-accent-orange shrink-0" />
                        <span className="truncate">{selectedContact.first_name} {selectedContact.last_name}</span>
                        {selectedContact.company_name && (
                          <span className="text-xs text-slate-400 font-normal">({selectedContact.company_name})</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCardContactId('');
                          setContactSearch('');
                        }}
                        className="p-1 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-colors ml-2 shrink-0"
                        title={t('kanban:remove_link', { defaultValue: 'Verknüpfung aufheben' })}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  );
                }

                return (
                  <div className="relative">
                    <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={contactSearch}
                      onFocus={() => setIsContactDropdownOpen(true)}
                      onChange={(e) => {
                        setContactSearch(e.target.value);
                        setIsContactDropdownOpen(true);
                      }}
                      placeholder={t('kanban:search_contact_placeholder', { defaultValue: 'Kontakt suchen (z.B. Max, Weber)...' })}
                      className="w-full pl-9 pr-8 py-2.5 bg-primary-dark border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-accent-orange"
                    />
                    {contactSearch && (
                      <button
                        type="button"
                        onClick={() => setContactSearch('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                      >
                        <X size={14} />
                      </button>
                    )}

                    {isContactDropdownOpen && (
                      <div className="absolute z-50 left-0 right-0 mt-1 bg-primary-dark border border-white/15 rounded-xl shadow-2xl max-h-52 overflow-y-auto divide-y divide-white/5">
                        {filteredContactsForCard.length === 0 ? (
                          <div className="p-3 text-xs text-slate-500 font-bold text-center">
                            {t('kanban:no_contact_found', { defaultValue: 'Kein Kontakt gefunden' })}
                          </div>
                        ) : (
                          filteredContactsForCard.map(cnt => (
                            <button
                              key={cnt.id_uuid}
                              type="button"
                              onClick={() => {
                                setCardContactId(cnt.id_uuid);
                                setIsContactDropdownOpen(false);
                                setContactSearch('');
                              }}
                              className="w-full text-left p-2.5 hover:bg-white/10 flex items-center justify-between transition-colors text-xs text-white"
                            >
                              <div className="font-semibold truncate">
                                {cnt.first_name} {cnt.last_name}
                              </div>
                              {(cnt.company_name || cnt.email_address) && (
                                <span className="text-[11px] text-slate-400 ml-2 shrink-0 truncate max-w-[140px]">
                                  {cnt.company_name || cnt.email_address}
                                </span>
                              )}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Labels / Tags Input */}
          <div>
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
              {t('kanban:tags_labels', { defaultValue: 'Tags / Labels' })}
            </label>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddLabel();
                  }
                }}
                placeholder={t('kanban:new_label_placeholder', { defaultValue: 'Neues Label z.B. Vertrieb...' })}
                className="flex-1 px-4 py-2 bg-primary-dark border border-white/10 rounded-xl text-white text-sm focus:outline-none focus:border-accent-orange"
              />
              <button
                type="button"
                onClick={handleAddLabel}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white font-bold text-xs rounded-xl transition-colors"
              >
                {t('common:add', { defaultValue: 'Hinzufügen' })}
              </button>
            </div>

            {cardLabels.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {cardLabels.map(lbl => (
                  <span
                    key={lbl}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-accent-orange/10 border border-accent-orange/30 text-accent-orange text-xs font-bold rounded-lg"
                  >
                    #{lbl}
                    <button
                      type="button"
                      onClick={() => handleRemoveLabel(lbl)}
                      className="hover:text-red-400"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-white/10">
            {editingCard && (
              <button
                type="button"
                onClick={() => {
                  if (editingCard.id_uuid) {
                    setConfirmDeleteTarget({
                      type: 'card',
                      id: editingCard.id_uuid,
                      title: editingCard.title
                    });
                    setIsCardModalOpen(false);
                  }
                }}
                className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold text-xs rounded-xl border border-red-500/20 transition-colors"
              >
                {t('common:delete', { defaultValue: 'Löschen' })}
              </button>
            )}
            <div className="flex items-center gap-3 ml-auto">
              <button
                type="button"
                onClick={() => setIsCardModalOpen(false)}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 font-bold text-xs rounded-xl transition-colors"
              >
                {t('common:cancel', { defaultValue: 'Abbrechen' })}
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-accent-orange hover:bg-accent-orange/90 text-white font-bold text-xs rounded-xl transition-colors shadow-lg shadow-accent-orange/20"
              >
                {t('common:save', { defaultValue: 'Speichern' })}
              </button>
            </div>
          </div>
        </form>
      </Dialog>
      {/* 4. Delete Confirmation Dialog */}
      <Dialog
        isOpen={!!confirmDeleteTarget}
        onClose={() => setConfirmDeleteTarget(null)}
        title={
          confirmDeleteTarget?.type === 'board'
            ? t('kanban:delete_board', { defaultValue: 'Board löschen' })
            : confirmDeleteTarget?.type === 'column'
            ? t('kanban:delete_column', { defaultValue: 'Spalte löschen' })
            : t('kanban:delete_task', { defaultValue: 'Aufgabe löschen' })
        }
        size="md"
      >
        <div className="space-y-4">
          <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-300 text-sm flex items-start gap-3">
            <AlertCircle size={20} className="shrink-0 mt-0.5 text-red-400" />
            <div>
              <p className="font-bold mb-1">
                {confirmDeleteTarget?.type === 'board' && t('kanban:confirm_delete_board', { defaultValue: 'Board "{{title}}" wirklich löschen?', title: confirmDeleteTarget.title })}
                {confirmDeleteTarget?.type === 'column' && t('kanban:confirm_delete_column', { defaultValue: 'Spalte "{{title}}" wirklich löschen?', title: confirmDeleteTarget.title })}
                {confirmDeleteTarget?.type === 'card' && t('kanban:confirm_delete_card', { defaultValue: 'Aufgabe "{{title}}" wirklich löschen?', title: confirmDeleteTarget.title })}
              </p>
              <p className="text-xs text-red-400/80">
                {confirmDeleteTarget?.type === 'board' && t('kanban:confirm_delete_board_sub', { defaultValue: 'Alle enthaltenen Spalten und Aufgaben in diesem Board werden ebenfalls unwiderruflich gelöscht.' })}
                {confirmDeleteTarget?.type === 'column' && t('kanban:confirm_delete_column_sub', { defaultValue: 'Alle Aufgaben in dieser Spalte werden ebenfalls unwiderruflich gelöscht.' })}
                {confirmDeleteTarget?.type === 'card' && t('kanban:confirm_delete_card_sub', { defaultValue: 'Diese Aktion kann nicht rückgängig gemacht werden.' })}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/10">
            <button
              type="button"
              onClick={() => setConfirmDeleteTarget(null)}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 font-bold text-xs rounded-xl transition-colors"
            >
              {t('common:cancel', { defaultValue: 'Abbrechen' })}
            </button>
            <button
              type="button"
              disabled={deleteBoardMutation.isPending || deleteColumnMutation.isPending || deleteCardMutation.isPending}
              onClick={() => {
                if (!confirmDeleteTarget) return;
                if (confirmDeleteTarget.type === 'board') {
                  deleteBoardMutation.mutate({ board_id_uuid: confirmDeleteTarget.id });
                } else if (confirmDeleteTarget.type === 'column') {
                  deleteColumnMutation.mutate({ column_id_uuid: confirmDeleteTarget.id });
                } else if (confirmDeleteTarget.type === 'card') {
                  deleteCardMutation.mutate({ card_id_uuid: confirmDeleteTarget.id });
                }
                setConfirmDeleteTarget(null);
              }}
              className="px-5 py-2 bg-red-500 hover:bg-red-600 text-white font-bold text-xs rounded-xl transition-colors shadow-lg shadow-red-500/20 flex items-center gap-2"
            >
              <Trash2 size={14} />
              <span>{t('common:delete', { defaultValue: 'Löschen' })}</span>
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
