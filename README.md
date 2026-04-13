# westOS

<details>
<summary><strong>Project Directory Tree</strong> (click to expand)</summary>

```text
westos/
├── ai-gateway/
├── backend/
├── frontend/
├── caddy/
├── data/
│   ├── uploads/
│   ├── kb/
│   ├── csv_analyses/
│   ├── ai_analysis_cache/
│   ├── agents.json
│   ├── settings.json
│   └── ai-interactions.jsonl
├── devtools/
├── homelab/
├── docker-compose.yml
└── README.md
```

</details>

---

# 🧠 SYSTEM PURPOSE

westOS is a production-focused operations workspace for:

* ticket dataset analysis
* knowledge base (KB) document ingestion and management
* AI-powered document and ticket summarization
* structured metadata extraction for operational workflows
* internal tool orchestration and automation

---

# 🧱 CORE ARCHITECTURE (REQUIRED)

### Services

* `frontend/` (React + Vite)
* `backend/` (Flask API + orchestration)
* `ai-gateway/` (Flask AI proxy)
* `caddy/` (reverse proxy + TLS)
* `data/` (persistent runtime storage)

---

# 🔁 AI PIPELINE (STRICT REQUIREMENT)

All AI traffic MUST follow:

```text
frontend → /api/ai/chat → backend → ai_client → ai-gateway → model
```

### ❌ Violations

* Direct OpenAI calls from backend or frontend
* Parallel or duplicate AI pipelines

---

# 🤖 AGENT SYSTEM (REQUIRED)

Agents are defined in:

```text
/data/agents.json
```

Each agent must include:

* `id`
* `name`
* `prompt_template`
* `enabled`

### Required Agents

* `ticket_analyzer`
* `kb_ingestion`
* `regression_agent` (system validation)

---

# 📂 DATA STORAGE CONTRACT (STRICT)

All runtime data MUST exist under:

```text
/home/will/westos/data/
```

### Subdirectories

* `uploads/` → raw uploaded files (manual + email)
* `kb/` → structured KB documents
* `csv_analyses/` → parsed CSV outputs
* `ai_analysis_cache/` → temporary AI outputs

---

# 📦 KB DOCUMENT STRUCTURE (REQUIRED)

Each KB document must follow:

```text
/data/kb/<doc_id>/
  original.txt
  summary.txt
  metadata.json
```

### metadata.json REQUIRED FIELDS

* `title`
* `tags`
* `systems`
* `actions`
* `search_hints`
* `related_ticket_patterns`
* `confidence`

### OPTIONAL

* `doc_type`
* `entities`
* `use_cases`

---

# 📊 FILE EXPLORER (REQUIRED FEATURE)

The Data Tools page must:

### Display files from:

* `/data/uploads`
* `/data/kb`
* `/data/csv_analyses`

### Provide actions:

* View
* Analyze (AI)
* Reprocess
* Delete

### Access + Scope

* Intended for authenticated admin operations
* Must enumerate files from runtime storage only
* Must not bypass existing `/api/files` and `/api/data/files/*` contracts

---

# 📥 EMAIL INGESTION PIPELINE (STRICT)

Flow:

```text
Email → /webhooks/mailgun → save file → process_uploaded_file()
```

### Rules

* MUST reuse existing upload processing logic
* MUST NOT stop after file save
* MUST support:

  * multipart file uploads
  * base64 attachments
  * recipient routing for `kb@...`, `upload@...`, and `uploads@...`

### Processing Behavior

* File save success must not fail if AI post-processing fails
* AI ingestion must run as best-effort via existing service flow
* No direct model/provider calls in upload routes

---

# 📄 DOCUMENT INGESTION (KB)

* Must use `kb_ingestion` agent
* Must produce:

  * human-readable summary
  * structured metadata JSON
* Must store output in `/data/kb/`

---

# 🎟️ TICKET ANALYSIS

* Must use `ticket_analyzer` agent
* Output must be:

  * concise
  * casual IT peer tone
* Must NOT generate formal reports

---

# 🏷️ TAGGING + MATCHING SYSTEM

### Backend source of truth

* `tag_derivation.py`
* `ticket_match.py`

### Rules

* Tags must be normalized
* Low-signal tags must be filtered
* Weighted scoring must remain intact

---

# 🧪 SYSTEM BEHAVIOR EXPECTATIONS

The system MUST support:

* Upload file → visible in UI
* Email attachment → processed and visible
* KB ingestion → structured metadata generated
* Ticket analysis → uses correct agent + tone
* File explorer → shows all data sources

---

# 🚨 REGRESSION CONDITIONS (FAIL STATES)

The following indicate system regression:

* AI pipeline bypassed
* Missing or unused agents
* KB metadata missing required fields
* Email uploads not processed
* Uploaded files not visible in UI
* File explorer missing sources
* Duplicate AI logic introduced
* `/api/system/regression` missing or returning invalid schema
* `regression_agent` missing or disabled

---

# 🧪 VALIDATION CHECKLIST

### Data

* Upload CSV → appears + processed
* Upload document → KB ingestion runs
* Email attachment → appears in system

### AI

* Ticket analysis → correct tone
* KB ingestion → structured metadata

### UI

* File explorer → complete + functional

### Regression API

* `GET /api/system/regression` returns:
  * `status`
  * `summary`
  * `matches`
  * `warnings`
  * `failures`
  * `recommended_fixes`

---

# ⚙️ ENVIRONMENT SETUP

```bash
cp .env.example .env
```

Required:

* `OPENAI_API_KEY`
* `USE_AI_GATEWAY=true`
* `AI_ANALYSIS_ENABLED=true`

Optional:

* `ENABLE_WEIGHTED_MATCHING=false`

---

# 🛠️ BUILD + RUN

```bash
cd frontend
npm install
npm run build

docker compose up --build
```

---

# 🧪 VALIDATION COMMANDS

```bash
python3 -m py_compile backend/app/routes/kb.py \
backend/app/routes/email_upload.py \
backend/app/services/tag_derivation.py \
backend/app/services/ticket_match.py
```

```bash
cd frontend
npm run build
```

```bash
python3 -m py_compile backend/app/services/system_snapshot.py \
backend/app/services/regression_service.py \
backend/app/routes/system.py
```

---

# 🤖 REGRESSION AGENT USAGE

The system supports an AI regression agent that:

* compares system state to this README
* detects drift, missing features, or violations
* produces structured reports

### Runtime Contract

* Route: `GET /api/system/regression`
* Data sources:
  * repository `README.md`
  * live route map
  * runtime data directories
  * `data/agents.json`
* AI call path must still be:
  * `regression_service -> ai_client.send_chat -> ai-gateway`

This README serves as the **single source of truth** for system validation.

---

# END
