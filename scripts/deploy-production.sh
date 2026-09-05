#!/usr/bin/env bash

# Frontend-only controller. Never call a backend/infra deployment workflow.
# --preflight is non-live; --prepare builds/probes without switching traffic.
# --deploy additionally requires the reviewed CRM DNS/TLS and Nginx artifact.
set -euo pipefail
umask 077

die() { printf '%s\n' "$1" >&2; exit 1; }
mode="${1:---preflight}"
[[ "$#" -le 1 ]] || die 'Unexpected controller arguments.'
case "$mode" in --preflight|--prepare|--deploy) ;; *) die 'Unknown controller mode.' ;; esac
[[ "$(id -u)" == 0 ]] || die 'The frontend controller requires root.'

readonly app_root=/opt/winwidget
readonly state_root="$app_root/deploy/frontend"
readonly env_file="$state_root/.env.production"
readonly assets_root="$state_root/assets"
readonly nginx_target=/etc/nginx/sites-available/winwidget.ru
readonly nginx_link=/etc/nginx/sites-enabled/winwidget.ru
readonly nginx_lock=/run/lock/winwidget-frontend-nginx.lock
readonly legacy_revision=e9b87de858c565ca346dac3c6de166e6c3eeb880
readonly legacy_nginx_sha=fac90fc182f5cf9a73975c8d8af81e54266c55a4b37b838c825f4179647b8b3f
readonly apps=(landing crm widgets admin-panel)
declare -A ports=([landing]=3000 [crm]=3001 [widgets]=3002 [admin-panel]=3003)
declare -A images=() old_ids=() old_images=() old_revisions=() candidate_ids=()

revision="${EXPECTED_REVISION:-}"
infra_revision="${FRONTEND_PRODUCTION_INFRA_REVISION:-}"
nginx_sha="${FRONTEND_PRODUCTION_NGINX_SHA256:-}"
env_sha="${FRONTEND_PRODUCTION_ENV_SHA256:-}"
[[ "$revision" =~ ^[a-f0-9]{40}$ && "$infra_revision" =~ ^[a-f0-9]{40}$ &&
	"$nginx_sha" =~ ^[a-f0-9]{64}$ && "$env_sha" =~ ^[a-f0-9]{64}$ ]] ||
	die 'Exact source, infra, Nginx and synchronized env hashes are required.'
if [[ "$mode" != --preflight ]]; then
	[[ "${VERIFIED_CI_REVISION:-}" == "$revision" && "${VERIFIED_CI_RUN_ID:-}" =~ ^[1-9][0-9]*$ ]] ||
		die 'Only the exact revision admitted by the frontend CI gate may be prepared.'
fi
client_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
case "$client_root" in "$app_root/winwidget.ru_client"|"$app_root/winwidget.ru_frontends") ;; *) die 'Unreviewed frontend checkout path.' ;; esac
readonly compose_file="$client_root/deploy/docker-compose.prod.yml"
readonly asset_helper="$client_root/scripts/frontend-static-assets.mjs"
readonly artifact="$state_root/artifacts/$infra_revision/frontend.conf"
readonly release_root="$state_root/releases/$revision"
readonly project="winwidget-frontends-$revision"
readonly candidate_project="winwidget-candidate-$revision"

for command in docker git sha256sum stat realpath awk grep sed sort flock curl nginx systemctl getent openssl df sync; do
	command -v "$command" >/dev/null 2>&1 || die 'A required frontend deployment tool is unavailable.'
done
[[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] || die 'Ambient Docker routing is not allowed.'
[[ "$(docker context inspect --format '{{.Endpoints.docker.Host}}')" == unix:///var/run/docker.sock ]] ||
	die 'Frontend Docker must use the reviewed local VPS daemon.'
docker buildx version >/dev/null 2>&1 || die 'Docker Buildx is required; legacy builder fallback is forbidden.'
docker compose version >/dev/null 2>&1 || die 'Docker Compose v2 is required.'
[[ "$(uname -m)" == x86_64 ]] || die 'Unreviewed frontend VPS architecture.'

directory() {
	local target="$1" permissions
	[[ -d "$target" && ! -L "$target" && "$(realpath -e "$target")" == "$target" &&
		"$(stat -c '%u:%g' "$target")" == 0:0 ]] || die 'Unsafe frontend directory metadata.'
	permissions="$(stat -c '%a' "$target")"
	if [[ ! "$permissions" =~ ^[0-7]{3,4}$ ]] || (( (8#$permissions & 8#022) != 0 )); then
		die 'Frontend directories must not be group/world writable.'
	fi
}
regular() {
	local target="$1" permissions="$2"
	[[ -f "$target" && ! -L "$target" && "$(realpath -e "$target")" == "$target" &&
		"$(stat -c '%u:%g:%a:%h' "$target")" == "0:0:$permissions:1" ]] ||
		die 'Unsafe frontend file metadata.'
}
create_directory() { [[ -e "$1" ]] || mkdir -m "$2" "$1"; directory "$1"; }
for target in "$app_root" "$app_root/deploy" "$state_root" "$client_root" /etc/nginx /etc/nginx/sites-available /etc/nginx/sites-enabled; do directory "$target"; done
[[ -d /run/lock && ! -L /run/lock && "$(realpath -e /run/lock)" == /run/lock &&
	"$(stat -c '%u:%g:%a' /run/lock)" == 0:0:1777 ]] || die 'Frontend lock directory differs from the reviewed sticky root-owned directory.'
regular "$env_file" 600
[[ "$(sha256sum "$env_file" | awk '{print $1}')" == "$env_sha" ]] || die 'Frontend env no longer matches the synchronized release hash.'
[[ "$(git -C "$client_root" rev-parse HEAD)" == "$revision" && "$(git -C "$client_root" branch --show-current)" == prod ]] ||
	die 'The production checkout is not the exact admitted revision.'
[[ -z "$(git -C "$client_root" status --porcelain --untracked-files=all)" ]] || die 'The frontend production checkout is not clean.'
for target in "$compose_file" "$asset_helper"; do [[ -f "$target" && ! -L "$target" ]] || die 'A tracked frontend release artifact is missing.'; done
regular "$artifact" 644
[[ "$(sha256sum "$artifact" | awk '{print $1}')" == "$nginx_sha" ]] || die 'Pinned frontend Nginx artifact hash differs.'
regular "$nginx_target" 644
[[ -L "$nginx_link" && "$(readlink "$nginx_link")" == "$nginx_target" ]] || die 'Unexpected frontend Nginx enabled target.'
systemctl is-active --quiet nginx || die 'Frontend Nginx is not active.'
nginx -t >/dev/null 2>&1 || die 'The existing frontend Nginx configuration is invalid.'

[[ ! -L "$nginx_lock" && (! -e "$nginx_lock" || -f "$nginx_lock") ]] || die 'Unsafe frontend deployment lock.'
if [[ "${FRONTEND_DEPLOY_LOCK_FD:-}" == 9 ]]; then
	[[ "$(readlink /proc/self/fd/9)" == "$nginx_lock" &&
		"$(stat -Lc '%d:%i' /proc/self/fd/9)" == "$(stat -c '%d:%i' "$nginx_lock")" ]] || die 'Inherited frontend lock identity is invalid.'
	lock_fd=9
else
	[[ -z "${FRONTEND_DEPLOY_LOCK_FD:-}" ]] || die 'Unsupported inherited frontend lock descriptor.'
	if [[ ! -e "$nginx_lock" ]]; then (set -o noclobber; : >"$nginx_lock") 2>/dev/null || true; fi
	regular "$nginx_lock" 600
	exec {lock_fd}<>"$nginx_lock"
	[[ "$(stat -Lc '%d:%i' "/proc/self/fd/$lock_fd")" == "$(stat -c '%d:%i' "$nginx_lock")" ]] || die 'Frontend lock inode changed during acquisition.'
fi
regular "$nginx_lock" 600
flock -n "$lock_fd" || die 'Another frontend/Nginx deployment holds the lock.'
[[ "$(git -C "$client_root" rev-parse HEAD)" == "$revision" && -z "$(git -C "$client_root" status --porcelain --untracked-files=all)" &&
	"$(sha256sum "$env_file" | awk '{print $1}')" == "$env_sha" ]] || die 'Release inputs changed before acquisition of the frontend lock.'

# Reject dotenv ambiguity without printing values or evaluating shell input.
awk '
	/^[[:space:]]*(#|$)/ { next }
	{ if ($0 !~ /^[A-Za-z_][A-Za-z0-9_]*=/) exit 1; key=$0; sub(/=.*/, "", key); if (++seen[key]>1) exit 1 }
' "$env_file" || die 'Frontend env contains duplicate or unsupported assignments.'
while IFS= read -r key; do
	[[ "$key" == APP_REVISION ]] && continue
	if printenv "$key" >/dev/null 2>&1; then die 'An ambient variable would override the synchronized frontend env.'; fi
done < <(grep -oE '\$\{[A-Za-z_][A-Za-z0-9_]*' "$compose_file" | sed 's/^${//' | sort -u)
export APP_REVISION="$revision"
compose() { docker compose --project-name "$project" --env-file "$env_file" -f "$compose_file" "$@"; }
candidate_compose() { docker compose --project-name "$candidate_project" --env-file "$env_file" -f "$compose_file" "$@"; }
compose config --quiet >/dev/null 2>&1 || die 'Frontend Compose validation failed.'

prior_revision=legacy
if [[ -e "$state_root/current-revision" ]]; then
	regular "$state_root/current-revision" 600
	prior_revision="$(<"$state_root/current-revision")"
	[[ "$prior_revision" =~ ^[a-f0-9]{40}$ ]] || die 'Invalid prior frontend release pointer.'
	regular "$state_root/releases/$prior_revision/containers" 600
	while read -r app cid image extra; do
		case "$app" in landing|crm|widgets|admin-panel) ;; *) die 'Unexpected prior frontend inventory member.' ;; esac
		[[ -z "${old_ids[$app]:-}" && "$cid" =~ ^[a-f0-9]{64}$ &&
			"$image" =~ ^sha256:[a-f0-9]{64}$ && -z "${extra:-}" ]] || die 'Invalid prior frontend inventory.'
		old_ids[$app]="$cid"; old_images[$app]="$image"; old_revisions[$app]="$prior_revision"
	done <"$state_root/releases/$prior_revision/containers"
	[[ "${#old_ids[@]}" == 4 ]] || die 'The prior frontend inventory is incomplete.'
	regular "$state_root/releases/$prior_revision/binding" 600
	read -r prior_source prior_env prior_infra prior_nginx extra <"$state_root/releases/$prior_revision/binding"
	[[ "$prior_source" == "$prior_revision" && "$prior_env" =~ ^[a-f0-9]{64}$ && "$prior_infra" =~ ^[a-f0-9]{40}$ &&
		"$prior_nginx" =~ ^[a-f0-9]{64}$ && -z "${extra:-}" && "$(sha256sum "$nginx_target" | awk '{print $1}')" == "$prior_nginx" ]] || die 'Live Nginx drifted from the previous immutable frontend release.'
else
	[[ "$(sha256sum "$nginx_target" | awk '{print $1}')" == "$legacy_nginx_sha" ]] || die 'Initial frontend cutover no longer matches the reviewed legacy Nginx.'
	cid="$(docker inspect --format '{{.Id}}' winwidget-client-1 2>/dev/null)" || die 'The reviewed legacy frontend container is unavailable.'
	[[ "$cid" =~ ^ce9b022ba282[a-f0-9]{52}$ ]] || die 'Legacy frontend container identity changed after review.'
	old_ids[landing]="$cid"
	old_images[landing]="$(docker inspect --format '{{.Image}}' "$cid")"
	[[ "${old_images[landing]}" == sha256:d28d1a696b7d8a5de242eee93cde55d5dd7332312c2393092bce38a339e3fda1 ]] || die 'Legacy frontend image differs from the reviewed immutable image.'
	old_revisions[landing]="$legacy_revision"
fi
validator_image="${old_images[landing]}"
[[ "$validator_image" =~ ^sha256:[a-f0-9]{64}$ ]] || die 'The prior frontend image identity is invalid.'
node_validate() { docker run --rm -i --network none --read-only --cap-drop ALL --security-opt no-new-privileges --entrypoint node "$validator_image" -e "try { $1 } catch { process.exit(1) }"; }

for app in "${!old_ids[@]}"; do
	cid="${old_ids[$app]}"
	[[ "$(docker inspect --format '{{.Image}}' "$cid")" == "${old_images[$app]}" &&
		"$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$cid")" == "${old_revisions[$app]}" &&
		"$(docker inspect --format '{{.State.Running}}' "$cid")" == true ]] || die 'Prior frontend runtime identity/state changed.'
	docker inspect "$cid" | node_validate "
		const [c]=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
		const p=c.HostConfig.PortBindings;
		if(Object.keys(p).length!==1 || p['3000/tcp']?.length!==1 || p['3000/tcp'][0].HostIp!=='127.0.0.1' || p['3000/tcp'][0].HostPort!=='${ports[$app]}')process.exit(1);
	" || die 'A prior frontend port is not the exact loopback binding.'
done

# JavaScript template literals must stay literal.
# shellcheck disable=SC2016
compose config --format json 2>/dev/null | node_validate '
	const fs=require("node:fs"); const c=JSON.parse(fs.readFileSync(0,"utf8"));
	const fail=()=>process.exit(1); const apps={landing:3000,crm:3001,widgets:3002,"admin-panel":3003};
	if(JSON.stringify(Object.keys(c.services??{}).sort())!==JSON.stringify(Object.keys(apps).sort()))fail();
	const base=["HOSTNAME","NEXT_TELEMETRY_DISABLED","NODE_ENV","PORT"];
	const auth=["JWT_AUDIENCE","JWT_CLOCK_TOLERANCE_SECONDS","JWT_ISSUER","JWT_JWKS_URL","JWT_MAX_TOKEN_LIFETIME_SECONDS"];
	for(const [app,port] of Object.entries(apps)){
		const s=c.services[app], e=s.environment??{}, a=s.build?.args??{};
		if(s.container_name || s.depends_on || s.volumes || s.privileged || s.network_mode)fail();
		const keys=(app==="widgets"||app==="admin-panel")?[...base,...auth]:base;
		if(JSON.stringify(Object.keys(e).sort())!==JSON.stringify([...keys].sort()))fail();
		if(e.NODE_ENV!=="production"||String(e.PORT)!=="3000"||e.HOSTNAME!=="0.0.0.0")fail();
		if(keys.length>base.length && (e.JWT_JWKS_URL!=="https://api.winwidget.ru/api/v1/auth/.well-known/jwks.json" || e.JWT_ISSUER!=="https://api.winwidget.ru/auth" || e.JWT_AUDIENCE!=="https://api.winwidget.ru" || String(e.JWT_MAX_TOKEN_LIFETIME_SECONDS)!=="900" || !/^\d{1,2}$/.test(String(e.JWT_CLOCK_TOLERANCE_SECONDS)) || Number(e.JWT_CLOCK_TOLERANCE_SECONDS)>60))fail();
		if(a.FRONTEND_APP!==app || !/^[a-f0-9]{40}$/.test(a.APP_REVISION) || s.image!==`winwidget-${app}:git-${a.APP_REVISION}` || a.NEXT_PUBLIC_WINCRM_ENABLED!=="false" || a.NEXT_PUBLIC_WINCRM_BILLING_ENABLED!=="false")fail();
		const fixed={NEXT_PUBLIC_MODE:"production",NEXT_PUBLIC_SITE_URL:"https://winwidget.ru",NEXT_PUBLIC_PRODUCTION_HOST:"https://api.winwidget.ru",NEXT_PUBLIC_WIDGETS_HOST:"",NEXT_PUBLIC_API_URL:"https://api.winwidget.ru/api/v1",NEXT_PUBLIC_RECAPTCHA_HOST:"https://www.recaptcha.net",NEXT_PUBLIC_APP_URL:"https://crm.winwidget.ru",NEXT_PUBLIC_MAIN_APP_URL:"https://winwidget.ru"};
		for(const[k,v]of Object.entries(fixed))if(a[k]!==v)fail();
		if(typeof a.NEXT_PUBLIC_RECAPTCHA_SITE_KEY!=="string"||!a.NEXT_PUBLIC_RECAPTCHA_SITE_KEY||/^(change_me|ci-placeholder)/.test(a.NEXT_PUBLIC_RECAPTCHA_SITE_KEY))fail();
		const allowed=[...Object.keys(fixed),"APP_REVISION","FRONTEND_APP","NEXT_PUBLIC_RECAPTCHA_SITE_KEY","NEXT_PUBLIC_WINCRM_ENABLED","NEXT_PUBLIC_WINCRM_BILLING_ENABLED"];
		if(JSON.stringify(Object.keys(a).sort())!==JSON.stringify(allowed.sort()))fail();
		if(s.ports?.length!==1||s.ports[0].host_ip!=="127.0.0.1"||String(s.ports[0].published)!==String(port)||s.ports[0].target!==3000)fail();
	}
' || die 'Frontend-only Compose/build/runtime contract was rejected.'

crm_tls_ready() {
	local addresses
	addresses="$(getent ahostsv4 crm.winwidget.ru 2>/dev/null | awk '{print $1}' | sort -u)" || return 1
	[[ "$addresses" == 82.146.45.119 ]] || return 1
	[[ -f /etc/letsencrypt/live/crm.winwidget.ru/fullchain.pem && -f /etc/letsencrypt/live/crm.winwidget.ru/privkey.pem ]] || return 1
	openssl x509 -in /etc/letsencrypt/live/crm.winwidget.ru/fullchain.pem -noout -checkhost crm.winwidget.ru >/dev/null 2>&1 || return 1
	openssl x509 -in /etc/letsencrypt/live/crm.winwidget.ru/fullchain.pem -noout -checkend 86400 >/dev/null 2>&1
}
if [[ "$mode" == --preflight ]]; then
	printf 'Frontend preflight passed; source=%s\n' "$revision"
	crm_tls_ready || printf '%s\n' 'Cutover remains blocked: CRM DNS/TLS is not ready.'
	exit 0
fi

create_directory "$state_root/releases" 700
create_directory "$release_root" 700
create_directory "$assets_root" 755
# Nginx alias access requires traversal; do not silently chmod existing parents.
for target in "$app_root" "$app_root/deploy" "$state_root" "$assets_root"; do
	permissions="$(stat -c '%a' "$target")"
	(( (8#$permissions & 8#001) != 0 )) || die 'Approved public asset parents are not traversable by Nginx.'
done
release_binding="$revision $env_sha $infra_revision $nginx_sha"
if [[ -e "$release_root/binding" ]]; then
	regular "$release_root/binding" 600
	[[ "$(<"$release_root/binding")" == "$release_binding" ]] || die 'Immutable release inputs changed; use a newly verified revision.'
else printf '%s\n' "$release_binding" >"$release_root/binding"; fi
if [[ "$prior_revision" == "$revision" ]]; then
	die 'This revision is already live; use the health verification workflow, not another cutover.'
fi

cutover_started=false
completed=false
current_pointer_written=false
cleanup() {
	local status=$? app cid rollback_ok=true cleanup_failed=false networks
	trap - EXIT
	# A repeated SSH disconnect/termination must not interrupt an in-progress rollback.
	trap '' INT TERM HUP
	set +e
	if [[ "$cutover_started" == true && "$completed" != true ]]; then
		for app in "${apps[@]}"; do
			cid="$(compose ps --all -q "$app" 2>/dev/null || true)"
			if [[ "$cid" =~ ^[a-f0-9]{64}$ ]]; then docker stop "$cid" >/dev/null 2>&1 || rollback_ok=false; fi
		 done
		for app in "${!old_ids[@]}"; do docker start "${old_ids[$app]}" >/dev/null 2>&1 || rollback_ok=false; done
		if [[ -f "$release_root/nginx.before" ]]; then
			local restore
			restore="$(mktemp /etc/nginx/sites-available/.winwidget-rollback.XXXXXX)"
			if ! { cp "$release_root/nginx.before" "$restore" && chmod 644 "$restore" && mv -f "$restore" "$nginx_target" && nginx -t >/dev/null 2>&1 && systemctl reload nginx; }; then rollback_ok=false; fi
		fi
		if [[ "$current_pointer_written" == true ]]; then
			if [[ "$prior_revision" == legacy ]]; then
				mv "$state_root/current-revision" "$release_root/failed-current-revision" || rollback_ok=false
			else
				local previous_pointer
				previous_pointer="$(mktemp "$state_root/.rollback-revision.XXXXXX")"
				if ! { printf '%s\n' "$prior_revision" >"$previous_pointer" && mv -f "$previous_pointer" "$state_root/current-revision"; }; then rollback_ok=false; fi
			fi
		fi
		for app in "${!old_ids[@]}"; do
			if [[ "$prior_revision" == legacy ]]; then
				curl --fail --silent --max-time 15 http://127.0.0.1:3000/ >/dev/null 2>&1 || rollback_ok=false
			else probe "$app" "${ports[$app]}" "${old_revisions[$app]}" || rollback_ok=false; fi
		 done
		if [[ "$rollback_ok" == true ]]; then printf '%s\n' 'Previous frontend containers and Nginx configuration restored.' >&2
		else printf '%s\n' 'CRITICAL: frontend rollback requires operator recovery; preserved releases were not deleted.' >&2; fi
		status=1
	fi
	for app in "${!candidate_ids[@]}"; do
		cid="${candidate_ids[$app]}"
		if [[ "$cid" =~ ^[a-f0-9]{64}$ && "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$cid" 2>/dev/null || true)" == "$candidate_project" ]]; then
			docker rm -f "$cid" >/dev/null 2>&1 || cleanup_failed=true
		fi
	done
	networks="$(docker network ls --filter "label=com.docker.compose.project=$candidate_project" --quiet)" || cleanup_failed=true
	while IFS= read -r network; do
		[[ "$network" =~ ^[a-f0-9]{12,64}$ ]] || continue
		if [[ "$(docker network inspect --format '{{index .Labels "com.docker.compose.project"}}' "$network" 2>/dev/null)" == "$candidate_project" &&
			"$(docker network inspect --format '{{len .Containers}}' "$network" 2>/dev/null)" == 0 ]]; then
			docker network rm "$network" >/dev/null 2>&1 || cleanup_failed=true
		else cleanup_failed=true; fi
	done <<<"$networks"
	if [[ "$cleanup_failed" == true ]]; then
		printf '%s\n' 'Candidate cleanup incomplete; inspect the exact candidate project. Old/release resources were not removed.' >&2
		status=1
	fi
	exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

probe() {
	local app="$1" port="$2" expected="$3" attempt
	for ((attempt=1; attempt<=30; attempt++)); do
		if docker run --rm --network host --read-only --cap-drop ALL --security-opt no-new-privileges --entrypoint node "$validator_image" -e '
			(async()=>{try{const [app,port,revision]=process.argv.slice(1); if(!/^\d{1,5}$/.test(port))process.exit(1);
			const r=await fetch(`http://127.0.0.1:${port}/__frontend/health`,{redirect:"error",signal:AbortSignal.timeout(3000)});
			const text=await r.text(); if(text.length>256||r.status!==200||r.headers.get("cache-control")!=="no-store")process.exit(1);
			const p=JSON.parse(text); if(Object.keys(p).sort().join()!=="application,revision,status"||p.status!=="ok"||p.application!==app||p.revision!==revision)process.exit(1);
			}catch{process.exit(1)}})();
		' "$app" "$port" "$expected" >/dev/null 2>&1; then return 0; fi
		sleep 2
	done
	return 1
}

assert_release_project_empty() {
	local occupied
	occupied="$(docker ps --all --filter "label=com.docker.compose.project=$project" --quiet)" ||
		die 'The new frontend release inventory could not be checked.'
	[[ -z "$occupied" ]] || die 'The new frontend release project is already occupied; preserved containers require explicit recovery.'
}
assert_release_project_empty

for app in "${apps[@]}"; do
	image="winwidget-$app:git-$revision"
	if docker image inspect "$image" >/dev/null 2>&1; then
		regular "$release_root/$app.image" 600
		[[ "$(docker image inspect --format '{{.Id}}' "$image")" == "$(<"$release_root/$app.image")" ]] || die 'An immutable frontend image tag was changed.'
	else
		available_kib="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
		free_kib="$(df -Pk "$state_root" | awk 'NR==2 {print $4}')"
		if [[ ! "$available_kib" =~ ^[0-9]+$ ]] || ((available_kib < 2 * 1024 * 1024)); then die 'Less than 2 GiB available for a serial frontend build; the live frontend was preserved.'; fi
		if [[ ! "$free_kib" =~ ^[0-9]+$ ]] || ((free_kib < 8 * 1024 * 1024)); then die 'Less than 8 GiB free for frontend image preparation; no automatic cleanup is allowed.'; fi
		compose build "$app" || die 'A frontend image build failed before cutover.'
		docker image inspect --format '{{.Id}}' "$image" >"$release_root/$app.image"
	fi
	images[$app]="$(<"$release_root/$app.image")"
	[[ "${images[$app]}" =~ ^sha256:[a-f0-9]{64}$ &&
		"$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "${images[$app]}")" == "$revision" &&
		"$(docker image inspect --format '{{index .Config.Labels "ru.winwidget.frontend.app"}}' "${images[$app]}")" == "$app" ]] || die 'Built frontend image identity differs.'
	docker run --rm --network none "${images[$app]}" node container-entrypoint.mjs --verify >/dev/null || die 'Standalone frontend packaging verification failed.'
done

# Build all images before starting extra Node runtimes on the small VPS.
for app in "${apps[@]}"; do
	candidate_name="winwidget-candidate-$app-${revision:0:12}"
	if docker inspect "$candidate_name" >/dev/null 2>&1; then die 'A candidate name is already occupied; do not adopt an unknown container.'; fi
	if ! candidate_compose run --no-deps --detach --name "$candidate_name" --publish 127.0.0.1::3000 "$app" >/dev/null; then
		cid="$(docker inspect --format '{{.Id}}' "$candidate_name" 2>/dev/null || true)"
		[[ ! "$cid" =~ ^[a-f0-9]{64}$ ]] || candidate_ids[$app]="$cid"
		die 'A frontend candidate could not start.'
	fi
	cid="$(docker inspect --format '{{.Id}}' "$candidate_name")"
	[[ "$cid" =~ ^[a-f0-9]{64}$ ]] || die 'A candidate returned an invalid container identity.'
	candidate_ids[$app]="$cid"
	[[ "$(docker inspect --format '{{.Image}}' "$cid")" == "${images[$app]}" ]] || die 'Candidate did not start the exact image.'
	binding="$(docker port "$cid" 3000/tcp)"
	[[ "$binding" =~ ^127\.0\.0\.1:([0-9]{1,5})$ ]] || die 'Candidate port is not exclusively loopback.'
	probe "$app" "${BASH_REMATCH[1]}" "$revision" || die 'Candidate own HTTP readiness failed; no live container was stopped.'
done
available_kib="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
if [[ ! "$available_kib" =~ ^[0-9]+$ ]] || ((available_kib < 512 * 1024)); then die 'Insufficient available memory with all candidates running; no live container was stopped.'; fi

create_directory "$release_root/asset-sources" 700
for namespace in legacy "${apps[@]}"; do
	if [[ "$namespace" == legacy ]]; then
		[[ "$prior_revision" == legacy ]] || continue
		cid="${old_ids[landing]}"; source_path=/app/.next/static; source_revision="$legacy_revision"
	else cid="${candidate_ids[$namespace]}"; source_path="/app/apps/$namespace/.next/static"; source_revision="$revision"; fi
	source_directory="$release_root/asset-sources/$namespace"
	source_image="$(docker inspect --format '{{.Image}}' "$cid")"
	if [[ -e "$source_directory" ]]; then
		directory "$source_directory"
		regular "$release_root/asset-sources/$namespace.image" 600
		[[ "$(<"$release_root/asset-sources/$namespace.image")" == "$source_image" ]] || die 'Preserved asset extraction belongs to another image.'
	else
		mkdir -m 700 "$source_directory"
		docker cp "$cid:$source_path/." "$source_directory/" || die 'Exact image static extraction failed.'
		printf '%s\n' "$source_image" >"$release_root/asset-sources/$namespace.image"
	fi
	docker run --rm --network none --read-only --user 0:0 --cap-drop ALL --security-opt no-new-privileges \
		--mount "type=bind,src=$source_directory,dst=/source,readonly" \
		--mount "type=bind,src=$assets_root,dst=/assets" \
		--mount "type=bind,src=$asset_helper,dst=/controller.mjs,readonly" \
		--entrypoint node "$validator_image" /controller.mjs "$namespace" "$source_revision" || die 'Immutable frontend static publication failed.'
done
if [[ "$mode" == --prepare ]]; then
	printf 'All four frontend candidates and immutable assets verified; source=%s; no traffic switched.\n' "$revision"
	exit 0
fi
crm_tls_ready || die 'Cutover blocked: the approved CRM DNS/TLS is not ready; the old frontend remains live.'
[[ "$(sha256sum "$env_file" | awk '{print $1}')" == "$env_sha" && "$(sha256sum "$artifact" | awk '{print $1}')" == "$nginx_sha" ]] || die 'Release inputs changed during preparation.'
printf 'events {}\nhttp { include %s; }\n' "$artifact" >"$release_root/nginx-check.conf"
nginx -t -c "$release_root/nginx-check.conf" >/dev/null 2>&1 || die 'Pinned candidate Nginx/TLS is invalid; no prior frontend was stopped.'

# All four candidates already demonstrated readiness with a 512 MiB reserve.
# Stop them only after immutable asset publication and the DNS/TLS checks;
# do not overlap four candidates with four new live Node runtimes on this VPS.
for app in "${apps[@]}"; do
	cid="${candidate_ids[$app]}"
	[[ "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$cid")" == "$candidate_project" &&
		"$(docker inspect --format '{{.Image}}' "$cid")" == "${images[$app]}" ]] || die 'Candidate identity changed before controlled shutdown.'
	docker stop "$cid" >/dev/null || die 'A verified candidate could not stop; the old frontend remains live.'
done
available_kib="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
if [[ ! "$available_kib" =~ ^[0-9]+$ ]] || ((available_kib < 512 * 1024)); then die 'Available memory dropped after candidate preparation; the old frontend remains live.'; fi
assert_release_project_empty
cp "$nginx_target" "$release_root/nginx.before"
chmod 600 "$release_root/nginx.before"
cutover_started=true
for app in "${!old_ids[@]}"; do docker stop "${old_ids[$app]}" >/dev/null || die 'Could not stop a reviewed prior frontend container.'; done
compose up --detach --no-build --no-deps "${apps[@]}" || die 'New frontend startup failed; restoring the prior release.'
: >"$release_root/containers"
for app in "${apps[@]}"; do
	cid="$(compose ps -q "$app")"
	[[ "$cid" =~ ^[a-f0-9]{64}$ && "$(docker inspect --format '{{.Image}}' "$cid")" == "${images[$app]}" ]] || die 'New runtime image identity differs.'
	[[ "$(docker port "$cid" 3000/tcp)" == "127.0.0.1:${ports[$app]}" ]] || die 'New runtime is not bound to its exact loopback port.'
	probe "$app" "${ports[$app]}" "$revision" || die 'New frontend own HTTP readiness failed.'
	printf '%s %s %s\n' "$app" "$cid" "${images[$app]}" >>"$release_root/containers"
done
nginx_candidate="$(mktemp /etc/nginx/sites-available/.winwidget-candidate.XXXXXX)"
cp "$artifact" "$nginx_candidate"
chmod 644 "$nginx_candidate"
mv -f "$nginx_candidate" "$nginx_target"
nginx -t >/dev/null 2>&1 || die 'Candidate Nginx syntax check failed; restoring the prior release.'
systemctl reload nginx || die 'Nginx reload failed; restoring the prior release.'
[[ "$(sha256sum "$nginx_target" | awk '{print $1}')" == "$nginx_sha" ]] || die 'Live Nginx artifact does not match its immutable hash.'
for host in winwidget.ru crm.winwidget.ru; do
	public_app=landing
	[[ "$host" != crm.winwidget.ru ]] || public_app=crm
	curl --fail --silent --resolve "$host:443:127.0.0.1" --max-filesize 512 --max-time 15 "https://$host/__frontend/health" |
		node_validate "const p=JSON.parse(require('node:fs').readFileSync(0,'utf8')); if(Object.keys(p).sort().join()!=='application,revision,status'||p.status!=='ok'||p.application!=='$public_app'||p.revision!=='$revision')process.exit(1);" || die 'Public frontend exact application/revision failed after cutover.'
done
pointer="$(mktemp "$state_root/.current-revision.XXXXXX")"
printf '%s\n' "$revision" >"$pointer"
chmod 600 "$pointer"
mv -f "$pointer" "$state_root/current-revision"
current_pointer_written=true
sync -f "$state_root"
completed=true
printf 'Frontend release verified: source=%s infra=%s. Prior images, containers and hashed assets preserved.\n' "$revision" "$infra_revision"
