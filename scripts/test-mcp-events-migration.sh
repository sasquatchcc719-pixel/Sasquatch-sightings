#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE_CONTAINER="sasquatch-mcp-events-fixture-$$"
FIXTURE_SQL="$REPO_DIR/supabase/tests/mcp_events_fixture.sql"
MIGRATION_SQL="$REPO_DIR/supabase/migrations/20261013155327_add_mcp_events.sql"

cleanup() {
  docker rm -f "$FIXTURE_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --rm -d \
  --name "$FIXTURE_CONTAINER" \
  -e POSTGRES_PASSWORD=postgres \
  postgres:17-alpine >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$FIXTURE_CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$FIXTURE_CONTAINER" pg_isready -U postgres >/dev/null

sed -n '1,/APPLY_MCP_EVENTS_MIGRATION_HERE/p' "$FIXTURE_SQL" |
  docker exec -i "$FIXTURE_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres

docker exec -i "$FIXTURE_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  <"$MIGRATION_SQL"

sed -n '/APPLY_MCP_EVENTS_MIGRATION_HERE/,$p' "$FIXTURE_SQL" |
  sed '1d' |
  docker exec -i "$FIXTURE_CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d postgres
