# filebrowser

Web file manager for mounted storage and media browsing.

| Item | Value |
| --- | --- |
| Status | active |
| Compose | [`docker-compose.yml`](/home/will/westOS/services/filebrowser/docker-compose.yml) |
| Network | `westOS` |
| Route | `files.wnwest.com` |
| Data | [`/home/will/westOS/data/filebrowser`](/home/will/westOS/data/filebrowser) |

<details open>
<summary><strong>Purpose</strong></summary>

Provides a lightweight browser-based interface for navigating shared media and filesystem content.

</details>

<details>
<summary><strong>Files</strong></summary>

- [`docker-compose.yml`](/home/will/westOS/services/filebrowser/docker-compose.yml)

</details>

<details>
<summary><strong>Use</strong></summary>

```bash
cd /home/will/westOS/services/filebrowser
docker compose up -d
docker compose logs -f
```

</details>

<details>
<summary><strong>Notes</strong></summary>

- Uses the migrated database and settings under `data/filebrowser`.

</details>
