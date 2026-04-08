# caddy

Primary reverse proxy and TLS entrypoint for the stack.

| Item | Value |
| --- | --- |
| Status | active |
| Compose | [`docker-compose.yml`](/home/will/westOS/services/caddy/docker-compose.yml) |
| Ports | `80`, `443` |
| Networks | `westOS`, `homelab` |
| Config | [`Caddyfile`](/home/will/westOS/services/caddy/Caddyfile) |

<details open>
<summary><strong>Purpose</strong></summary>

Terminates browser-facing traffic and routes requests to the appropriate internal services.

</details>

<details>
<summary><strong>Files</strong></summary>

- [`docker-compose.yml`](/home/will/westOS/services/caddy/docker-compose.yml)
- [`Caddyfile`](/home/will/westOS/services/caddy/Caddyfile)
- [`data/`](/home/will/westOS/services/caddy/data)
- [`config/`](/home/will/westOS/services/caddy/config)

</details>

<details>
<summary><strong>Use</strong></summary>

```bash
cd /home/will/westOS/services/caddy
docker compose up -d
docker compose logs -f
```

</details>

<details>
<summary><strong>Notes</strong></summary>

- `westOS` covers migrated services.
- `homelab` remains attached so excluded legacy services can still resolve while migration is in progress.

</details>
