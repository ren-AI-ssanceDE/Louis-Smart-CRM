#!/bin/sh
# Beispiel-Watchdog (job_type: script oder monitor)
# Hinweis: Stiller Output = keine Aktion. Nur bei (neuem) Output entsteht eine Session.
# Bei job_type 'monitor' wird der Output gehasht — nur Änderungen lösen einen Agent-Lauf aus.
THRESHOLD=10
USED=$(df -P /app/data 2>/dev/null | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
if [ -z "$USED" ]; then
  USED=$(df -P /tmp 2>/dev/null | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
fi
if [ -n "$USED" ] && [ "$USED" -gt "$THRESHOLD" ]; then
  echo "ALERT: Speicherplatz ${USED}% auf /data (Schwelle ${THRESHOLD}%)"
fi
