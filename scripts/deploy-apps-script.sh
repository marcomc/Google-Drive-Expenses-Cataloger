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

apps_script_request() {
  local method="$1"
  local payload="$2"
  local url="$3"
  local access_token
  local response
  local request_status
  local -a request_args

  if ! clasp -A "${auth_file}" --json deployments >/dev/null; then
    printf '%s\n' 'Could not refresh Apps Script deployment authorization.' >&2
    return 1
  fi
  access_token="$(jq -er '
    .tokens.default.access_token |
    select(type == "string" and length > 0)
  ' "${auth_file}")" || {
    printf '%s\n' 'The clasp authorization has no usable access token.' >&2
    return 1
  }
  request_args=(--silent --show-error --fail --header @-)
  if [[ "${method}" != "GET" ]]; then
    request_args+=(--request "${method}")
  fi
  if [[ -n "${payload}" ]]; then
    request_args+=(--data "${payload}")
  fi
  if response="$(
    printf 'Authorization: Bearer %s\nAccept: application/json\nContent-Type: application/json\n' \
      "${access_token}" |
      "${CURL_BIN}" "${request_args[@]}" "${url}"
  )"; then
    request_status=0
  else
    request_status=$?
  fi
  unset access_token
  if [[ "${request_status}" -ne 0 ]]; then
    printf 'Apps Script API request failed with curl status %s.\n' \
      "${request_status}" >&2
    return 1
  fi
  printf '%s' "${response}"
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

deployment="$(apps_script_request GET '' \
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
updated_deployment="$(apps_script_request PUT "${update_payload}" \
  "https://script.googleapis.com/v1/projects/${script_id}/deployments/${APPS_SCRIPT_DEPLOYMENT_ID}")"
jq -e --arg id "${APPS_SCRIPT_DEPLOYMENT_ID}" --argjson version "${version}" \
  --argjson entry_points "${entry_points}" '
    .deploymentId == $id and
    .deploymentConfig.versionNumber == $version and
    .entryPoints == $entry_points
  ' <<<"${updated_deployment}" >/dev/null

# Time-driven triggers are bound to the deployment that creates them. Recreate
# them through the exact stable API executable after it is updated. Do not
# stale-skip this recovery after a successful update: leaving old triggers
# would recreate the precise version mismatch this step repairs.
trigger_status="$(apps_script_request POST \
  '{"function":"installAutomationTriggers","parameters":[],"devMode":false}' \
  "https://script.googleapis.com/v1/scripts/${APPS_SCRIPT_DEPLOYMENT_ID}:run")"
jq -e '
  .done == true and
  .error == null and
  .response["@type"] ==
    "type.googleapis.com/google.apps.script.v1.ExecutionResponse" and
  .response.result.triggerCounts.processDriveEventQueue == 1 and
  .response.result.triggerCounts.runDailyExpenseCataloging == 1 and
  .response.result.missingTriggerHandlers == [] and
  .response.result.duplicateTriggerHandlers == []
' <<<"${trigger_status}" >/dev/null
