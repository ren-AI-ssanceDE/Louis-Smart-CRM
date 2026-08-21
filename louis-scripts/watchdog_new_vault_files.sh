#!/bin/sh
# Watchdog (stündlich): Neue Dateien in der Wissensdatenbank seit 24 h.
# Stiller Output, wenn nichts Neues — nur bei neuen Dateien entsteht eine Session.
VAULT="/app/knowledge_data_vault"
[ -d "$VAULT" ] || exit 0
NEW=$(find "$VAULT" -type f -mtime -1 2>/dev/null | wc -l)
if [ "$NEW" -gt 0 ]; then
  echo "WISSENSBANK: ${NEW} neue Datei(en) in den letzten 24 h im Vault"
fi
