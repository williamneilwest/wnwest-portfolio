# ai-gateway

Internal OpenAI-style gateway for apps inside `westOS`.

| Item | Value |
| --- | --- |
| Status | active |
| Compose | [`docker-compose.yml`](/home/will/westOS/services/ai-gateway/docker-compose.yml) |
| Network | `westOS` |
| Port | `5010 -> 5000` |
| Route | `ai.wnwest.com` |

<details open>
<summary><strong>Purpose</strong></summary>

Flask-based gateway that exposes OpenAI-compatible endpoints for internal clients and services.

</details>

<details>
<summary><strong>Files</strong></summary>

- [`docker-compose.yml`](/home/will/westOS/services/ai-gateway/docker-compose.yml)
- [`app.py`](/home/will/westOS/services/ai-gateway/app.py)
- [`requirements.txt`](/home/will/westOS/services/ai-gateway/requirements.txt)
- [`Dockerfile`](/home/will/westOS/services/ai-gateway/Dockerfile)

</details>

<details>
<summary><strong>Use</strong></summary>

```bash
cd /home/will/westOS/services/ai-gateway
docker compose up -d --build
docker compose logs -f
```

</details>

<details>
<summary><strong>Notes</strong></summary>

- Requires `OPENAI_API_KEY`.
- Internal callers can target `http://ai-gateway:5000`.

</details>
