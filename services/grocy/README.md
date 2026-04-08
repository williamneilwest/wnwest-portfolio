# grocy

Inventory and pantry management service for household workflows.

| Item | Value |
| --- | --- |
| Status | active |
| Compose | [`docker-compose.yml`](/home/will/westOS/services/grocy/docker-compose.yml) |
| Network | `westOS` |
| Route | `pantry.wnwest.com` |
| Data | [`/home/will/westOS/data/grocy`](/home/will/westOS/data/grocy) |

<details open>
<summary><strong>Purpose</strong></summary>

Hosts Grocy as the core pantry, inventory, and household tracking system.

</details>

<details>
<summary><strong>Files</strong></summary>

- [`docker-compose.yml`](/home/will/westOS/services/grocy/docker-compose.yml)

</details>

<details>
<summary><strong>Use</strong></summary>

```bash
cd /home/will/westOS/services/grocy
docker compose up -d
docker compose logs -f
```

</details>

<details>
<summary><strong>Notes</strong></summary>

- Uses migrated Grocy config and database data.

</details>
