# openwebui

Chat UI that sits in front of the internal AI gateway.

| Item | Value |
| --- | --- |
| Status | active |
| Compose | [`docker-compose.yml`](/home/will/westOS/services/openwebui/docker-compose.yml) |
| Network | `westOS` |
| Route | `chat.wnwest.com` |
| Data | [`/home/will/westOS/data/openwebui`](/home/will/westOS/data/openwebui) |

<details open>
<summary><strong>Purpose</strong></summary>

Provides a browser chat interface that talks to `ai-gateway` using OpenAI-style API calls.

</details>

<details>
<summary><strong>Files</strong></summary>

- [`docker-compose.yml`](/home/will/westOS/services/openwebui/docker-compose.yml)

</details>

<details>
<summary><strong>Use</strong></summary>

```bash
cd /home/will/westOS/services/openwebui
docker compose up -d
docker compose logs -f
```

</details>

<details>
<summary><strong>Notes</strong></summary>

- Targets `http://ai-gateway:5000` for model API requests.

</details>
