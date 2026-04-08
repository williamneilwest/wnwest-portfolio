# Services

Central index for all deployable units in `westOS`.

## Conventions

- each service owns its own directory
- each active service uses its own `docker-compose.yml`
- persistent state should live under [`/home/will/westOS/data`](/home/will/westOS/data) when practical
- browser-facing routes should terminate through [`/home/will/westOS/services/caddy`](/home/will/westOS/services/caddy)

## Catalog

| Service | Role | Status | Doc |
| --- | --- | --- | --- |
| `ai-gateway` | internal model gateway | active | [README](/home/will/westOS/services/ai-gateway/README.md) |
| `barcode-intake` | scanner ingestion into Grocy | active | [README](/home/will/westOS/services/barcode-intake/README.md) |
| `caddy` | reverse proxy and TLS edge | active | [README](/home/will/westOS/services/caddy/README.md) |
| `code-server` | browser development environment | active | [README](/home/will/westOS/services/code-server/README.md) |
| `dashy` | future dashboard scaffold | scaffold | [README](/home/will/westOS/services/dashy/README.md) |
| `filebrowser` | storage and media browser | active | [README](/home/will/westOS/services/filebrowser/README.md) |
| `github-sync` | scheduled git mirror | active | [README](/home/will/westOS/services/github-sync/README.md) |
| `grocy` | pantry and inventory management | active | [README](/home/will/westOS/services/grocy/README.md) |
| `homeassistant` | home automation scaffold | scaffold | [README](/home/will/westOS/services/homeassistant/README.md) |
| `jupyter` | notebook workspace | active | [README](/home/will/westOS/services/jupyter/README.md) |
| `kitchen-ai` | custom kitchen automation service | active | [README](/home/will/westOS/services/kitchen-ai/README.md) |
| `lify` | main app and portfolio stack | active | [README](/home/will/westOS/services/lify/README.md) |
| `mealie` | recipes | active | [README](/home/will/westOS/services/mealie/README.md) |
| `minecraft` | forge game server | active | [README](/home/will/westOS/services/minecraft/README.md) |
| `openwebui` | chat UI on top of the AI gateway | active | [README](/home/will/westOS/services/openwebui/README.md) |
| `plex` | media server | active | [README](/home/will/westOS/services/plex/README.md) |
| `portainer` | Docker UI | active | [README](/home/will/westOS/services/portainer/README.md) |
| `samba` | SMB sharing scaffold | scaffold | [README](/home/will/westOS/services/samba/README.md) |
| `torrents` | `gluetun` and `qbittorrent` stack | active | [README](/home/will/westOS/services/torrents/README.md) |
