# jupyter

Notebook environment for experiments, scratch analysis, and data work.

| Item | Value |
| --- | --- |
| Status | active |
| Compose | [`docker-compose.yml`](/home/will/westOS/services/jupyter/docker-compose.yml) |
| Network | `westOS` |
| Port | `8888` |
| Route | `jupyter.wnwest.com` |
| Data | [`/home/will/westOS/data/jupyter`](/home/will/westOS/data/jupyter) |

<details open>
<summary><strong>Purpose</strong></summary>

Provides a notebook workspace for ad hoc analysis and experimentation.

</details>

<details>
<summary><strong>Files</strong></summary>

- [`docker-compose.yml`](/home/will/westOS/services/jupyter/docker-compose.yml)

</details>

<details>
<summary><strong>Use</strong></summary>

```bash
cd /home/will/westOS/services/jupyter
docker compose up -d
docker compose logs -f
```

</details>

<details>
<summary><strong>Notes</strong></summary>

- The access token is sourced from `JUPYTER_TOKEN`.
- Notebook storage is mounted from `data/jupyter/notebooks`.

</details>
