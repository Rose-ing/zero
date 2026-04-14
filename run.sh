#!/usr/bin/env bash
# Levanta Zero en localhost:8080
# Uso: ./run.sh

set -e

# Asegura que Go esté en el PATH (Homebrew)
export PATH="/opt/homebrew/bin:$PATH"

# Carga variables del .env
if [ ! -f .env ]; then
  echo "❌ Falta el archivo .env. Copiá .env.example a .env y completá las keys."
  exit 1
fi

set -a
source .env
set +a

echo "🚀 Levantando Zero en http://localhost:${PORT:-8080}"
go run .
