#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=false

SOURCE_ROOT="/home/will/homelab"
DEST_ROOT="/home/will/westOS"

if [[ "${DRY_RUN}" == "true" ]]; then
  RSYNC_ARGS=(-av --dry-run)
else
  RSYNC_ARGS=(-av)
fi

log() {
  echo "$1"
}

copy_dir_if_exists() {
  local src="$1"
  local dest="$2"
  shift 2
  local extra_args=("$@")

  if [[ -d "$src" && -d "$dest" ]]; then
    log "[copy] $src -> $dest"
    rsync "${RSYNC_ARGS[@]}" "${extra_args[@]}" "$src"/ "$dest"/
  else
    log "[skip] $src -> $dest"
  fi
}

copy_file_if_exists() {
  local src="$1"
  local dest="$2"

  if [[ -f "$src" && -f "$dest" ]]; then
    log "[copy] $src -> $dest"
    rsync "${RSYNC_ARGS[@]}" "$src" "$dest"
  else
    log "[skip] $src -> $dest"
  fi
}

main() {
  log "[info] DRY_RUN=${DRY_RUN}"
  log "[info] SOURCE_ROOT=${SOURCE_ROOT}"
  log "[info] DEST_ROOT=${DEST_ROOT}"

  copy_dir_if_exists \
    "$SOURCE_ROOT/caddy" \
    "$DEST_ROOT/services/caddy" \
    --exclude=data/caddy/acme/ \
    --exclude=data/caddy/certificates/ \
    --exclude=data/caddy/locks/ \
    --exclude=data/caddy/pki/

  copy_dir_if_exists \
    "$SOURCE_ROOT/ai-gateway" \
    "$DEST_ROOT/services/ai-gateway"

  copy_dir_if_exists \
    "$SOURCE_ROOT/flask" \
    "$DEST_ROOT/services/lify/backend"

  copy_dir_if_exists \
    "$SOURCE_ROOT/portainer" \
    "$DEST_ROOT/services/portainer" \
    --exclude=data/tls/

  copy_dir_if_exists \
    "$SOURCE_ROOT/homeassistant/config" \
    "$DEST_ROOT/data/homeassistant" \
    --exclude=.ha_run.lock \
    --exclude=home-assistant.log \
    --exclude=home-assistant.log.* \
    --exclude=home-assistant_v2.db \
    --exclude=home-assistant_v2.db-* \
    --exclude=deps/ \
    --exclude=tts/

  copy_dir_if_exists \
    "$SOURCE_ROOT/plex/config" \
    "$DEST_ROOT/data/plex" \
    --exclude=Library/Application\ Support/Plex\ Media\ Server/Cache/ \
    --exclude=Library/Application\ Support/Plex\ Media\ Server/Codecs/ \
    --exclude=Library/Application\ Support/Plex\ Media\ Server/Crash\ Reports/ \
    --exclude=Library/Application\ Support/Plex\ Media\ Server/Diagnostics/ \
    --exclude=Library/Application\ Support/Plex\ Media\ Server/Logs/ \
    --exclude=Library/Application\ Support/Plex\ Media\ Server/Media/ \
    --exclude=Library/Application\ Support/Plex\ Media\ Server/Metadata/ \
    --exclude=Library/Application\ Support/Plex\ Media\ Server/Plug-in\ Support/Caches/ \
    --exclude=Library/Application\ Support/Plex\ Media\ Server/Plug-in\ Support/Databases/ \
    --exclude=Library/Application\ Support/Plex\ Media\ Server/Updates/

  copy_dir_if_exists \
    "$SOURCE_ROOT/dashy" \
    "$DEST_ROOT/services/dashy"

  copy_dir_if_exists \
    "$SOURCE_ROOT/samba" \
    "$DEST_ROOT/data/samba"

  copy_file_if_exists "$SOURCE_ROOT/docker-compose.yml" "$DEST_ROOT/docker-compose.yml"
  copy_dir_if_exists "$SOURCE_ROOT/backups" "$DEST_ROOT/backups"
  copy_dir_if_exists "$SOURCE_ROOT/shared" "$DEST_ROOT/shared"

  log "[done] migration pass complete"
}

main "$@"
