# github-sync

Scheduled repository mirror into the local `/home/will/repos` workspace.

| Item | Value |
| --- | --- |
| Status | active |
| Compose | [`docker-compose.yml`](/home/will/westOS/services/github-sync/docker-compose.yml) |
| Network | `westOS` |
| Host Bind | `/home/will/repos` |
| Mode | scheduled git sync |

<details open>
<summary><strong>Purpose</strong></summary>

Mirrors a configured Git repository into local storage on a repeating sync interval.

</details>

<details>
<summary><strong>Files</strong></summary>

- [`docker-compose.yml`](/home/will/westOS/services/github-sync/docker-compose.yml)

</details>

<details>
<summary><strong>Use</strong></summary>

```bash
cd /home/will/westOS/services/github-sync
docker compose up -d
docker compose logs -f
```

</details>

<details>
<summary><strong>Notes</strong></summary>

- Sync target and branch are configured directly in the compose file.

</details>
