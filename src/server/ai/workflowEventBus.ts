import { EventEmitter } from "events";

export type CRMEventType =
  | 'contact.created'
  | 'contact.updated'
  | 'contact.deleted'
  | 'company.created'
  | 'company.updated'
  | 'company.deleted'
  | 'invoice.created'
  | 'invoice.updated'
  | 'invoice.status_changed'
  | 'invoice.overdue'
  | 'invoice.paid'
  | 'invoice.finalized'
  | 'offer.created'
  | 'offer.finalized'
  | 'offer.sent'
  | 'email.draft_created'
  | 'file.uploaded'
  | 'knowledge.file_uploaded'
  | 'kanban.board_created'
  | 'kanban.column_created'
  | 'kanban.card_created'
  | 'kanban.card_moved'
  | 'kanban.card_updated'
  | 'kanban.card_deleted';

class WorkflowEventBus extends EventEmitter {
  /**
   * Emits a CRM event to the event bus safely.
   * Any errors thrown by listeners are caught internally to prevent breaking core CRM operations.
   */
  emitEvent(tenantId: string, eventName: CRMEventType | string, payload: unknown) {
    const formattedPayload = {
      tenantId,
      eventName,
      timestamp: new Date().toISOString(),
      data: payload
    };

    console.log(`[WorkflowEventBus] 🔔 CRM Event: "${eventName}" triggered for Tenant: "${tenantId}"`);

    // Emit asynchronous-like events using process.nextTick to avoid blocking the main server controller call stack
    process.nextTick(() => {
      try {
        // Emit general event
        this.emit("event", formattedPayload);
        
        // Emit wildcard event
        this.emit(`*:${eventName}`, formattedPayload);
        
        // Emit tenant-specific event
        this.emit(`${tenantId}:${eventName}`, formattedPayload);
      } catch (err) {
        console.error(`[WorkflowEventBus] ❌ Failed to dispatch event "${eventName}" for tenant: "${tenantId}":`, err);
      }
    });
  }
}

export const workflowEventBus = new WorkflowEventBus();
