#!/usr/bin/env bash
set -e

echo "==> Installerer afhængigheder"
npm install --no-audit --no-fund

echo "==> Henter Chromium til Playwright (tager et par minutter første gang)"
npx playwright install --with-deps chromium

if [ ! -f .env ]; then
  cp .env.example .env
  echo "==> .env oprettet ud fra .env.example"
fi

cat <<'MSG'

  Klar. Start med:   npm start
  Åbn derefter fanen "Ports" og klik på port 3000.

  Kilderne står i .env. Uden ændringer kører den på mock-data.
  Til rigtige opslag: sæt CVR_PROVIDER=cvrapi og VAT_PROVIDER=vies,
  og udfyld CVRAPI_USER_AGENT og VIES_REQUESTER_VAT.

MSG
