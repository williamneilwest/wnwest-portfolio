# lify

Primary application stack for `westOS`, combining the backend API and portfolio frontend.

| Item | Value |
| --- | --- |
| Status | active |
| Compose | [`docker-compose.yml`](/home/will/westOS/services/lify/docker-compose.yml) |
| Network | `westOS` |
| Backend Port | `5001 -> 5000` |
| Frontend Port | `3002 -> 80` |
| Routes | `wnwest.com`, `www.wnwest.com`, `life.wnwest.com`, `api.wnwest.com` |

<details open>
<summary><strong>Purpose</strong></summary>

Acts as the main product surface in the repo, with separate backend and frontend containers.

</details>

<details>
<summary><strong>Files</strong></summary>

- [`docker-compose.yml`](/home/will/westOS/services/lify/docker-compose.yml)
- [`backend/`](/home/will/westOS/services/lify/backend)
- [`frontend/`](/home/will/westOS/services/lify/frontend)
- [`db/`](/home/will/westOS/services/lify/db)

</details>

<details>
<summary><strong>Use</strong></summary>

```bash
cd /home/will/westOS/services/lify
docker compose up -d --build
docker compose logs -f
```

</details>

<details>
<summary><strong>Notes</strong></summary>

- `lify` is the backend container.
- `lify-frontend` is the frontend container.

</details>
