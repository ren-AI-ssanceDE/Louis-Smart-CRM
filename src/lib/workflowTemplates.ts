// ============================================================================
// Auftrag 008 4C (T7): Workflow-Vorlagen-Bibliothek.
// 1-Klick-Starter: Zahlungserinnerung, Angebot nachfassen, Onboarding,
// Overdue-Report. Reine Daten (kein any, Regel 4) — Labels via i18n in der UI.
// ============================================================================

export interface WorkflowTemplateStep {
  tool: string;
  instruction: string;
}

export interface WorkflowTemplate {
  id: string;
  nameKey: string; // i18n-Key unter admin.workflows_tab.templates.<id>.name
  descKey: string;
  i18nNamespace: "admin";
  steps: WorkflowTemplateStep[];
  triggerType: "MANUAL" | "CRM_EVENT" | "TIMER";
  triggerConfig: Record<string, unknown>;
  directSendEmail?: boolean;
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "zahlungserinnerung",
    nameKey: "admin:workflows_tab.templates.zahlungserinnerung.name",
    descKey: "admin:workflows_tab.templates.zahlungserinnerung.desc",
    i18nNamespace: "admin",
    triggerType: "CRM_EVENT",
    triggerConfig: { event_name: "invoice.overdue", delay_seconds: 0 },
    steps: [
      { tool: "executeCrmDataAnalyst", instruction: '{"task":"find_invoices","description":"Finde alle überfälligen Rechnungen mit offenem Betrag und zugehörigem Kontakt."}' },
      { tool: "executeTextGenerator", instruction: "Formuliere eine höfliche Zahlungserinnerung für die überfällige Rechnung. Nenne Rechnungsnummer, Betrag und Fälligkeitsdatum. Verwende die tatsächlichen Kundendaten, erfinde keine Namen." },
      { tool: "executeSendSmtpEmail", instruction: "Sende die Zahlungserinnerung an den Kontakt der überfälligen Rechnung." }
    ],
    directSendEmail: false
  },
  {
    id: "angebot_nachfassen",
    nameKey: "admin:workflows_tab.templates.angebot_nachfassen.name",
    descKey: "admin:workflows_tab.templates.angebot_nachfassen.desc",
    i18nNamespace: "admin",
    triggerType: "CRM_EVENT",
    triggerConfig: { event_name: "offer.created", delay_seconds: 86400 }, // 1 Tag nach Angebotserstellung
    steps: [
      { tool: "executeCrmDataAnalyst", instruction: '{"task":"get_offer","description":"Hole das gerade erstellte Angebot mit Kundendaten (Firma, Ansprechpartner, Betrag)."}' },
      { tool: "executeTextGenerator", instruction: "Formuliere eine freundliche Nachfass-Nachricht zum Angebot. Erwähne den Angebotsbetrag und biete Hilfe bei Fragen an. Keine erfundenen Namen." },
      { tool: "executeSendSmtpEmail", instruction: "Sende die Nachfass-Nachricht an den Ansprechpartner des Angebots." }
    ],
    directSendEmail: false
  },
  {
    id: "onboarding",
    nameKey: "admin:workflows_tab.templates.onboarding.name",
    descKey: "admin:workflows_tab.templates.onboarding.desc",
    i18nNamespace: "admin",
    triggerType: "CRM_EVENT",
    triggerConfig: { event_name: "company.created", delay_seconds: 3600 },
    steps: [
      { tool: "executeCrmDataAnalyst", instruction: '{"task":"get_company","description":"Hole die neu angelegte Firma inklusive Ansprechpartner."}' },
      { tool: "executeTextGenerator", instruction: "Formuliere eine Willkommensnachricht für den neuen Kunden. Stelle die Zusammenarbeit vor und frage nach ersten Wünschen. Keine erfundenen Namen." },
      { tool: "executeSendSmtpEmail", instruction: "Sende die Willkommensnachricht an den Hauptkontakt der neuen Firma." },
      { tool: "executeCreateNoteDraft", instruction: '{"note_text":"Onboarding-E-Mail an neuen Kunden gesendet.","company_id":"{{company.id_uuid}}"}' }
    ],
    directSendEmail: false
  },
  {
    id: "overdue_report",
    nameKey: "admin:workflows_tab.templates.overdue_report.name",
    descKey: "admin:workflows_tab.templates.overdue_report.desc",
    i18nNamespace: "admin",
    triggerType: "TIMER",
    triggerConfig: { frequency: "weekly", time: "08:30", weekday: "1" }, // Montag 08:30
    steps: [
      { tool: "executeCrmDataAnalyst", instruction: '{"task":"count_overdue_invoices","description":"Ermittle alle überfälligen Rechnungen, summiere die offenen Beträge und gruppiere nach Kunde."}' },
      { tool: "executeTextGenerator", instruction: "Erstelle einen wöchentlichen Überfälligkeits-Report: Gesamtbetrag, Anzahl Rechnungen, Top-Kunden. Kompakt und tabellarisch." },
      { tool: "executeSendSmtpEmail", instruction: "Sende den Überfälligkeits-Report als interne Information an die Geschäftsleitung." }
    ],
    directSendEmail: false
  }
];

export function getWorkflowTemplate(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((t) => t.id === id);
}
