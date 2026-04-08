# kitchen-ai

Custom Python service for kitchen-related automation and AI workflows.

| Item | Value |
| --- | --- |
| Status | active |
| Compose | [`docker-compose.yml`](/home/will/westOS/services/kitchen-ai/docker-compose.yml) |
| Network | `westOS` |
| Route | `kitchen-ai.wnwest.com` |
| Build | local Docker build |

<details open>
<summary><strong>Purpose</strong></summary>

Hosts custom automation logic for kitchen and household workflows that do not fit a third-party service.

</details>

<details>
<summary><strong>Files</strong></summary>

- [`docker-compose.yml`](/home/will/westOS/services/kitchen-ai/docker-compose.yml)
- [`app.py`](/home/will/westOS/services/kitchen-ai/app.py)
- [`Dockerfile`](/home/will/westOS/services/kitchen-ai/Dockerfile)

</details>

<details>
<summary><strong>Use</strong></summary>

```bash
cd /home/will/westOS/services/kitchen-ai
docker compose up -d --build
docker compose logs -f
```

</details>
