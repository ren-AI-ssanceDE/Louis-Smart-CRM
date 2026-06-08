import { EventEmitter } from "events";

class WorkflowEventBus extends EventEmitter {
  /**
   * Emits a CRM event to the event bus safely.
   * Any errors thrown by listeners are caught internally to prevent breaking core CRM operations.
   */
  emitEvent(tenantId: string, eventName: string, payload: unknown) {
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
