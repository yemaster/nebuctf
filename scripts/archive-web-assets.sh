#!/bin/sh
# Run before upgrading an existing installation. Optional arguments are older web images.
set -eu
running=$(docker compose ps -q web)
if [ -z "$running" ]; then
  echo 'No running web service to archive.'
  exit 0
fi
project=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$running")
current=$(docker inspect --format '{{.Image}}' "$running")
volume="${project}_web-assets"
docker volume create --label "com.docker.compose.project=$project" --label com.docker.compose.volume=web-assets "$volume" >/dev/null
stage=$(mktemp -d)
source_container=
destination_container=
cleanup() {
  if [ -n "$source_container" ]; then docker rm -f "$source_container" >/dev/null 2>&1 || true; fi
  if [ -n "$destination_container" ]; then docker rm -f "$destination_container" >/dev/null 2>&1 || true; fi
  rm -rf "$stage"
}
trap cleanup EXIT HUP INT TERM
for image in "$@" "$current"; do
  source_container=$(docker create --network none --entrypoint /bin/true "$image")
  docker cp "$source_container:/usr/share/nginx/html/assets" "$stage/"
  docker cp "$source_container:/usr/share/nginx/html/pdfjs" "$stage/" 2>/dev/null || true
  docker rm "$source_container" >/dev/null
  source_container=
done
destination_container=$(docker create --network none --user 0 --mount "type=volume,source=$volume,target=/var/cache/nebuctf" --entrypoint /bin/sh "$current" -c 'chown -R 101:101 /var/cache/nebuctf && find /var/cache/nebuctf -type f -exec touch {} +')
docker cp "$stage/." "$destination_container:/var/cache/nebuctf/"
docker start -a "$destination_container"
test "$(docker inspect --format '{{.State.ExitCode}}' "$destination_container")" = 0
echo "Archived web assets in $volume"
