# portainer

Docker management UI for day-to-day operational visibility and control.

| Item | Value |
| --- | --- |
| Status | active |
| Compose | [`docker-compose.yml`](/home/will/westOS/services/portainer/docker-compose.yml) |
| Network | `westOS` |
| Route | `portainer.wnwest.com` |
| Data | [`data/`](/home/will/westOS/services/portainer/data) |

<details open>
<summary><strong>Purpose</strong></summary>

Provides a web UI for inspecting and managing containers, networks, and volumes.

</details>

<details>
<summary><strong>Files</strong></summary>

- [`docker-compose.yml`](/home/will/westOS/services/portainer/docker-compose.yml)
- [`data/`](/home/will/westOS/services/portainer/data)

</details>

<details>
<summary><strong>Use</strong></summary>

```bash
cd /home/will/westOS/services/portainer
docker compose up -d
docker compose logs -f
```

</details>

<details>
<summary><strong>Notes</strong></summary>

- Uses local persistent data under the service folder.

</details>
