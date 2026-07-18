#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${APPS_SCRIPT_DEPLOYMENT_ID:?APPS_SCRIPT_DEPLOYMENT_ID is required}"
: "${DEPLOY_COMMIT_SHA:?DEPLOY_COMMIT_SHA is required}"
[[ "${DEPLOY_COMMIT_SHA}" =~ ^[0-9a-f]{40}$ ]]

auth_file="${RUNNER_TEMP}/clasp-auth/.clasprc.json"
CURL_BIN="${CURL_BIN:-curl}"
test -f "${auth_file}"
jq -e '.scriptId | type == "string" and length > 0' .clasp.json >/dev/null
script_id="$(jq -er '.scriptId' .clasp.json)"

refresh_access_token() {
  local client_id client_secret refresh_token
  client_id="$(jq -er '.tokens.default.client_id | select(type == "string" and length > 0)' "${auth_file}")"
  client_secret="$(jq -er '.tokens.default.client_secret | select(type == "string" and length > 0)' "${auth_file}")"
  refresh_token="$(jq -er '.tokens.default.refresh_token | select(type == "string" and length > 0)' "${auth_file}")"
  "${CURL_BIN}" --silent --show-error --fail --request POST \
    https://oauth2.googleapis.com/token \
    --data-urlencode "client_id=${client_id}" \
    --data-urlencode "client_secret=${client_secret}" \
    --data-urlencode "refresh_token=${refresh_token}" \
    --data-urlencode 'grant_type=refresh_token' |
    jq -er '.access_token | select(type == "string" and length > 0)'
}

ensure_current_main() {
  local current_main_sha
  git fetch --no-tags origin main
  current_main_sha="$(git rev-parse FETCH_HEAD)"
  if [[ "${DEPLOY_COMMIT_SHA}" != "${current_main_sha}" ]]; then
    printf '%s\n' 'A newer main revision exists; skipping stale deployment.'
    exit 0
  fi
}

ensure_current_main

deployments="$(clasp -A "${auth_file}" --json deployments)"
jq -e --arg id "${APPS_SCRIPT_DEPLOYMENT_ID}" 'any(.[]; .deploymentId == $id and (.versionNumber | type == "number"))' \
  <<<"${deployments}" >/dev/null

access_token="$(refresh_access_token)"
deployment="$("${CURL_BIN}" --silent --show-error --fail \
  --header "Authorization: Bearer ${access_token}" \
  "https://script.googleapis.com/v1/projects/${script_id}/deployments/${APPS_SCRIPT_DEPLOYMENT_ID}")"
jq -e --arg id "${APPS_SCRIPT_DEPLOYMENT_ID}" --arg script_id "${script_id}" '
  .deploymentId == $id and
  .deploymentConfig.scriptId == $script_id and
  (.entryPoints | type == "array" and length > 0) and
  any(.entryPoints[];
    .entryPointType == "EXECUTION_API" and
    .executionApi.entryPointConfig.access == "MYSELF"
  )
' <<<"${deployment}" >/dev/null
entry_points="$(jq -ce '.entryPoints' <<<"${deployment}")"
execution_api="$(jq -ce '
  [.entryPoints[] |
    select(.entryPointType == "EXECUTION_API") |
    .executionApi.entryPointConfig
  ] | first
' <<<"${deployment}")"

snapshot_dir="${RUNNER_TEMP}/apps-script-snapshot"
mkdir -m 700 "${snapshot_dir}"
cp .clasp.json "${snapshot_dir}/.clasp.json"
(cd "${snapshot_dir}" && clasp -A "${auth_file}" pull)
time_zone="$(jq -er '.timeZone | select(type == "string" and length > 0)' "${snapshot_dir}/appsscript.json")"
jq --arg time_zone "${time_zone}" --argjson execution_api "${execution_api}" '
  .timeZone = $time_zone |
  .executionApi = $execution_api
' appsscript.json >"${RUNNER_TEMP}/appsscript.json"
mv "${RUNNER_TEMP}/appsscript.json" appsscript.json

label="main-${DEPLOY_COMMIT_SHA::12}"
ensure_current_main
clasp -A "${auth_file}" push --force
version="$(clasp -A "${auth_file}" --json version "${label}" | jq -er '.versionNumber | select(type == "number")')"
deployment_config="$(jq -ce --argjson version "${version}" --arg description "${label}" '
  .deploymentConfig |
  .versionNumber = $version |
  .description = $description
' <<<"${deployment}")"
update_payload="$(jq -cn --argjson config "${deployment_config}" '{deploymentConfig: $config}')"
ensure_current_main
updated_deployment="$("${CURL_BIN}" --silent --show-error --fail --request PUT \
  --header "Authorization: Bearer ${access_token}" \
  --header 'Content-Type: application/json' \
  --data "${update_payload}" \
  "https://script.googleapis.com/v1/projects/${script_id}/deployments/${APPS_SCRIPT_DEPLOYMENT_ID}")"
jq -e --arg id "${APPS_SCRIPT_DEPLOYMENT_ID}" --argjson version "${version}" \
  --argjson entry_points "${entry_points}" '
    .deploymentId == $id and
    .deploymentConfig.versionNumber == $version and
    .entryPoints == $entry_points
  ' <<<"${updated_deployment}" >/dev/null
