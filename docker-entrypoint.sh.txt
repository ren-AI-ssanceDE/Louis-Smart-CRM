#!/bin/sh
set -e

# Louis Smart CRM — Docker Entrypoint
#
# Resolves permission issues with persistent volumes mounted from the host.
# Supports two modes of operations:
# 1. Standard (Recommended): Container starts as 'root' -> Entrypoint corrects
#    permissions on volume mounts -> Entrypoint drops privileges to user 'app' via 'gosu'.
# 2. Restricted: Container is forced to run entirely as a non-root user 'app' (e.g. K8s)
#    -> Entrypoint gracefully skips chown steps to avoid permission denied errors.

if [ "$(id -u)" = '0' ]; then
    echo "[Entrypoint] Running as root. Ensuring correct permissions for persistent vaults..."
    
    # Ensure directories exist
    mkdir -p /app/companies_data_vault /app/contacts_data_vault
    
    # Change ownership of persistent volume mounts to the non-root 'app' user
    chown -R app:app /app/companies_data_vault /app/contacts_data_vault
    
    echo "[Entrypoint] Permissions corrected. Handing over execution to 'app' user via gosu..."
    exec gosu app "$@"
else
    echo "[Entrypoint] Running as non-root user ($(whoami)). Skipping permission fixes."
    exec "$@"
fi
