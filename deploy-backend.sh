#!/usr/bin/env bash
# =====================================================================
# Publica el backend (AppsScript.gs) al proyecto de Apps Script que vive
# dentro del Google Sheet, actualizando la implementación ACTIVA (la misma
# URL que usa index.html en APPS_SCRIPT_URL). Reemplaza el viejo flujo
# manual de copiar/pegar en el editor + "Nueva versión".
#
# Requisitos (una sola vez): `npm i -g @google/clasp` y `clasp login` con la
# cuenta dueña del Sheet (servicios@limpiezatrapo.com). La API de Apps Script
# tiene que estar activada en https://script.google.com/home/usersettings
#
# Uso:
#   ./deploy-backend.sh                       # deploy con descripción por defecto
#   ./deploy-backend.sh "arreglo validación"  # deploy con descripción propia
#
# Tras el deploy, la URL NO cambia. Puede tardar ~15 s en propagar.
# =====================================================================
set -euo pipefail

# Deployment ID de la implementación activa (la de APPS_SCRIPT_URL). Si algún
# día se cambia la implementación, actualizar este ID (clasp list-deployments).
DEPLOY_ID="AKfycbwBxzMn_rTW6DwmdaQWdSra4edDIc9vPOS9zYNgIchgJ5MT5M1HB8IQresJu4_3hukG"
DESC="${1:-deploy backend}"

cd "$(dirname "$0")"

echo "→ Empujando código (clasp push)..."
clasp push -f

echo "→ Actualizando la implementación activa (clasp redeploy)..."
clasp redeploy "$DEPLOY_ID" -d "$DESC"

echo "✅ Backend deployado en la MISMA URL. Puede tardar ~15 s en propagar."
