# Qualitätssicherung & Tests

> Öffentliche Kurzfassung — die vollständigen internen QA-Prozesse und Test-Skripte liegen **nicht** im öffentlichen Repository.

## Qualitätsansatz

Louis Smart CRM wird im Entwicklungsprozess auf mehreren Ebenen abgesichert:

| Ebene | Was geprüft wird |
|---|---|
| **TypeScript-Lint** | `tsc --noEmit` (strikte Typisierung, kein `any`) |
| **Projektregeln** | Automatisierte Regeln im Entwicklungsprozess: keine hardcodierten UI-Texte (i18n-Pflicht DE/EN), Schutz kritischer Systemdateien, additive Migrationen — als pre-commit-Hook |
| **Unit-/Integrationstests** | Vitest, Node-Umgebung, ohne echte DB (Fallback-Store) — Router, Schemas, Auth, Workflows, MCP-Tools |
| **End-to-End-Tests** | Playwright — hermetisch (Fallback-Server) und live gegen den Docker-Stack |
| **MCP-Volltest** | Alle Katalog-Tools + Prompts gegen den laufenden Stack |
| **ZUGFeRD-Validierung** | Erzeugte E-Rechnungen werden gegen EN 16931 (Mustang) und PDF/A-3b geprüft |
| **Frisch-Start-Test** | Kompletter Docker-Rebuild ohne Cache → Health → Smoke-Test |

## Datenschutz bei Tests

QA-Szenarien laufen ausschließlich mit **synthetischen Testdaten** (generische Testfirma, „Test Testkunde") — niemals mit echten Kontakten oder Unternehmen. Alle Testdaten, Keys und Artefakte werden nach der Verifikation vollständig entfernt.

## Release-Gates

Vor jeder Veröffentlichung: Lint + Projektregeln + Build + komplette Test-Suite + Live-Verifikation + Backup vor DB-Migrationen. Die Ergebnisse werden pro Release dokumentiert (siehe `CHANGELOG.md`).
