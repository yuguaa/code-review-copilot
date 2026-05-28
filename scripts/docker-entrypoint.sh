#!/bin/sh
set -eu

echo "Generating Prisma Client..."
./node_modules/.bin/prisma generate

echo "Running database migrations..."
./node_modules/.bin/prisma migrate deploy

echo "Starting Code Review Copilot..."
exec "$@"
