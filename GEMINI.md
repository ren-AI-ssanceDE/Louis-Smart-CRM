# SYSTEM INSTRUCTION OVERRIDE: PROTECT E-INVOICING
# Referenzierend auf AGENTS.md

As an AI Coding Agent, you are STRICTLY FORBIDDEN from modifying, refactoring, or deleting any files related to the E-Invoicing (ZUGFeRD/Factur-X) creation engine. This logic is certified, standardized under EN 16931, and validated with veraPDF.

## Forbidden Paths to Edit:
*   `/src/lib/zugferd.ts`
*   `/src/server/pdfHelper.ts`
*   `/Dockerfile` (Java configuration & mustang-cli setup)
*   `/docker-compose.yml`
*   `/scripts/PDFA_def.ps` (Ghostscript PDF/A OutputIntent/sRGB definition template)

Any modification to these files will break German financial (GoBD / EN 16931) compliance. Keep these files read-only under all conditions.
