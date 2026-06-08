# SYSTEM INSTRUCTION OVERRIDE: PROTECT E-INVOICING & COMPLIANCE
# Referenzierend auf AGENTS.md

⏰ **CURRENT REFERENCE DATE**: This project is context-locked to **June 6, 2026**. All solutions, components, packages, and systems MUST be completely up-to-date and modern relative to this reference time.

As an AI Coding Agent, you must adhere strictly to the following critical constraints:

## 🔒 1. NO UNSAFE TYPES (TypeScript `any` is forbidden)
* You are strictly forbidden from writing, suggesting, or inserting the `any` type in TypeScript.
* All variables, functions, arguments, properties, and boundaries must be explicitly and safely typed using correct interfaces, custom types, generic parameters, or `unknown` where appropriate.

## 🔒 2. INTERNATIONALIZATION (i18n is mandatory)
* You must always respect and implement internationalization (i18n). Do not hardcode user-facing strings, labels, errors, or alerts directly into screens.
* All translation strings must be integrated into the respective translation dictionaries:
  - German: `/src/i18n/locales/de.json`
  - English: `/src/i18n/locales/en.json`

## 🔒 3. LOCAL-ONLY STACK & NO CLOUD SERVICES WITHOUT PERMISSION
* You are strictly forbidden from integrating, deploying, or invoking any cloud or external services (such as Google GenAI/Gemini API, Firebase, analytical platforms, external databases, or third-party web endpoints) without the user's explicit, written permission.
* Implement all capabilities and features locally by default within the node/browser components.

## 🔒 4. EXTREME CAUTION FOR DOCKER CONTAINER SETUPS
* The files **`Dockerfile.txt`**, **`docker-compose.yml`**, and **`docker-entrypoint.sh.txt`** are vital to the seamless "one-click" local container execution of Louis CRM.
* Any edits or revisions to these files are permitted (e.g., to network additional services), but MUST be treated with extreme caution and precision.
* **STRICT ENGINE PROTECTION**: The embedded configurations for headless Java Runtime (JRE 17), Ghostscript installation, and the download/setup of `mustang-cli.jar` must never be touched, changed, or removed. These configurations are the foundational engine infrastructure. Every edit must fully guarantee that Docker runtime stability and compliance remains intact and runs flawlessly out-of-the-box.

---

## 🔒 CRITICAL ENGINE PROTECTION: E-INVOICING

As an AI Coding Agent, you are STRICTLY FORBIDDEN from modifying, refactoring, or deleting any files related to the E-Invoicing (ZUGFeRD/Factur-X) creation engine. This logic is certified, standardized under EN 16931, and validated with veraPDF.

## Forbidden Paths to Edit:
*   `/src/lib/zugferd.ts`
*   `/src/server/pdfHelper.ts`
*   `/scripts/PDFA_def.ps` (Ghostscript PDF/A OutputIntent/sRGB definition template)

Any modification to these files will break German financial (GoBD / EN 16931) compliance. Keep these files read-only under all conditions.
