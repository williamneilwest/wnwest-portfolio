# minecraft

Minecraft Forge server with persistent world and modpack state.

| Item | Value |
| --- | --- |
| Status | active |
| Compose | [`docker-compose.yml`](/home/will/westOS/services/minecraft/docker-compose.yml) |
| Network | `westOS` |
| Port | `25565` |
| Data | [`/home/will/westOS/data/minecraft`](/home/will/westOS/data/minecraft) |

<details open>
<summary><strong>Purpose</strong></summary>

Runs the Forge-based game server with durable world data and containerized runtime config.

</details>

<details>
<summary><strong>Files</strong></summary>

- [`docker-compose.yml`](/home/will/westOS/services/minecraft/docker-compose.yml)

</details>

<details>
<summary><strong>Use</strong></summary>

```bash
cd /home/will/westOS/services/minecraft
docker compose up -d
docker compose logs -f
```

</details>

<details>
<summary><strong>Notes</strong></summary>

- Large persistent state was migrated into `data/minecraft`.
- Health may take time to settle after startup.

</details>
