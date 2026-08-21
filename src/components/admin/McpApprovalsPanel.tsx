// Admin-Panel: MCP-Freigaben (Genehmigungs-Queue, Task C.4-UI, Plan 2026-08-19)
// Write-Tools auf untrusted-Servern warten auf Admin-Entscheidung (2-Stufen-Inline: Freigeben → Wirklich?).
import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert, Check, X, RefreshCw } from "lucide-react";
import { trpc } from "../../lib/trpc";

export function McpApprovalsPanel(): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const utils = trpc.useContext();
  const requestsQuery = trpc.listMcpApprovalRequests.useQuery(undefined, { enabled: true });
  const decideMutation = trpc.decideMcpApprovalRequest.useMutation({
    onSuccess: () => utils.listMcpApprovalRequests.invalidate()
  });
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const requests = (requestsQuery.data || []) as Array<{
    id_uuid: string;
    server_name: string;
    original_tool_name: string;
    tool_arguments_json: unknown;
    requested_by: string;
    status: string;
    created_at: string | Date;
  }>;
  const pending = requests.filter((r) => r.status === "pending");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <ShieldAlert size={14} className="text-accent-orange" />
          {t("admin:mcp_approvals_title", { defaultValue: "MCP-Freigaben" })}
          {pending.length > 0 && (
            <span className="text-[10px] font-mono text-accent-orange border border-accent-orange/30 rounded-full px-2 py-0.5">
              {pending.length}
            </span>
          )}
        </h4>
        <button
          type="button"
          onClick={() => utils.listMcpApprovalRequests.invalidate()}
          className="p-1.5 rounded-lg border border-white/5 text-slate-400 hover:text-white transition-all"
          title={t("common:refresh", { defaultValue: "Aktualisieren" })}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {pending.length === 0 && (
        <p className="text-xs text-slate-500 text-center py-8">
          {t("admin:mcp_approvals_empty", { defaultValue: "Keine ausstehenden Freigaben" })}
        </p>
      )}

      <div className="space-y-2">
        {pending.map((req) => {
          let argsPreview = "";
          try {
            argsPreview = JSON.stringify(req.tool_arguments_json ?? {}).slice(0, 160);
          } catch {
            argsPreview = "";
          }
          return (
            <div key={req.id_uuid} className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-white">{req.original_tool_name}</span>
                <span className="text-[10px] text-slate-400 border border-white/10 rounded-full px-2 py-0.5 font-mono">
                  {req.server_name}
                </span>
                <span className="text-[10px] text-slate-500 font-mono">{req.requested_by}</span>
              </div>
              <p className="text-[11px] text-slate-500 font-mono mt-1 break-all">{argsPreview}</p>
              <div className="flex items-center gap-2 mt-2">
                {confirmId === req.id_uuid ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        void decideMutation.mutateAsync({
                          id_uuid: req.id_uuid,
                          decision: "approve"
                        } as { id_uuid: string; decision: "approve" | "reject" });
                        setConfirmId(null);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold"
                    >
                      {t("admin:mcp_approvals_confirm_approve", { defaultValue: "Wirklich freigeben?" })}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      className="px-2.5 py-1.5 rounded-lg border border-white/10 text-slate-400 text-xs"
                    >
                      {t("common:cancel", { defaultValue: "Abbrechen" })}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setConfirmId(req.id_uuid)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold hover:bg-emerald-500/25 transition-all"
                    >
                      <Check size={12} />
                      {t("admin:mcp_approvals_approve", { defaultValue: "Freigeben" })}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void decideMutation.mutateAsync({
                          id_uuid: req.id_uuid,
                          decision: "reject"
                        } as { id_uuid: string; decision: "approve" | "reject" })
                      }
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs font-bold hover:bg-red-500/20 transition-all"
                    >
                      <X size={12} />
                      {t("admin:mcp_approvals_reject", { defaultValue: "Ablehnen" })}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {requests.length > pending.length && (
        <p className="text-[10px] text-slate-500">
          {t("admin:mcp_approvals_history", { defaultValue: "Ältere Entscheidungen" })}: {requests.length - pending.length}
        </p>
      )}
    </div>
  );
}
