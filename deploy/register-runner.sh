#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/superamplitude/Mercado}"
RUNNER_DIR="${RUNNER_DIR:-/opt/actions-runner-mercado}"
RUNNER_NAME="${RUNNER_NAME:-mercado-production}"
RUNNER_LABELS="${RUNNER_LABELS:-mercado,production}"

if [ -z "${RUNNER_TOKEN:-}" ]; then
  echo 'Defina RUNNER_TOKEN no ambiente. O token não deve ser salvo em arquivo ou commit.'
  exit 1
fi

mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

if [ ! -x ./config.sh ]; then
  echo 'O pacote oficial GitHub Actions Runner precisa estar extraído neste diretório antes do registro.'
  echo "Diretório esperado: $RUNNER_DIR"
  exit 1
fi

./config.sh \
  --url "$REPO_URL" \
  --token "$RUNNER_TOKEN" \
  --name "$RUNNER_NAME" \
  --labels "$RUNNER_LABELS" \
  --work _work \
  --unattended \
  --replace

if [ -x ./svc.sh ]; then
  ./svc.sh install || true
  ./svc.sh start
else
  echo 'Runner registrado. Inicie com ./run.sh ou configure-o como serviço.'
fi
