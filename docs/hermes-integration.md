# Hermes ↔ Louis Smart CRM: Drive a self-hosted CRM from your agent

**What this is:** Louis Smart CRM is a self-hosted, AI-native CRM for small
businesses and freelancers (contacts, companies, invoices, offers, kanban,
knowledge vault, workflows — all with a built-in AI assistant). It also ships
as a **Model Context Protocol (MCP) server**: any MCP-capable agent — Hermes
included — can connect to it over HTTP and use the CRM as if the tools were
its own. Your data stays on your machine; there is no SaaS account and no
third-party cloud involved.

This guide gets you from zero to your first real tool call in about five
minutes. It was tested against **Louis Smart CRM 2.1.13** (September 2026)
and **Hermes Agent 0.20+**.

---

## 1. What you get

Once connected, the agent can, in natural language or scripted calls:

- List, create, and update **contacts** and **companies**
- Read and create **invoices** (including ZUGFeRD/XRechnung e-invoice data and
  PDF rendering) and **offers**
- Work with **kanban boards** (deals/pipeline)
- Search and write the internal **knowledge vault**
- List and approve **mail drafts**
- Trigger the built-in **AI assistant** (`crm_run_louis_ai`) or a
  multi-model **council deliberation**
- Learn **workflows** from repeated action sequences

The MCP endpoint exposes **42 tools** on the current version, grouped by
domain. Tool *names* and input schemas are English; the human-readable tool
*descriptions* the server sends are currently German.

## 2. Prerequisites

- A running Louis Smart CRM stack. From the project directory:
  `docker compose up -d` — then open `http://localhost:3000` and complete the
  first-login flow.
- Hermes Agent installed (`hermes --version`).

Everything below assumes Louis runs on the same host as your agent
(`localhost`). See [Troubleshooting](#8-troubleshooting) if that is not the
case.

## 3. Step 1 — Create an API key (Louis side)

1. Log in to Louis as admin and open **Admin → MCP**.
2. In the API-key section, choose a name and the **scopes** you need:
   - `read` — listing and reading (contacts, companies, invoices, offers,
     vault, sessions)
   - `write` — creating/updating/deleting via the write tools
   - `admin` — administrative operations (AI run, council, mail approval)
   - `full_access` — everything
   - Optional: per-tool permissions for fine-grained control instead of the
     generic scopes.
3. Optional: set an expiry (in days) so the key stops working after a fixed
   period.
4. Create the key. **The raw key is shown exactly once** — copy it
   immediately (the UI tells you it will never be shown again).

Facts worth knowing:

- A generated raw key looks like `louis_mcp_live_<32 hex chars>`. In this
  guide, the placeholder `louis_mcp_<name>` stands for whatever key you
  created — treat it like a password.
- The server stores **only the SHA-256 hash** of the key. Nobody — not even
  an admin — can recover the raw key later; the UI shows only a short prefix
  for identification.
- Keys are **revocable at any time**: revoking disables the key immediately
  (the entry stays visible with an "inactive" badge); deleting removes it
  entirely.
- Every write performed with a key is written to the **audit log**
  (Admin → Audit-Log) with the actor recorded as the MCP client.

## 4. Step 2 — Connect Hermes (agent side)

Add the server with `hermes config set` (do not hand-edit `config.yaml`):

```bash
hermes config set mcp_servers.louis_crm.url http://localhost:3000/api/mcp
hermes config set mcp_servers.louis_crm.headers.Authorization "Bearer louis_mcp_<name>"
```

Replace `louis_mcp_<name>` with your real key. Both values land under
`mcp_servers.louis_crm` in your Hermes config.

**Restart Hermes** (start a new session) so it connects to the server and
discovers its tools. In recent versions you can also run `/reload-mcp` in an
existing session. Once loaded, the 42 CRM tools are available with the prefix
`mcp__louis_crm__`, e.g. `mcp__louis_crm__crm_list_companies`.

> Alternative: `hermes mcp add louis_crm --url http://localhost:3000/api/mcp
> --auth header` walks you through the same configuration interactively.

## 5. Step 3 — Verify the connection

```bash
hermes mcp test louis_crm
```

Expected output (trimmed):

```text
Testing 'louis_crm'...
  Transport: HTTP → http://localhost:3000/api/mcp
    Authorization: ***
  ✓ Connected (1000ms)
  ✓ Tools discovered: 42

    crm_list_companies    Abruf und Filterung von Unternehmen aus dem CRM
    crm_get_company       Detailansicht eines Unternehmens inklusive ...
    crm_create_company    Neuanlage eines Unternehmens im CRM
    crm_list_contacts     Abruf von Ansprechpartnern / Kontakten aus dem CRM
    crm_create_contact    Anlegen eines Ansprechpartners ...
    ... (all 42 tools are listed)
```

"Connected" plus the tool list means the key works and discovery succeeded.
The number may grow in later Louis versions — the test output always shows
the current list.

## 6. First steps (use example data only)

All examples below use **synthetic data**. Never point a test run at real
customer data — use names like `Muster GmbH`, `Erika Musterfrau` or
`Test Testkunde` and `example.com` addresses.

### Read: list companies matching a search term

Ask your agent, or call the tool directly:

```text
mcp__louis_crm__crm_list_companies  {"search": "Muster"}
```

The result is a JSON text payload:

```json
{
  "items": [
    {
      "id_uuid": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "full_legal_name": "Muster GmbH",
      "email_address": "kontakt@muster-gmbh.example.com",
      "city": "Musterstadt"
    }
  ],
  "pagination": { "total_count": 1, "limit": 20, "offset": 0, "has_more": false },
  "search_meta": { "searched_term": "Muster", "fuzzy_matched": true }
}
```

Contacts work the same way: `mcp__louis_crm__crm_list_contacts` accepts
`search`, an optional `company_id_uuid` filter, `limit` and `offset`. Most
tools accept a `search`/`limit`/`offset` trio; mutation tools take the
respective create/update fields.

### Write: create a company and a linked contact

A realistic agent dialog looks like this:

> **User:** Create a contact at Muster GmbH for Erika Musterfrau,
> e.musterfrau@example.com.
>
> **Agent** (under the hood):
> 1. `crm_list_companies {"search": "Muster"}` — resolve the company.
> 2. `crm_create_company {...}` if it does not exist yet.
> 3. `crm_create_contact` with `associated_company_id` set to the company id.

```json
{
  "full_legal_name": "Muster GmbH",
  "email_address": "kontakt@muster-gmbh.example.com",
  "city": "Musterstadt"
}
```

```json
{
  "first_name": "Erika",
  "last_name": "Musterfrau",
  "email_address": "e.musterfrau@example.com",
  "language": "de",
  "associated_company_id": "<id of Muster GmbH>"
}
```

`crm_create_contact` only requires `last_name`; everything else is optional.
The response contains the created record including its `id_uuid`. Write tools
are idempotent per call — each call creates one new record, so agents should
resolve before creating.

## 7. Security model and boundaries (honest)

- **Incoming direction (external agent → Louis):** tool access is protected
  by the API key and its scopes/per-tool permissions, and every write is
  recorded in the audit log. Writes from an external MCP client are **not**
  routed through the human approval queue — a key with `write` scope can
  create or change records immediately. That is a deliberate design choice:
  the key *is* the authorization, so keep scopes minimal and revoke keys you
  no longer need.
- **Outgoing direction (Louis → external MCP servers, e.g. Obsidian vault,
  Google Workspace):** this direction *is* governed — external tool use is
  configured per chat profile with its own approval flows, and the
  approval/human-gate queue protects those calls.
- Draft-based flows still exist where a business process requires them:
  email campaigns create **drafts** that an explicit approval call
  (`mail_approve_draft`) finalizes. Direct CRM record tools write
  immediately, as shown above.
- Watch **Admin → Audit-Log**: it is filterable and exportable, and it is the
  place to review what a connected agent has done.

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `401 Unauthorized: Invalid or expired MCP API Key` | The key is wrong, revoked, or past its expiry. Create a new key in Admin → MCP and update the `Authorization` header. |
| `401` with "Missing Authorization Bearer token" | The `Authorization` header is missing entirely — re-run the two `hermes config set` commands and restart Hermes. |
| Connection works, but no `mcp__louis_crm__*` tools in a session | Tools are discovered at session start. Start a new Hermes session or run `/reload-mcp`. |
| `hermes mcp list` shows the server as disabled | Enable it, or remove and re-add the entry. |
| Fewer than 42 tools appear | A `tools.include`/`tools.exclude` filter is active on the server entry (`hermes mcp configure louis_crm` adjusts it). |
| `Failed to connect to http://localhost:3000/...` | Louis is not running, or not reachable from where the agent runs. The endpoint only listens on the host Louis runs on — remote access is not part of the default setup. |

Tool-call errors are returned inside the result payload (`isError: true` with
a text message), not as transport failures — an agent should read the result
text, not only the HTTP status.

## 9. Further reading

- Repository: [ren-AI-ssanceDE/Louis-Smart-CRM](https://github.com/ren-AI-ssanceDE/Louis-Smart-CRM)
- Full documentation index: the `docs/` folder in the repository
- Louis' MCP server design and security details (German):
  `docs/Readme Model Context Protocol (MCP).md`
- MCP protocol specification: <https://modelcontextprotocol.io>
- Hermes MCP features and configuration:
  <https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp>
