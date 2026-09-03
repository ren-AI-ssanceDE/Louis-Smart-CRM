import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { router, protectedProcedure } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { pool, isUsingFallback, fallbackStore, saveFallbackStore, cleanDbRow, cleanLigatureHacksFromValue } from "../db.js";
import { workflowEventBus } from "../ai/workflowEventBus.js";
import { resolveKanbanColumn } from "../ai/tools/crm.js";
import { 
  KanbanBoardSchema, 
  KanbanBoardFullSchema, 
  KanbanColumnSchema, 
  KanbanColumnFullSchema, 
  KanbanCardSchema, 
  KanbanCardFullSchema,
  MoveKanbanCardInputSchema,
  KanbanApprovalFullSchema
} from "../../lib/schemas.js";

const DEFAULT_COLUMNS = [
  { title: "Backlog", color_accent: "#64748b", position: 0 },
  { title: "Zu erledigen", color_accent: "#3b82f6", position: 1 },
  { title: "In Bearbeitung", color_accent: "#f59e0b", position: 2 },
  { title: "Erledigt", color_accent: "#10b981", position: 3 }
];

function deriveKanbanStatus(columnTitle?: string, columnPosition?: number, explicitStatus?: string): "backlog" | "todo" | "in_progress" | "done" | "blocked" | "archived" {
  if (explicitStatus) {
    const s = explicitStatus.toLowerCase().trim();
    if (s === 'backlog') return 'backlog';
    if (s === 'todo' || s === 'offen' || s === 'open') return 'todo';
    if (s === 'in_progress' || s === 'in_bearbeitung' || s === 'working') return 'in_progress';
    if (s === 'done' || s === 'erledigt' || s === 'finished') return 'done';
    if (s === 'blocked') return 'blocked';
    if (s === 'archived') return 'archived';
  }
  if (columnTitle) {
    const t = columnTitle.toLowerCase();
    if (t.includes('erledigt') || t.includes('done') || t.includes('abgeschlossen')) return 'done';
    if (t.includes('bearbeitung') || t.includes('progress') || t.includes('in arbeit')) return 'in_progress';
    if (t.includes('backlog')) return 'backlog';
    if (t.includes('blockiert') || t.includes('blocked')) return 'blocked';
    if (t.includes('archiv') || t.includes('archived')) return 'archived';
  }
  if (columnPosition !== undefined && columnPosition !== null) {
    if (columnPosition === 0) return 'backlog';
    if (columnPosition === 1) return 'todo';
    if (columnPosition === 2) return 'in_progress';
    if (columnPosition >= 3) return 'done';
  }
  return 'todo';
}

export const kanbanRouter = router({
  getBoards: protectedProcedure
    .output(z.array(KanbanBoardFullSchema))
    .query(async ({ ctx }) => {
      if (isUsingFallback) {
        if (!fallbackStore.kanbanBoards || fallbackStore.kanbanBoards.length === 0) {
          // Initialize default board
          const defaultBoardId = uuidv4();
          const now = new Date().toISOString();
          const defaultBoard = {
            id_uuid: defaultBoardId,
            tenant_id: ctx.tenantId,
            title: "Haupt-Kanban",
            description: "Standard Projektboard",
            color: "#3b82f6",
            is_default: true,
            created_at_utc: now,
            updated_at_utc: now
          };
          fallbackStore.kanbanBoards = [defaultBoard];
          fallbackStore.kanbanColumns = DEFAULT_COLUMNS.map((col, idx) => ({
            id_uuid: uuidv4(),
            tenant_id: ctx.tenantId,
            board_id: defaultBoardId,
            title: col.title,
            position: idx,
            color_accent: col.color_accent,
            created_at_utc: now,
            updated_at_utc: now
          }));
          fallbackStore.kanbanCards = [];
          saveFallbackStore();
        }
        return fallbackStore.kanbanBoards;
      }

      // PostgreSQL
      const res = await pool.query(
        "SELECT * FROM kanban_boards WHERE tenant_id = $1 OR tenant_id = '1' ORDER BY is_default DESC, created_at_utc ASC",
        [ctx.tenantId]
      );

      if (res.rows.length === 0) {
        // Auto-seed initial board for tenant
        const defaultBoardId = uuidv4();
        const boardRes = await pool.query(
          `INSERT INTO kanban_boards (id_uuid, tenant_id, title, description, color, is_default)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [defaultBoardId, ctx.tenantId, "Haupt-Kanban", "Standard Projektboard", "#3b82f6", true]
        );

        for (const col of DEFAULT_COLUMNS) {
          await pool.query(
            `INSERT INTO kanban_columns (id_uuid, tenant_id, board_id, title, position, color_accent)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [uuidv4(), ctx.tenantId, defaultBoardId, col.title, col.position, col.color_accent]
          );
        }

        return [cleanDbRow(boardRes.rows[0])];
      }

      return res.rows.map(cleanDbRow);
    }),

  getBoardDetails: protectedProcedure
    .input(z.object({ board_id_uuid: z.string() }))
    .output(z.object({
      board: KanbanBoardFullSchema,
      columns: z.array(KanbanColumnFullSchema.extend({
        cards: z.array(KanbanCardFullSchema)
      }))
    }))
    .query(async ({ input, ctx }) => {
      if (isUsingFallback) {
        const board = (fallbackStore.kanbanBoards || []).find(b => b.id_uuid === input.board_id_uuid);
        if (!board) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Kanban Board not found' });
        }
        const columns = (fallbackStore.kanbanColumns || [])
          .filter(c => c.board_id === input.board_id_uuid)
          .sort((a, b) => a.position - b.position);

        const columnsWithCards = columns.map(col => {
          const cards = (fallbackStore.kanbanCards || [])
            .filter(card => card.column_id === col.id_uuid)
            .sort((a, b) => a.position - b.position);
          return { ...col, cards };
        });

        return { board, columns: columnsWithCards };
      }

      // PostgreSQL
      const boardRes = await pool.query(
        "SELECT * FROM kanban_boards WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')",
        [input.board_id_uuid, ctx.tenantId]
      );
      if (boardRes.rows.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Kanban Board not found' });
      }

      const board = cleanDbRow(boardRes.rows[0]);

      const colsRes = await pool.query(
        "SELECT * FROM kanban_columns WHERE board_id = $1 AND (tenant_id = $2 OR tenant_id = '1') ORDER BY position ASC",
        [input.board_id_uuid, ctx.tenantId]
      );
      const columns = colsRes.rows.map(cleanDbRow);

      const cardsRes = await pool.query(
        "SELECT * FROM kanban_cards WHERE board_id = $1 AND (tenant_id = $2 OR tenant_id = '1') ORDER BY position ASC",
        [input.board_id_uuid, ctx.tenantId]
      );
      const allCards = cardsRes.rows.map(row => {
        const r = cleanDbRow(row);
        return {
          ...r,
          labels: Array.isArray(r.labels) ? r.labels : []
        };
      });

      const columnsWithCards = columns.map(col => {
        const cards = allCards.filter(card => card.column_id === col.id_uuid);
        return { ...col, cards };
      });

      return { board, columns: columnsWithCards };
    }),

  createBoard: protectedProcedure
    .input(KanbanBoardSchema)
    .output(z.object({ id_uuid: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const sanitized = cleanLigatureHacksFromValue(input);
      const id = uuidv4();
      const now = new Date().toISOString();

      if (isUsingFallback) {
        if (!fallbackStore.kanbanBoards) fallbackStore.kanbanBoards = [];
        if (!fallbackStore.kanbanColumns) fallbackStore.kanbanColumns = [];

        if (sanitized.is_default) {
          fallbackStore.kanbanBoards.forEach(b => { b.is_default = false; });
        }

        const newBoard = {
          ...sanitized,
          id_uuid: id,
          tenant_id: ctx.tenantId,
          created_at_utc: now,
          updated_at_utc: now
        };
        fallbackStore.kanbanBoards.push(newBoard);

        // Add default columns for new board
        DEFAULT_COLUMNS.forEach((col, idx) => {
          fallbackStore.kanbanColumns!.push({
            id_uuid: uuidv4(),
            tenant_id: ctx.tenantId,
            board_id: id,
            title: col.title,
            position: idx,
            color_accent: col.color_accent,
            created_at_utc: now,
            updated_at_utc: now
          });
        });

        saveFallbackStore();
        return { id_uuid: id };
      }

      if (sanitized.is_default) {
        await pool.query(
          "UPDATE kanban_boards SET is_default = false WHERE (tenant_id = $1 OR tenant_id = '1')",
          [ctx.tenantId]
        );
      }

      await pool.query(
        `INSERT INTO kanban_boards (id_uuid, tenant_id, title, description, color, is_default)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, ctx.tenantId, sanitized.title, sanitized.description || null, sanitized.color || '#3b82f6', sanitized.is_default || false]
      );

      for (const col of DEFAULT_COLUMNS) {
        await pool.query(
          `INSERT INTO kanban_columns (id_uuid, tenant_id, board_id, title, position, color_accent)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [uuidv4(), ctx.tenantId, id, col.title, col.position, col.color_accent]
        );
      }

      workflowEventBus.emitEvent(ctx.tenantId, 'kanban.board_created', { id_uuid: id, title: sanitized.title });
      return { id_uuid: id };
    }),

  updateBoard: protectedProcedure
    .input(KanbanBoardSchema.extend({ id_uuid: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const sanitized = cleanLigatureHacksFromValue(input);
      const now = new Date().toISOString();

      if (isUsingFallback) {
        if (sanitized.is_default && fallbackStore.kanbanBoards) {
          fallbackStore.kanbanBoards.forEach(b => { b.is_default = false; });
        }
        const index = (fallbackStore.kanbanBoards || []).findIndex(b => b.id_uuid === sanitized.id_uuid);
        if (index === -1) throw new TRPCError({ code: 'NOT_FOUND', message: 'Board not found' });

        fallbackStore.kanbanBoards![index] = {
          ...fallbackStore.kanbanBoards![index],
          ...sanitized,
          updated_at_utc: now
        };
        saveFallbackStore();
        return { success: true };
      }

      if (sanitized.is_default) {
        await pool.query("UPDATE kanban_boards SET is_default = false WHERE tenant_id = $1 OR tenant_id = '1'", [ctx.tenantId]);
      }

      await pool.query(
        `UPDATE kanban_boards 
         SET title = $1, description = $2, color = $3, is_default = $4, updated_at_utc = CURRENT_TIMESTAMP
         WHERE id_uuid = $5 AND (tenant_id = $6 OR tenant_id = '1')`,
        [sanitized.title, sanitized.description || null, sanitized.color, sanitized.is_default, sanitized.id_uuid, ctx.tenantId]
      );

      return { success: true };
    }),

  deleteBoard: protectedProcedure
    .input(z.object({ board_id_uuid: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      if (isUsingFallback) {
        fallbackStore.kanbanBoards = (fallbackStore.kanbanBoards || []).filter(b => b.id_uuid !== input.board_id_uuid);
        fallbackStore.kanbanColumns = (fallbackStore.kanbanColumns || []).filter(c => c.board_id !== input.board_id_uuid);
        fallbackStore.kanbanCards = (fallbackStore.kanbanCards || []).filter(c => c.board_id !== input.board_id_uuid);
        saveFallbackStore();
        return { success: true };
      }

      await pool.query("DELETE FROM kanban_cards WHERE board_id = $1 AND (tenant_id = $2 OR tenant_id = '1')", [input.board_id_uuid, ctx.tenantId]);
      await pool.query("DELETE FROM kanban_columns WHERE board_id = $1 AND (tenant_id = $2 OR tenant_id = '1')", [input.board_id_uuid, ctx.tenantId]);
      await pool.query(
        "DELETE FROM kanban_boards WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')",
        [input.board_id_uuid, ctx.tenantId]
      );

      return { success: true };
    }),

  createColumn: protectedProcedure
    .input(KanbanColumnSchema)
    .output(z.object({ id_uuid: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const sanitized = cleanLigatureHacksFromValue(input);
      const id = uuidv4();
      const now = new Date().toISOString();

      if (isUsingFallback) {
        if (!fallbackStore.kanbanColumns) fallbackStore.kanbanColumns = [];
        const newCol = {
          ...sanitized,
          id_uuid: id,
          tenant_id: ctx.tenantId,
          created_at_utc: now,
          updated_at_utc: now
        };
        fallbackStore.kanbanColumns.push(newCol);
        saveFallbackStore();
        return { id_uuid: id };
      }

      await pool.query(
        `INSERT INTO kanban_columns (id_uuid, tenant_id, board_id, title, position, color_accent)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, ctx.tenantId, sanitized.board_id, sanitized.title, sanitized.position, sanitized.color_accent]
      );

      return { id_uuid: id };
    }),

  updateColumn: protectedProcedure
    .input(KanbanColumnSchema.extend({ id_uuid: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const sanitized = cleanLigatureHacksFromValue(input);
      const now = new Date().toISOString();

      if (isUsingFallback) {
        const idx = (fallbackStore.kanbanColumns || []).findIndex(c => c.id_uuid === sanitized.id_uuid);
        if (idx === -1) throw new TRPCError({ code: 'NOT_FOUND', message: 'Column not found' });
        fallbackStore.kanbanColumns![idx] = {
          ...fallbackStore.kanbanColumns![idx],
          ...sanitized,
          updated_at_utc: now
        };
        saveFallbackStore();
        return { success: true };
      }

      await pool.query(
        `UPDATE kanban_columns 
         SET title = $1, position = $2, color_accent = $3, updated_at_utc = CURRENT_TIMESTAMP
         WHERE id_uuid = $4 AND (tenant_id = $5 OR tenant_id = '1')`,
        [sanitized.title, sanitized.position, sanitized.color_accent, sanitized.id_uuid, ctx.tenantId]
      );

      return { success: true };
    }),

  deleteColumn: protectedProcedure
    .input(z.object({ column_id_uuid: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      if (isUsingFallback) {
        fallbackStore.kanbanColumns = (fallbackStore.kanbanColumns || []).filter(c => c.id_uuid !== input.column_id_uuid);
        fallbackStore.kanbanCards = (fallbackStore.kanbanCards || []).filter(c => c.column_id !== input.column_id_uuid);
        saveFallbackStore();
        return { success: true };
      }

      await pool.query("DELETE FROM kanban_cards WHERE column_id = $1 AND (tenant_id = $2 OR tenant_id = '1')", [input.column_id_uuid, ctx.tenantId]);
      await pool.query(
        "DELETE FROM kanban_columns WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')",
        [input.column_id_uuid, ctx.tenantId]
      );

      return { success: true };
    }),

  reorderColumns: protectedProcedure
    .input(z.object({
      board_id_uuid: z.string(),
      column_ids_in_order: z.array(z.string())
    }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      if (isUsingFallback) {
        input.column_ids_in_order.forEach((colId, index) => {
          const col = (fallbackStore.kanbanColumns || []).find(c => c.id_uuid === colId);
          if (col) {
            col.position = index;
          }
        });
        saveFallbackStore();
        return { success: true };
      }

      for (let i = 0; i < input.column_ids_in_order.length; i++) {
        await pool.query(
          "UPDATE kanban_columns SET position = $1 WHERE id_uuid = $2 AND (tenant_id = $3 OR tenant_id = '1')",
          [i, input.column_ids_in_order[i], ctx.tenantId]
        );
      }

      return { success: true };
    }),

  createCard: protectedProcedure
    .input(KanbanCardSchema)
    .output(z.object({ id_uuid: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const sanitized = cleanLigatureHacksFromValue(input);
      const companyId = sanitized.company_id_uuid?.trim() || null;
      const contactId = sanitized.contact_id_uuid?.trim() || null;

      // BUG-010: column_id muss zum board_id gehoeren — klare Meldung statt Mismatch-Karte/FK-Rohfehler
      try {
        await resolveKanbanColumn(ctx.tenantId, sanitized.board_id, sanitized.column_id);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Ungültige Ziel-Spalte."
        });
      }

      const id = uuidv4();
      const now = new Date().toISOString();

      let colTitle: string | undefined;
      let colPos: number | undefined;

      if (isUsingFallback) {
        const col = (fallbackStore.kanbanColumns || []).find(c => c.id_uuid === sanitized.column_id);
        colTitle = col?.title;
        colPos = col?.position;
      } else {
        const colRes = await pool.query(
          "SELECT title, position FROM kanban_columns WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')",
          [sanitized.column_id, ctx.tenantId]
        );
        colTitle = colRes.rows[0]?.title;
        colPos = colRes.rows[0]?.position;
      }

      const cardStatus = deriveKanbanStatus(colTitle, colPos, sanitized.status);

      if (isUsingFallback) {
        if (!fallbackStore.kanbanCards) fallbackStore.kanbanCards = [];
        const newCard = {
          ...sanitized,
          status: cardStatus,
          company_id_uuid: companyId,
          contact_id_uuid: contactId,
          id_uuid: id,
          tenant_id: ctx.tenantId,
          created_at_utc: now,
          updated_at_utc: now
        };
        fallbackStore.kanbanCards.push(newCard);
        saveFallbackStore();

        workflowEventBus.emitEvent(ctx.tenantId, 'kanban.card_created', {
          id_uuid: id,
          card_id: id,
          board_id: sanitized.board_id,
          column_id: sanitized.column_id,
          title: sanitized.title,
          status: cardStatus,
          priority: sanitized.priority || 'medium',
          company_id_uuid: companyId,
          contact_id_uuid: contactId
        });

        return { id_uuid: id };
      }

      await pool.query(
        `INSERT INTO kanban_cards (
          id_uuid, tenant_id, board_id, column_id, title, description, status,
          priority, position, due_date, assigned_user, company_id_uuid, contact_id_uuid, labels
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          id,
          ctx.tenantId,
          sanitized.board_id,
          sanitized.column_id,
          sanitized.title,
          sanitized.description || null,
          cardStatus,
          sanitized.priority || 'medium',
          sanitized.position || 0,
          sanitized.due_date || null,
          sanitized.assigned_user || null,
          companyId,
          contactId,
          sanitized.labels || []
        ]
      );

      workflowEventBus.emitEvent(ctx.tenantId, 'kanban.card_created', {
        id_uuid: id,
        card_id: id,
        board_id: sanitized.board_id,
        column_id: sanitized.column_id,
        title: sanitized.title,
        status: cardStatus,
        priority: sanitized.priority || 'medium',
        company_id_uuid: companyId,
        contact_id_uuid: contactId
      });

      return { id_uuid: id };
    }),

  updateCard: protectedProcedure
    .input(KanbanCardSchema.extend({ id_uuid: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const sanitized = cleanLigatureHacksFromValue(input);
      const companyId = sanitized.company_id_uuid?.trim() || null;
      const contactId = sanitized.contact_id_uuid?.trim() || null;
      const now = new Date().toISOString();

      let colTitle: string | undefined;
      let colPos: number | undefined;

      if (isUsingFallback) {
        const col = (fallbackStore.kanbanColumns || []).find(c => c.id_uuid === sanitized.column_id);
        colTitle = col?.title;
        colPos = col?.position;
      } else {
        const colRes = await pool.query(
          "SELECT title, position FROM kanban_columns WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')",
          [sanitized.column_id, ctx.tenantId]
        );
        colTitle = colRes.rows[0]?.title;
        colPos = colRes.rows[0]?.position;
      }

      const cardStatus = deriveKanbanStatus(colTitle, colPos, sanitized.status);

      if (isUsingFallback) {
        const idx = (fallbackStore.kanbanCards || []).findIndex(c => c.id_uuid === sanitized.id_uuid);
        if (idx === -1) throw new TRPCError({ code: 'NOT_FOUND', message: 'Card not found' });
        const existing = fallbackStore.kanbanCards![idx];
        fallbackStore.kanbanCards![idx] = {
          ...existing,
          ...sanitized,
          // board_id/column_id aendert nur der Move (moveCard) — wie im PG-Zweig (UPDATE setzt sie nicht)
          board_id: existing.board_id,
          column_id: existing.column_id,
          status: cardStatus,
          company_id_uuid: companyId,
          contact_id_uuid: contactId,
          updated_at_utc: now
        };
        saveFallbackStore();

        workflowEventBus.emitEvent(ctx.tenantId, 'kanban.card_updated', {
          id_uuid: sanitized.id_uuid,
          card_id: sanitized.id_uuid,
          board_id: sanitized.board_id,
          column_id: sanitized.column_id,
          title: sanitized.title,
          status: cardStatus,
          priority: sanitized.priority
        });

        return { success: true };
      }

      await pool.query(
        `UPDATE kanban_cards 
         SET title = $1, description = $2, status = $3, priority = $4, position = $5,
             due_date = $6, assigned_user = $7, company_id_uuid = $8, contact_id_uuid = $9,
             labels = $10, updated_at_utc = CURRENT_TIMESTAMP
         WHERE id_uuid = $11 AND (tenant_id = $12 OR tenant_id = '1')`,
        [
          sanitized.title,
          sanitized.description || null,
          cardStatus,
          sanitized.priority,
          sanitized.position,
          sanitized.due_date || null,
          sanitized.assigned_user || null,
          companyId,
          contactId,
          sanitized.labels || [],
          sanitized.id_uuid,
          ctx.tenantId
        ]
      );

      workflowEventBus.emitEvent(ctx.tenantId, 'kanban.card_updated', {
        id_uuid: sanitized.id_uuid,
        card_id: sanitized.id_uuid,
        board_id: sanitized.board_id,
        column_id: sanitized.column_id,
        title: sanitized.title,
        status: cardStatus,
        priority: sanitized.priority
      });

      return { success: true };
    }),

  deleteCard: protectedProcedure
    .input(z.object({ card_id_uuid: z.string() }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      if (isUsingFallback) {
        fallbackStore.kanbanCards = (fallbackStore.kanbanCards || []).filter(c => c.id_uuid !== input.card_id_uuid);
        saveFallbackStore();

        workflowEventBus.emitEvent(ctx.tenantId, 'kanban.card_deleted', {
          id_uuid: input.card_id_uuid,
          card_id: input.card_id_uuid
        });

        return { success: true };
      }

      await pool.query(
        "DELETE FROM kanban_cards WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')",
        [input.card_id_uuid, ctx.tenantId]
      );

      workflowEventBus.emitEvent(ctx.tenantId, 'kanban.card_deleted', {
        id_uuid: input.card_id_uuid,
        card_id: input.card_id_uuid
      });

      return { success: true };
    }),

  moveCard: protectedProcedure
    .input(MoveKanbanCardInputSchema)
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const now = new Date().toISOString();

      if (isUsingFallback) {
        const card = (fallbackStore.kanbanCards || []).find(c => c.id_uuid === input.card_id_uuid);
        if (!card) throw new TRPCError({ code: 'NOT_FOUND', message: 'Card not found' });

        // BUG-010: Ziel-Spalte muss zum Board der Karte gehoeren
        try {
          await resolveKanbanColumn(ctx.tenantId, card.board_id, input.target_column_id_uuid);
        } catch (e) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: e instanceof Error ? e.message : 'Ungültige Ziel-Spalte.'
          });
        }

        const fromColId = card.column_id;
        const fromCol = (fallbackStore.kanbanColumns || []).find(c => c.id_uuid === fromColId);
        const toCol = (fallbackStore.kanbanColumns || []).find(c => c.id_uuid === input.target_column_id_uuid);

        const newStatus = deriveKanbanStatus(toCol?.title, toCol?.position, (input as { status?: string }).status);

        card.column_id = input.target_column_id_uuid;
        card.position = input.new_position;
        card.status = newStatus;
        card.updated_at_utc = now;

        saveFallbackStore();

        workflowEventBus.emitEvent(ctx.tenantId, 'kanban.card_moved', {
          id_uuid: card.id_uuid,
          card_id: card.id_uuid,
          board_id: card.board_id,
          from_column_id: fromColId,
          to_column_id: input.target_column_id_uuid,
          from_column_title: fromCol?.title || '',
          to_column_title: toCol?.title || '',
          new_position: input.new_position,
          card_title: card.title,
          status: newStatus
        });

        return { success: true };
      }

      const cardRes = await pool.query(
        "SELECT * FROM kanban_cards WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')",
        [input.card_id_uuid, ctx.tenantId]
      );
      if (cardRes.rows.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Card not found' });
      const card = cleanDbRow(cardRes.rows[0]);
      const fromColId = card.column_id;

      // BUG-010: Ziel-Spalte muss zum Board der Karte gehoeren
      try {
        await resolveKanbanColumn(ctx.tenantId, card.board_id, input.target_column_id_uuid);
      } catch (e) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: e instanceof Error ? e.message : 'Ungültige Ziel-Spalte.'
        });
      }

      const colsRes = await pool.query(
        "SELECT id_uuid, title, position FROM kanban_columns WHERE id_uuid = ANY($1) AND (tenant_id = $2 OR tenant_id = '1')",
        [[fromColId, input.target_column_id_uuid], ctx.tenantId]
      );
      const fromColRow = colsRes.rows.find(r => r.id_uuid === fromColId);
      const toColRow = colsRes.rows.find(r => r.id_uuid === input.target_column_id_uuid);
      const fromColTitle = fromColRow?.title || '';
      const toColTitle = toColRow?.title || '';

      const newStatus = deriveKanbanStatus(toColTitle, toColRow?.position, (input as { status?: string }).status);

      await pool.query(
        `UPDATE kanban_cards 
         SET column_id = $1, position = $2, status = $3, updated_at_utc = CURRENT_TIMESTAMP
         WHERE id_uuid = $4 AND (tenant_id = $5 OR tenant_id = '1')`,
        [input.target_column_id_uuid, input.new_position, newStatus, input.card_id_uuid, ctx.tenantId]
      );

      workflowEventBus.emitEvent(ctx.tenantId, 'kanban.card_moved', {
        id_uuid: card.id_uuid,
        card_id: card.id_uuid,
        board_id: card.board_id,
        from_column_id: fromColId,
        to_column_id: input.target_column_id_uuid,
        from_column_title: fromColTitle,
        to_column_title: toColTitle,
        new_position: input.new_position,
        card_title: card.title,
        status: newStatus
      });

      return { success: true };
    }),

  // =========================================================================
  // OBSOLET: sys_louis_kanban_approvals-Subsystem (getPendingApprovals /
  // approveApproval / rejectApproval / updateApproval) — seit der Chat-Freigabe
  // (proposedChanges → approveProposal) existiert KEIN INSERT-Pfad mehr in die
  // Tabelle (repo-weit 0 INSERTs, live 0 Zeilen); der PG-Zweig liest zudem
  // Spalten, die die Tabelle nicht hat. Die Kanban-Sektion des Dashboard-
  // Freigabe-Panels wurde entfernt (Kanban-Freigabe = Chat). Nicht ohne
  // Entscheidung reaktivieren; kein DROP (additive Migrations-Regel).
  // =========================================================================
  getPendingApprovals: protectedProcedure
    .output(z.array(KanbanApprovalFullSchema))
    .query(async ({ ctx }) => {
      if (isUsingFallback) {
        return (fallbackStore.kanbanApprovals || []).filter(
          a => a.tenant_id === ctx.tenantId && a.status === 'PENDING'
        );
      }

      const res = await pool.query(
        "SELECT * FROM sys_louis_kanban_approvals WHERE (tenant_id = $1 OR tenant_id = '1') AND status = 'PENDING' ORDER BY created_at_utc DESC",
        [ctx.tenantId]
      );

      return res.rows.map(row => {
        const cleaned = cleanDbRow(row);
        return {
          ...cleaned,
          proposed_state: typeof cleaned.proposed_state === 'string' 
            ? JSON.parse(cleaned.proposed_state) 
            : cleaned.proposed_state
        };
      });
    }),

  approveApproval: protectedProcedure
    .input(z.object({ approval_id_uuid: z.string().uuid() }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const now = new Date().toISOString();
      const approver = ctx.session?.user?.email || "Admin";

      if (isUsingFallback) {
        const approval = (fallbackStore.kanbanApprovals || []).find(
          a => a.id_uuid === input.approval_id_uuid && a.tenant_id === tenantId
        );
        if (!approval || approval.status !== 'PENDING') {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Ausstehende Freigabe nicht gefunden' });
        }

        const { entity_type, action_type, proposed_payload, workflow_instance_id } = approval;
        const action = action_type;
        const pState = (proposed_payload || {}) as Record<string, unknown>;
        const appliedId = (pState.id_uuid as string) || uuidv4();

        const eType = entity_type as string;

        // Apply mutation
        if (eType === 'card' || eType === 'kanban_card') {
          if (!fallbackStore.kanbanCards) fallbackStore.kanbanCards = [];
          if (action === 'DELETE') {
            fallbackStore.kanbanCards = fallbackStore.kanbanCards.filter(c => c.id_uuid !== appliedId);
          } else if (action === 'UPDATE' || action === 'MOVE') {
            const idx = fallbackStore.kanbanCards.findIndex(c => c.id_uuid === appliedId);
            if (idx >= 0) {
              fallbackStore.kanbanCards[idx] = { ...fallbackStore.kanbanCards[idx], ...pState, updated_at_utc: now };
            }
          } else {
            fallbackStore.kanbanCards.push({
              id_uuid: appliedId,
              tenant_id: tenantId,
              board_id: (pState.board_id as string) || '',
              column_id: (pState.column_id as string) || '',
              title: (pState.title as string) || 'Neue Karte',
              description: (pState.description as string) || null,
              status: (pState.status as "backlog" | "todo" | "in_progress" | "done" | "blocked" | "archived") || 'todo',
              priority: (pState.priority as 'low'|'medium'|'high'|'urgent') || 'medium',
              position: (pState.position as number) || 0,
              due_date: (pState.due_date as string) || null,
              assigned_user: (pState.assigned_user as string) || null,
              company_id_uuid: (pState.company_id_uuid as string) || null,
              contact_id_uuid: (pState.contact_id_uuid as string) || null,
              labels: (pState.labels as string[]) || [],
              created_at_utc: now,
              updated_at_utc: now
            });
          }
        } else if (eType === 'column' || eType === 'kanban_column') {
          if (!fallbackStore.kanbanColumns) fallbackStore.kanbanColumns = [];
          if (action === 'DELETE') {
            fallbackStore.kanbanColumns = fallbackStore.kanbanColumns.filter(c => c.id_uuid !== appliedId);
          } else if (action === 'UPDATE') {
            const idx = fallbackStore.kanbanColumns.findIndex(c => c.id_uuid === appliedId);
            if (idx >= 0) {
              fallbackStore.kanbanColumns[idx] = { ...fallbackStore.kanbanColumns[idx], ...pState, updated_at_utc: now };
            }
          } else {
            fallbackStore.kanbanColumns.push({
              id_uuid: appliedId,
              tenant_id: tenantId,
              board_id: (pState.board_id as string) || '',
              title: (pState.title as string) || 'Neue Spalte',
              position: (pState.position as number) || 0,
              color_accent: (pState.color_accent as string) || '#3b82f6',
              created_at_utc: now,
              updated_at_utc: now
            });
          }
        } else if (eType === 'board' || eType === 'kanban_board') {
          if (!fallbackStore.kanbanBoards) fallbackStore.kanbanBoards = [];
          if (action === 'DELETE') {
            fallbackStore.kanbanBoards = fallbackStore.kanbanBoards.filter(b => b.id_uuid !== appliedId);
          } else if (action === 'UPDATE') {
            const idx = fallbackStore.kanbanBoards.findIndex(b => b.id_uuid === appliedId);
            if (idx >= 0) {
              fallbackStore.kanbanBoards[idx] = { ...fallbackStore.kanbanBoards[idx], ...pState, updated_at_utc: now };
            }
          } else {
            fallbackStore.kanbanBoards.push({
              id_uuid: appliedId,
              tenant_id: tenantId,
              title: (pState.title as string) || 'Neues Board',
              description: (pState.description as string) || null,
              color: (pState.color as string) || '#3b82f6',
              is_default: (pState.is_default as boolean) || false,
              created_at_utc: now,
              updated_at_utc: now
            });
          }
        }

        approval.status = 'APPROVED';
        approval.updated_at_utc = now;

        if (workflow_instance_id && fallbackStore.workflowInstances) {
          const wf = fallbackStore.workflowInstances.find(w => w.id_uuid === workflow_instance_id);
          if (wf) {
            wf.status = 'COMPLETED';
            wf.updated_at_utc = now;
          }
        }

        saveFallbackStore();
        workflowEventBus.emitEvent(tenantId, 'kanban.approval_approved', { approval_id_uuid: input.approval_id_uuid });
        return { success: true };
      }

      // PostgreSQL
      const res = await pool.query(
        "SELECT * FROM sys_louis_kanban_approvals WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1') AND status = 'PENDING'",
        [input.approval_id_uuid, tenantId]
      );
      if (res.rows.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Ausstehende Freigabe nicht gefunden' });
      }

      const approval = cleanDbRow(res.rows[0]);
      const { entity_type, action, workflow_instance_id } = approval;
      const pState = typeof approval.proposed_state === 'string' ? JSON.parse(approval.proposed_state) : (approval.proposed_state || {});
      const appliedId = pState.id_uuid || uuidv4();

      if (entity_type === 'card' || entity_type === 'kanban_card') {
        if (action === 'DELETE') {
          await pool.query("DELETE FROM kanban_cards WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')", [appliedId, tenantId]);
        } else if (action === 'UPDATE') {
          await pool.query(
            "UPDATE kanban_cards SET title = $1, description = $2, priority = $3, due_date = $4, labels = $5, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $6 AND (tenant_id = $7 OR tenant_id = '1')",
            [pState.title, pState.description || null, pState.priority || 'medium', pState.due_date || null, JSON.stringify(pState.labels || []), appliedId, tenantId]
          );
        } else if (action === 'MOVE') {
          await pool.query(
            "UPDATE kanban_cards SET column_id = $1, position = $2, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $3 AND (tenant_id = $4 OR tenant_id = '1')",
            [pState.column_id || pState.target_column_id_uuid, pState.position ?? pState.new_position ?? 0, appliedId, tenantId]
          );
        } else {
          await pool.query(
            `INSERT INTO kanban_cards (id_uuid, tenant_id, board_id, column_id, title, description, priority, position, due_date, company_id_uuid, contact_id_uuid, labels)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [appliedId, tenantId, pState.board_id, pState.column_id, pState.title || "Neue Karte", pState.description || null, pState.priority || 'medium', pState.position || 0, pState.due_date || null, pState.company_id_uuid || null, pState.contact_id_uuid || null, JSON.stringify(pState.labels || [])]
          );
        }
      } else if (entity_type === 'column' || entity_type === 'kanban_column') {
        if (action === 'DELETE') {
          await pool.query("DELETE FROM kanban_columns WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')", [appliedId, tenantId]);
        } else if (action === 'UPDATE') {
          await pool.query(
            "UPDATE kanban_columns SET title = $1, position = $2, color_accent = $3, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $4 AND (tenant_id = $5 OR tenant_id = '1')",
            [pState.title, pState.position, pState.color_accent || "#3b82f6", appliedId, tenantId]
          );
        } else {
          await pool.query(
            "INSERT INTO kanban_columns (id_uuid, tenant_id, board_id, title, position, color_accent) VALUES ($1, $2, $3, $4, $5, $6)",
            [appliedId, tenantId, pState.board_id, pState.title || "Neue Spalte", pState.position || 0, pState.color_accent || "#3b82f6"]
          );
        }
      } else if (entity_type === 'board' || entity_type === 'kanban_board') {
        if (action === 'DELETE') {
          await pool.query("DELETE FROM kanban_boards WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')", [appliedId, tenantId]);
        } else if (action === 'UPDATE') {
          await pool.query(
            "UPDATE kanban_boards SET title = $1, description = $2, color = $3, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $4 AND (tenant_id = $5 OR tenant_id = '1')",
            [pState.title, pState.description || null, pState.color || "#3b82f6", appliedId, tenantId]
          );
        } else {
          await pool.query(
            "INSERT INTO kanban_boards (id_uuid, tenant_id, title, description, color, is_default) VALUES ($1, $2, $3, $4, $5, $6)",
            [appliedId, tenantId, pState.title || "Neues Board", pState.description || null, pState.color || "#3b82f6", pState.is_default || false]
          );
        }
      }

      await pool.query(
        "UPDATE sys_louis_kanban_approvals SET status = 'APPROVED', approved_by_user = $1, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $2 AND (tenant_id = $3 OR tenant_id = '1')",
        [approver, input.approval_id_uuid, tenantId]
      );

      if (workflow_instance_id) {
        await pool.query(
          "UPDATE sys_louis_ai_workflow_instances SET status = 'COMPLETED', updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')",
          [workflow_instance_id, tenantId]
        );
      }

      workflowEventBus.emitEvent(tenantId, 'kanban.approval_approved', { approval_id_uuid: input.approval_id_uuid });
      return { success: true };
    }),

  rejectApproval: protectedProcedure
    .input(z.object({
      approval_id_uuid: z.string().uuid(),
      rejection_reason: z.string().optional()
    }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const now = new Date().toISOString();

      if (isUsingFallback) {
        const approval = (fallbackStore.kanbanApprovals || []).find(
          a => a.id_uuid === input.approval_id_uuid && a.tenant_id === tenantId
        );
        if (!approval) throw new TRPCError({ code: 'NOT_FOUND', message: 'Freigabe nicht gefunden' });

        approval.status = 'REJECTED';
        approval.updated_at_utc = now;

        if (approval.workflow_instance_id && fallbackStore.workflowInstances) {
          const wf = fallbackStore.workflowInstances.find(w => w.id_uuid === approval.workflow_instance_id);
          if (wf) {
            wf.status = 'FAILED';
            wf.updated_at_utc = now;
          }
        }

        saveFallbackStore();
        workflowEventBus.emitEvent(tenantId, 'kanban.approval_rejected', { approval_id_uuid: input.approval_id_uuid, reason: input.rejection_reason });
        return { success: true };
      }

      const res = await pool.query(
        "SELECT workflow_instance_id FROM sys_louis_kanban_approvals WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')",
        [input.approval_id_uuid, tenantId]
      );
      if (res.rows.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Freigabe nicht gefunden' });

      const wfId = res.rows[0].workflow_instance_id;

      await pool.query(
        "UPDATE sys_louis_kanban_approvals SET status = 'REJECTED', updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')",
        [input.approval_id_uuid, tenantId]
      );

      if (wfId) {
        await pool.query(
          "UPDATE sys_louis_ai_workflow_instances SET status = 'FAILED', updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $1 AND (tenant_id = $2 OR tenant_id = '1')",
          [wfId, tenantId]
        );
      }

      workflowEventBus.emitEvent(tenantId, 'kanban.approval_rejected', { approval_id_uuid: input.approval_id_uuid, reason: input.rejection_reason });
      return { success: true };
    }),

  updateApproval: protectedProcedure
    .input(z.object({
      approval_id_uuid: z.string().uuid(),
      proposed_state: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.unknown()), z.record(z.string(), z.unknown())]))
    }))
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const tenantId = ctx.tenantId;
      const now = new Date().toISOString();

      if (isUsingFallback) {
        const approval = (fallbackStore.kanbanApprovals || []).find(
          a => a.id_uuid === input.approval_id_uuid && a.tenant_id === tenantId
        );
        if (!approval) throw new TRPCError({ code: 'NOT_FOUND', message: 'Freigabe nicht gefunden' });

        approval.proposed_payload = input.proposed_state;
        approval.updated_at_utc = now;
        saveFallbackStore();
        return { success: true };
      }

      await pool.query(
        "UPDATE sys_louis_kanban_approvals SET proposed_payload = $1, updated_at_utc = CURRENT_TIMESTAMP WHERE id_uuid = $2 AND (tenant_id = $3 OR tenant_id = '1')",
        [JSON.stringify(input.proposed_state), input.approval_id_uuid, tenantId]
      );

      return { success: true };
    })
});
