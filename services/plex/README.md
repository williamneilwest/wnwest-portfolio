# plex

Media server with migrated configuration and durable library state.

| Item | Value |
| --- | --- |
| Status | active |
| Compose | [`docker-compose.yml`](/home/will/westOS/services/plex/docker-compose.yml) |
| Network Mode | `host` |
| Route | `plex.wnwest.com` |
| Data | [`/home/will/westOS/data/plex`](/home/will/westOS/data/plex) |

<details open>
<summary><strong>Purpose</strong></summary>

Runs the main media server while preserving legacy host-network behavior.

</details>

<details>
<summary><strong>Files</strong></summary>

- [`docker-compose.yml`](/home/will/westOS/services/plex/docker-compose.yml)

</details>

<details>
<summary><strong>Use</strong></summary>

```bash
cd /home/will/westOS/services/plex
docker compose up -d
docker compose logs -f
```

</details>

<details>
<summary><strong>Notes</strong></summary>

- Stays on host networking to preserve previous behavior.

</details>
