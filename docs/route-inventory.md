# WestOS Route Inventory

This file records the current canonical route surface and known legacy aliases.
It is a preparation artifact for phased route cleanup. No aliases listed here
should be removed until a later deprecation-removal phase.

## Frontend

### Canonical Routes

- `/`
- `/login`
- `/app/life`
- `/app/system`
- `/app/flows`
- `/app/flows/templates`
- `/app/terminal`
- `/app/settings`
- `/app/data`
- `/app/data-sources`
- `/app/data/view/:source/:id`
- `/app/reference`
- `/app/ai`
- `/app/ai/documents`
- `/app/ai/documents/:id`
- `/app/admin/users`
- `/app/admin/flows`
- `/app/admin/flow-builder`
- `/app/dev/designer`
- `/app/profile`
- `/app/uploads`
- `/app/kb`
- `/app/kb/processed`
- `/app/work`
- `/app/work/active-tickets`
- `/app/work/closed-tickets`
- `/app/work/table`
- `/app/work/ai-metrics`
- `/app/work/users`
- `/app/work/devices`
- `/app/work/printers`
- `/app/work/groups`
- `/app/work/software`
- `/app/work/codes`
- `/app/work/hardware`
- `/app/work/hardware/rmr-record`
- `/app/device-location`
- `/app/document`
- `/app/software`
- `/tickets/:ticketId`
- `/readme`

### Canonical Notes

- `/app/work/*` is the canonical work route tree.
- `/tickets/:ticketId` remains the canonical ticket detail route.

### Frontend Redirects / Legacy Aliases

- `/work` -> `/app/work`
- `/work/active-tickets` -> `/app/work/active-tickets`
- `/work/tickets` -> `/app/work/active-tickets`
- `/work/closed-tickets` -> `/app/work/closed-tickets`
- `/work/ai-metrics` -> `/app/work/ai-metrics`
- `/work/table` -> `/app/work/table`
- `/work/group-search` -> `/app/work/groups`
- `/work/get-user-groups` -> `/app/work/users`
- `/work/user-group-association` -> `/app/work/users`
- `/work/insights` -> `/app/work/ai-metrics`
- `/work/users` -> `/app/work/users`
- `/work/devices` -> `/app/work/devices`
- `/work/printers` -> `/app/work/printers`
- `/work/groups` -> `/app/work/groups`
- `/work/software` -> `/app/work/software`
- `/work/codes` -> `/app/work/codes`
- `/work/hardware` -> `/app/work/hardware`
- `/work/hardware/rmr-record` -> `/app/work/hardware/rmr-record`
- `/document` -> `/app/document`
- `/csv` -> `/app/data`
- `/life` -> `/app/life`
- `/console` -> `/app/console`
- `/system` -> `/app/system`
- `/flows` -> `/app/flows`
- `/terminal` -> `/app/terminal`
- `/ai` -> `/app/ai`
- `/ai/documents` -> `/app/ai/documents`
- `/admin` -> `/app/console`
- `/admin/users` -> `/app/admin/users`
- `/admin/flows` -> `/app/admin/flows`
- `/profile` -> `/app/profile`
- `/settings` -> `/app/settings`
- `/settings/ai` -> `/app/ai`
- `/uploads` -> `/app/uploads`
- `/kb/processed` -> `/app/kb/processed`
- `/data` -> `/app/data`
- `/reference` -> `/app/reference`

## Backend

### Canonical API Routes

- `/api/auth/login`
- `/api/auth/logout`
- `/api/auth/me`
- `/api/profile`
- `/api/users`
- `/api/users/<int:user_id>`
- `/api/admin/users`
- `/api/admin/users/<int:user_id>`
- `/api/work/tickets`
- `/api/tickets/<ticket_id>`
- `/api/tickets/<ticket_id>/summary`
- `/api/tickets/update-assignee`
- `/api/metrics/active-tickets`
- `/api/work/analyze-csv`
- `/flows/work/recent-analyses`
- `/flows/work/recent-analyses/<analysis_id>/file`
- `/api/uploads`
- `/api/uploads/<path:filename>`
- `/api/files`
- `/api/files/reprocess`
- `/api/files/<path:file_id>`
- `/api/data/upload`
- `/api/data/files/<path:file_id>`
- `/api/data/tools/<file_type>`
- `/api/data-sources`
- `/api/data-sources/promote`
- `/api/data-sources/<int:source_id>`
- `/api/data-sources/<int:source_id>/replace-file`
- `/api/data-sources/<name>`
- `/api/data-sources/<source>/<record_id>`
- `/api/data-sources/<name>/rows`
- `/api/data/<name>`
- `/api/search-users`
- `/api/users/search`
- `/api/search-users-live`
- `/api/users-source`
- `/api/users-source/backup-search`
- `/api/users/context/<username>`
- `/api/users/<path:identifier>`
- `/api/users/<path:identifier>/devices`
- `/api/reference/groups`
- `/api/reference/users`
- `/api/reference/groups/lookup`
- `/api/reference/groups/lookup-flow`
- `/api/reference/groups/user-membership`
- `/api/groups/search`
- `/api/device-locations/source`
- `/api/device-locations/search`
- `/api/device-locations/export`
- `/api/hardware-rmr/search`
- `/api/work/codes`
- `/api/work/codes/upload`
- `/api/work/codes/<code_id>/image`
- `/api/software`
- `/api/software/search`
- `/api/software/upload`
- `/api/kb`
- `/api/kb/<path:category>/<path:filename>`
- `/api/kb/most-accessed`
- `/api/kb/match`
- `/api/kb/analyze`
- `/api/kb/processed`
- `/api/kb/processed/<path:filename>`
- `/api/documents`
- `/api/documents/<int:document_id>`
- `/api/documents/process`
- `/api/ai/chat`
- `/api/ai/health`
- `/api/ai/logs`
- `/api/ai/v1/chat/completions`
- `/api/ai/analyze-document`
- `/api/assistant`
- `/api/settings`
- `/api/settings/ai`
- `/api/agents`
- `/api/agents/<agent_id>`
- `/api/flows/runs`
- `/api/flows/runs/<int:run_id>`
- `/api/flows/templates`
- `/api/flows/templates/<int:template_id>`
- `/api/flows/templates/<int:template_id>/run`
- `/api/system/status`
- `/api/system/services`
- `/api/system/features`
- `/api/system/datasets`
- `/api/system/ai`
- `/api/system/auth`
- `/api/system/map`
- `/api/system/validate`
- `/api/system/regression`
- `/api/logs`
- `/api/logs/summary`
- `/api/services`
- `/health`
- `/api/health`
- `/webhooks/mailgun`
- `/webhooks/kb`

### Backend Legacy Aliases

- `/work/tickets` -> `/api/work/tickets`
- `/api/tickets` -> `/api/work/tickets`
- `/api/tickets/latest` -> `/api/work/tickets`
- `/ai/chat` -> `/api/ai/chat`
- `/chat` -> `/api/ai/chat`
- `/ai/health` -> `/api/ai/health`
- `/ai/logs` -> `/api/ai/logs`
- `/ai/v1/chat/completions` -> `/api/ai/v1/chat/completions`
- `/v1/chat/completions` -> `/api/ai/v1/chat/completions`
- `/api/analyze/document` -> `/api/ai/analyze-document`
- `/ai/analyze-document` -> `/api/ai/analyze-document`
- `/uploads` -> `/api/uploads`
- `/uploads/<path:filename>` -> `/api/uploads/<path:filename>`
- `/kb` -> `/api/kb`
- `/kb/<path:category>/<path:filename>` -> `/api/kb/<path:category>/<path:filename>`
- `/settings` -> `/api/settings`
- `/settings/ai` -> `/api/settings/ai`
- `/flows/system/status` -> `/api/system/status`
- `/api/software-registry/upload` -> `/api/software/upload`
