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

command -v curl >/dev/null || { echo 'curl ausente'; exit 1; }
command -v tar >/dev/null || { echo 'tar ausente'; exit 1; }

case "$(uname -m)" in
  x86_64|amd64) RUNNER_ARCH=x64 ;;
  aarch64|arm64) RUNNER_ARCH=arm64 ;;
  *) echo "Arquitetura não suportada: $(uname -m)"; exit 1 ;;
esac

mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

if [ ! -x ./config.sh ]; then
  echo 'Baixando GitHub Actions Runner oficial mais recente...'
  VERSION="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | sed -n 's/.*"tag_name": "v\([^"]*\)".*/\1/p' | head -n1)"
  [ -n "$VERSION" ] || { echo 'Não foi possível descobrir a versão do runner.'; exit 1; }
  ARCHIVE="actions-runner-linux-${RUNNER_ARCH}-${VERSION}.tar.gz"
  curl -fL "https://github.com/actions/runner/releases/download/v${VERSION}/${ARCHIVE}" -o "$ARCHIVE"
  tar xzf "$ARCHIVE"
  rm -f "$ARCHIVE"
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
  ./svc.sh status || true
else
  echo 'Runner registrado. Inicie com ./run.sh.'
fi
