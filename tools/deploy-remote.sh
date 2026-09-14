#!/usr/bin/env bash
set -Eeuo pipefail
revision=${1:?Expected commit SHA}
[[ "$revision" =~ ^[a-f0-9]{40}$ ]]
cd /var/www/diagnosty-anketa
exec 9>/var/lock/diagnosty-anketa-deploy.lock
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo 'Server checkout has uncommitted changes.' >&2; exit 1; }
[[ "$(git branch --show-current)" == main ]]
git fetch origin main
[[ "$(git rev-parse origin/main)" == "$revision" ]] || { echo 'origin/main changed; deploy again from its latest revision.' >&2; exit 1; }
previous=$(git rev-parse HEAD)
git merge-base --is-ancestor "$previous" "$revision"
existed=0
pm2 describe diagnosty-anketa >/dev/null 2>&1 && existed=1
if [[ "$existed" == 1 ]]; then
    pm2 jlist | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const p=JSON.parse(s).filter(p=>p.name==="diagnosty-anketa");process.exit(p.length===1&&p[0].pm2_env.pm_cwd===process.cwd()&&p[0].pm2_env.pm_exec_path===process.cwd()+"/tools/serve.cjs"?0:1)})'
fi
if [[ "$existed" == 0 ]] && ss -ltnH 'sport = :4173' | grep -q .; then
    echo 'Port 4173 is occupied by another service.' >&2; exit 1
fi
backup=$(mktemp -d /var/backups/diagnosty-anketa.XXXXXXXX)
nginx_site=/etc/nginx/sites-available/diagnosty-anketa
cp -p "$nginx_site" "$backup/nginx.conf"
printf '%s\n' "$previous" > "$backup/previous-revision"
changed=0
pm2_changed=0
rollback() {
    trap - ERR
    set +e
    echo "Deployment failed. Restoring $previous; backup: $backup" >&2
    if [[ "$changed" == 1 ]]; then
        git reset --hard "$previous"
        if [[ "$pm2_changed" == 1 ]]; then
            if [[ "$existed" == 1 ]]; then
                DEPLOY_REVISION="$previous" pm2 startOrReload ecosystem.config.cjs --only diagnosty-anketa --update-env --silent
            else
                pm2 delete diagnosty-anketa --silent
            fi
        fi
        cp -p "$backup/nginx.conf" "$nginx_site"
        nginx -t && systemctl reload nginx
        pm2 save --silent
    fi
    exit 1
}
trap rollback ERR
git merge --ff-only "$revision"
changed=1
# No runtime npm dependencies: production serves the repository's static assets.
node --check tools/serve.cjs
node --check ecosystem.config.cjs
pm2_changed=1
DEPLOY_REVISION="$revision" pm2 startOrReload ecosystem.config.cjs --only diagnosty-anketa --update-env --silent
healthy=0
for attempt in {1..20}; do
    if curl -fsS --max-time 3 http://127.0.0.1:4173/health | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{const h=JSON.parse(s);process.exit(h.status==="ok"&&h.revision===process.argv[1]?0:1)}catch{process.exit(1)}})' "$revision"; then
        healthy=1; break
    fi
    sleep 1
done
[[ "$healthy" == 1 ]]
cp deploy/nginx.conf "$nginx_site"
nginx -t
systemctl reload nginx
# Nginx reload returns before new workers necessarily accept connections.
healthy=0
for attempt in {1..20}; do
    if curl -fsS --max-time 3 --resolve diagnostika-anketa.monterium-edu.ru:443:127.0.0.1 https://diagnostika-anketa.monterium-edu.ru/health | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{try{process.exit(JSON.parse(s).revision===process.argv[1]?0:1)}catch{process.exit(1)}})' "$revision"; then
        healthy=1; break
    fi
    sleep 1
done
[[ "$healthy" == 1 ]]
curl -fsS --max-time 15 --resolve diagnostika-anketa.monterium-edu.ru:443:127.0.0.1 https://diagnostika-anketa.monterium-edu.ru/index.html | cmp - index.html
pm2 save --silent
trap - ERR
echo "PM2 deployment healthy at $revision. Backup: $backup"
