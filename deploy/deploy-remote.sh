set -eu

deployment_root=${1:?需要指定部署目录}
public_url=${2:?需要指定公开地址}
cd "$deployment_root"
umask 077
mkdir -p .deployment
docker inspect code-review-copilot-app --format "{{json .Config.Env}}" > .deployment/legacy-env.json
node scripts/prepare-remote-env.mjs .deployment/legacy-env.json .env "$public_url"

docker exec -i code-review-copilot-postgres psql -U code_review -d code_review_copilot -At -v ON_ERROR_STOP=1 < deploy/dingtalk-before-migration.sql > .deployment/configuration-before.txt
docker exec code-review-copilot-postgres pg_dump -U code_review -d code_review_copilot -Fc \
  -t gitlab_accounts -t ai_models -t repositories -t notification_settings -t rss_subscriptions -t rss_pushed_items > .deployment/configuration-before.dump
test -s .deployment/configuration-before.dump

docker compose --env-file .env -p code-review-copilot-platform -f docker-compose.yml -f deploy/compose-remote.yml build --pull app collector tempo
docker compose --env-file .env -p code-review-copilot-platform -f docker-compose.yml -f deploy/compose-remote.yml pull postgres grafana prometheus
docker stop code-review-copilot-app code-review-copilot-postgres
docker compose --env-file .env -p code-review-copilot-platform -f docker-compose.yml -f deploy/compose-remote.yml up -d --wait --wait-timeout 240

docker compose --env-file .env -p code-review-copilot-platform -f docker-compose.yml -f deploy/compose-remote.yml exec -T postgres psql -U code_review -d code_review_copilot -At -v ON_ERROR_STOP=1 < deploy/dingtalk-after-migration.sql > .deployment/configuration-after.txt
diff -u .deployment/configuration-before.txt .deployment/configuration-after.txt
docker compose --env-file .env -p code-review-copilot-platform -f docker-compose.yml -f deploy/compose-remote.yml ps
