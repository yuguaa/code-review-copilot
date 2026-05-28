#!/bin/sh
set -eu

echo "Running database migrations..."
./node_modules/.bin/prisma migrate deploy

echo "Starting Code Review Copilot..."
exec "$@"
