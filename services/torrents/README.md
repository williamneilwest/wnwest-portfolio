# torrents

VPN-backed download stack made up of `gluetun` and `qbittorrent`.

| Item | Value |
| --- | --- |
| Status | active |
| Compose | [`docker-compose.yml`](/home/will/westOS/services/torrents/docker-compose.yml) |
| Public Ports | `8085`, `6881/tcp`, `6881/udp` |
| Route | `torrent.wnwest.com` |
| Data | [`/home/will/westOS/data/torrents`](/home/will/westOS/data/torrents) |

<details open>
<summary><strong>Purpose</strong></summary>

Runs the torrent stack behind `gluetun`, with `qbittorrent` sharing the VPN network path.

</details>

<details>
<summary><strong>Files</strong></summary>

- [`docker-compose.yml`](/home/will/westOS/services/torrents/docker-compose.yml)

</details>

<details>
<summary><strong>Use</strong></summary>

```bash
cd /home/will/westOS/services/torrents
docker compose up -d
docker compose logs -f
```

</details>

<details>
<summary><strong>Notes</strong></summary>

- `gluetun` owns the network path.
- `qbittorrent` runs with `network_mode: service:gluetun`.

</details>
