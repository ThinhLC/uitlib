#!/usr/bin/env bash
# Render the ERDs for the report (tasks T078):
#   docs/erd/conceptual.puml (+ generated views) → docs/report/erd-conceptual*.{svg,png}  (PlantUML)
#   docs/erd/relational.mmd                       → docs/report/erd-relational.{svg,png}  (Mermaid CLI)
# Both renderers run in Docker, so nothing extra is installed locally.
set -euo pipefail
cd "$(dirname "$0")/../.."

pnpm exec tsx scripts/erd/chen-views.ts
mkdir -p docs/report
docker run --rm -e PLANTUML_LIMIT_SIZE=32768 -v "$PWD/docs:/work" plantuml/plantuml -tsvg -o /work/report \
  /work/erd/conceptual.puml /work/erd/views/overview.puml /work/erd/views/catalog.puml \
  /work/erd/views/people.puml /work/erd/views/circulation.puml /work/erd/views/money.puml
docker run --rm -e PLANTUML_LIMIT_SIZE=32768 -v "$PWD/docs:/work" plantuml/plantuml -tpng -o /work/report \
  /work/erd/conceptual.puml /work/erd/views/overview.puml /work/erd/views/catalog.puml \
  /work/erd/views/people.puml /work/erd/views/circulation.puml /work/erd/views/money.puml
for f in conceptual overview catalog people circulation money; do
  for ext in svg png; do
    [ -f "docs/report/$f.$ext" ] && mv -f "docs/report/$f.$ext" "docs/report/erd-conceptual-$f.$ext"
  done
done

for ext in svg png; do
  docker run --rm -u "$(id -u):$(id -g)" -v "$PWD/docs:/data" minlag/mermaid-cli \
    -i /data/erd/relational.mmd -o "/data/report/erd-relational.$ext" -w 4000 -b white
done
echo "rendered docs/report/erd-*.{svg,png}"
