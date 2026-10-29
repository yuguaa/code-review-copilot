set -eu

deployment_root=${1:?需要指定部署目录}
public_url=${2:?需要指定公开地址}
cd "$deployment_root"
umask 077
mkdir -p .deployment
docker inspect code-review-copilot-app --format "{{json .Config.Env}}" > .deployment/legacy-env.json
node scripts/prepare-remote-env.mjs .deployment/legacy-env.json .env "$public_url"

compose() {
  docker compose --env-file .env -p code-review-copilot-platform -f docker-compose.yml -f deploy/compose-remote.yml "$@"
}

compose exec -T postgres psql -U code_review -d code_review_copilot -At -v ON_ERROR_STOP=1 < deploy/dingtalk-before-migration.sql > .deployment/configuration-before.txt
compose exec -T postgres pg_dump -U code_review -d code_review_copilot -Fc \
  -t gitlab_accounts -t ai_models -t repositories -t notification_settings -t rss_subscriptions -t rss_pushed_items > .deployment/configuration-before.dump
test -s .deployment/configuration-before.dump

compose build --pull app collector tempo
compose pull postgres grafana prometheus
compose up -d --wait --wait-timeout 240

compose exec -T postgres psql -U code_review -d code_review_copilot -At -v ON_ERROR_STOP=1 < deploy/dingtalk-after-migration.sql > .deployment/configuration-after.txt
diff -u .deployment/configuration-before.txt .deployment/configuration-after.txt
compose ps
