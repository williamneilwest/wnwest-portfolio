# barcode-intake

Scanner ingestion service that forwards barcode events into Grocy.

| Item | Value |
| --- | --- |
| Status | active |
| Compose | [`docker-compose.yml`](/home/will/westOS/services/barcode-intake/docker-compose.yml) |
| Network | `westOS` |
| Device | `/dev/input/event13` |
| Upstream | `grocy` |

<details open>
<summary><strong>Purpose</strong></summary>

Reads host input events from a barcode scanner and sends product actions into Grocy.

</details>

<details>
<summary><strong>Files</strong></summary>

- [`docker-compose.yml`](/home/will/westOS/services/barcode-intake/docker-compose.yml)
- [`barcode_listener.py`](/home/will/westOS/services/barcode-intake/barcode_listener.py)
- [`requirements.txt`](/home/will/westOS/services/barcode-intake/requirements.txt)
- [`Dockerfile`](/home/will/westOS/services/barcode-intake/Dockerfile)

</details>

<details>
<summary><strong>Use</strong></summary>

```bash
cd /home/will/westOS/services/barcode-intake
docker compose up -d --build
docker compose logs -f
```

</details>

<details>
<summary><strong>Notes</strong></summary>

- Runs privileged because it consumes host input devices.
- Grocy API settings are supplied through environment variables.

</details>
