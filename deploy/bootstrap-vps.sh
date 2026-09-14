#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/mercado/htdocs/mercado.superamplitude.com}"
REPO_URL="https://github.com/superamplitude/Mercado.git"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-3010}"

log(){ printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

command -v git >/dev/null || { echo 'git ausente'; exit 1; }
command -v node >/dev/null || { echo 'Node.js 20+ é necessário'; exit 1; }
command -v npm >/dev/null || { echo 'npm ausente'; exit 1; }

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
[ "$NODE_MAJOR" -ge 20 ] || { echo "Node.js atual: $(node -v). Atualize para 20+"; exit 1; }

log "Preparando diretório $APP_DIR"
mkdir -p "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch --prune origin
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  [ -z "$(ls -A "$APP_DIR" 2>/dev/null)" ] || { echo "Diretório não está vazio e não contém .git: $APP_DIR"; exit 1; }
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
log "Instalando dependências"
npm ci --omit=dev || npm install --omit=dev

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo 'ATENÇÃO: .env criado. Preencha banco, JWT_SECRET e ADMIN_PASSWORD antes de produção.'
fi

mkdir -p /home/mercado/media/products

log "Inicializando banco quando as credenciais estiverem válidas"
if npm run db:init; then
  npm run seed
else
  echo 'Banco ainda não inicializado. Corrija as credenciais de .env e execute npm run db:init && npm run seed.'
fi

if ! command -v pm2 >/dev/null; then
  log "Instalando PM2"
  npm install -g pm2
fi

log "Subindo aplicação"
APP_DIR="$APP_DIR" PORT="$PORT" pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save

log "Teste local"
sleep 2
curl -fsS "http://127.0.0.1:${PORT}/api/health" || { pm2 logs mercado-superamplitude --lines 50 --nostream; exit 1; }

echo
printf '%s\n' '============================================================' ' MERCADO SUPERAMPLITUDE - DEPLOY CONCLUÍDO' " APP_DIR=$APP_DIR" " PORT=$PORT" ' URL=https://mercado.superamplitude.com' ' ADMIN=https://mercado.superamplitude.com/admin' '============================================================'
