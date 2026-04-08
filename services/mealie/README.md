# mealie

Recipe management service for household meal planning.

| Item | Value |
| --- | --- |
| Status | active |
| Compose | [`docker-compose.yml`](/home/will/westOS/services/mealie/docker-compose.yml) |
| Network | `westOS` |
| Route | `recipes.wnwest.com` |
| Data | [`/home/will/westOS/data/mealie`](/home/will/westOS/data/mealie) |

<details open>
<summary><strong>Purpose</strong></summary>

Hosts Mealie for recipe storage, browsing, and household food planning.

</details>

<details>
<summary><strong>Files</strong></summary>

- [`docker-compose.yml`](/home/will/westOS/services/mealie/docker-compose.yml)

</details>

<details>
<summary><strong>Use</strong></summary>

```bash
cd /home/will/westOS/services/mealie
docker compose up -d
docker compose logs -f
```

</details>

<details>
<summary><strong>Notes</strong></summary>

- Uses migrated application data and media.

</details>
