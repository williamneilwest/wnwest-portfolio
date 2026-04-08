# code-server

Browser-based development environment pointed at the host filesystem.

| Item | Value |
| --- | --- |
| Status | active |
| Compose | [`docker-compose.yml`](/home/will/westOS/services/code-server/docker-compose.yml) |
| Network | `westOS` |
| Route | `code.wnwest.com` |
| Host Bind | `/home/will -> /home/coder/project` |

<details open>
<summary><strong>Purpose</strong></summary>

Provides a browser-accessible workspace for editing and operating directly against the host machine.

</details>

<details>
<summary><strong>Files</strong></summary>

- [`docker-compose.yml`](/home/will/westOS/services/code-server/docker-compose.yml)

</details>

<details>
<summary><strong>Use</strong></summary>

```bash
cd /home/will/westOS/services/code-server
docker compose up -d
docker compose logs -f
```

</details>

<details>
<summary><strong>Notes</strong></summary>

- The login password is sourced from `CODE_SERVER_PASSWORD`.

</details>
