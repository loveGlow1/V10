#!/usr/bin/env bash
# Applies the named migration files to the production database, in order.
#
# Run by .github/workflows/migrations.yml — with the files a merge to main
# ADDED, or with the files named when the workflow is run by hand. Never with
# "everything not yet applied": the live database records its migrations
# under the versions they were applied with, which are not the timestamps in
# these filenames, so a diff of the two would re-run every file there is.
#
# Each file runs in one transaction with its record in
# supabase_migrations.schema_migrations: all of it lands, or none of it does.
# A file whose version or name is already recorded is skipped, so a re-run is
# harmless.
set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is not set. Add it under GitHub → Settings → Secrets and variables → Actions.}"

if [ "$#" -eq 0 ]; then
  echo "No migration files to apply."
  exit 0
fi

for file in "$@"; do
  if [ ! -f "$file" ]; then
    echo "::error::$file does not exist."
    exit 1
  fi
  base=$(basename "$file" .sql)
  version=${base%%_*}
  name=${base#*_}
  if ! [[ "$version" =~ ^[0-9]{14}$ && "$name" =~ ^[a-z0-9_]+$ ]]; then
    echo "::error::$file is not named <14-digit version>_<snake_case_name>.sql"
    exit 1
  fi

  recorded=$(psql "$SUPABASE_DB_URL" -tAX -c "select count(*) from supabase_migrations.schema_migrations where version = '$version' or name = '$name'")
  if [ "$recorded" != "0" ]; then
    echo "Skipped $base: already applied."
    continue
  fi

  echo "Applying $base…"
  psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction \
    -f "$file" \
    -c "insert into supabase_migrations.schema_migrations (version, name, created_by) values ('$version', '$name', 'github-actions')"
  echo "Applied $base."
done
