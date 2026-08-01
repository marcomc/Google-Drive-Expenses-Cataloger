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

refresh_apps_script_authorization() {
  local result_variable="${1:-}"
  local clasp_refresh_error
  local clasp_refresh_error_file
  local clasp_output
  clasp_refresh_error_file="$(mktemp)"
  if clasp_output="$(clasp -A "${auth_file}" --json deployments \
    2>"${clasp_refresh_error_file}")"; then
    rm -f "${clasp_refresh_error_file}"
    if [[ -n "${result_variable}" ]]; then
      printf -v "${result_variable}" '%s' "${clasp_output}"
    fi
  else
    clasp_refresh_error="$(<"${clasp_refresh_error_file}")"
    rm -f "${clasp_refresh_error_file}"
    if grep -Fq 'invalid_grant' <<<"${clasp_refresh_error}"; then
      printf '%s\n' \
        'OAuth refresh token is invalid or expired; reauthorize the owner Desktop OAuth client and replace CLASP_AUTH_JSON.' >&2
    else
      printf '%s\n' 'Could not refresh Apps Script deployment authorization.' >&2
    fi
    return 1
  fi
}

apps_script_request() {
  local method="$1"
  local payload="$2"
  local url="$3"
  local refresh_authorization="${4:-true}"
  local access_token
  local response
  local request_status
  local -a request_args

  if [[ "${refresh_authorization}" == 'true' ]]; then
    # The caller handles this failure to preserve the diagnostic context.
    # shellcheck disable=SC2310
    if ! refresh_apps_script_authorization; then
      return 1
    fi
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

validate_owner_only_api_deployment() {
  local deployment_json="$1"
  local expected_version="${2:-}"

  if ! jq -e --arg id "${APPS_SCRIPT_DEPLOYMENT_ID}" --arg script_id "${script_id}" '
    .deploymentId == $id and
    .deploymentConfig.scriptId == $script_id and
    (.deploymentConfig.versionNumber | type == "number") and
    .deploymentConfig.manifestFileName == "appsscript" and
    (.entryPoints | type == "array" and length == 1) and
    .entryPoints[0].entryPointType == "EXECUTION_API" and
    .entryPoints[0].executionApi.entryPointConfig.access == "MYSELF"
  ' <<<"${deployment_json}" >/dev/null; then
    printf '%s\n' 'The stable deployment is not an owner-only API executable.' >&2
    return 1
  fi
  if [[ -n "${expected_version}" ]] &&
    ! jq -e --argjson version "${expected_version}" \
      '.deploymentConfig.versionNumber == $version' \
      <<<"${deployment_json}" >/dev/null; then
    printf 'The stable deployment is not on expected version %s.\n' \
      "${expected_version}" >&2
    return 1
  fi
}

reconcile_automation_triggers() {
  local trigger_status

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
    .response.result.dashboardYearColorEditTriggerCount == 1 and
    .response.result.missingTriggerHandlers == [] and
    .response.result.duplicateTriggerHandlers == [] and
    .response.result.invalidTriggerHandlers == []
  ' <<<"${trigger_status}" >/dev/null
}

get_current_main_sha() {
  git fetch --no-tags origin main
  git rev-parse FETCH_HEAD
}

ensure_current_main() {
  local current_main_sha
  current_main_sha="$(get_current_main_sha)"
  if [[ "${DEPLOY_COMMIT_SHA}" != "${current_main_sha}" ]]; then
    printf '%s\n' 'A newer main revision exists; skipping stale deployment.'
    exit 0
  fi
}

initial_main_sha="$(get_current_main_sha)"

deployments=''
# shellcheck disable=SC2310
refresh_apps_script_authorization deployments
listed_version="$(jq -er --arg id "${APPS_SCRIPT_DEPLOYMENT_ID}" '
  [.[] | select(.deploymentId == $id and (.versionNumber | type == "number"))] |
  select(length == 1) |
  .[0].versionNumber
' <<<"${deployments}")"

deployment="$(apps_script_request GET '' \
  "https://script.googleapis.com/v1/projects/${script_id}/deployments/${APPS_SCRIPT_DEPLOYMENT_ID}")"
validate_owner_only_api_deployment "${deployment}" "${listed_version}"
entry_points="$(jq -ce '.entryPoints' <<<"${deployment}")"
execution_api="$(jq -ce '.entryPoints[0].executionApi.entryPointConfig' <<<"${deployment}")"
label="main-${DEPLOY_COMMIT_SHA::12}"

if [[ "${DEPLOY_COMMIT_SHA}" != "${initial_main_sha}" ]]; then
  if jq -e --arg description "${label}" \
    '.deploymentConfig.description == $description' <<<"${deployment}" >/dev/null; then
    printf '%s\n' 'The stable deployment already matches this revision; resuming trigger reconciliation.'
    reconcile_automation_triggers
  else
    printf '%s\n' 'A newer main revision exists; skipping stale deployment.'
  fi
  exit 0
fi

snapshot_dir="${RUNNER_TEMP}/apps-script-snapshot"
mkdir -m 700 "${snapshot_dir}"
cp .clasp.json "${snapshot_dir}/.clasp.json"
(cd "${snapshot_dir}" && clasp -A "${auth_file}" pull)
time_zone="$(jq -er '.timeZone | select(type == "string" and length > 0)' "${snapshot_dir}/appsscript.json")"
push_apps_script_source() (
  local original_manifest
  local generated_manifest
  original_manifest="$(mktemp "${RUNNER_TEMP}/appsscript-original.XXXXXX")"
  generated_manifest="$(mktemp "${RUNNER_TEMP}/appsscript-generated.XXXXXX")"
  cp appsscript.json "${original_manifest}"
  trap 'cp "${original_manifest}" appsscript.json; rm -f "${original_manifest}" "${generated_manifest}"' EXIT
  jq --arg time_zone "${time_zone}" --argjson execution_api "${execution_api}" '
    .timeZone = $time_zone |
    .executionApi = $execution_api
  ' appsscript.json >"${generated_manifest}"
  cp "${generated_manifest}" appsscript.json
  clasp -A "${auth_file}" push --force
)
ensure_current_main
push_apps_script_source
version="$(clasp -A "${auth_file}" --json version "${label}" | jq -er '.versionNumber | select(type == "number")')"
deployment_config="$(jq -ce --argjson version "${version}" --arg description "${label}" '
  .deploymentConfig |
  .versionNumber = $version |
  .description = $description
' <<<"${deployment}")"
update_payload="$(jq -cn --argjson config "${deployment_config}" '{deploymentConfig: $config}')"
# Refresh before the final main-revision check so no authorization request can
# reopen a stale-deployment race between that check and the stable mutation.
refresh_apps_script_authorization
ensure_current_main
updated_deployment="$(apps_script_request PUT "${update_payload}" \
  "https://script.googleapis.com/v1/projects/${script_id}/deployments/${APPS_SCRIPT_DEPLOYMENT_ID}" \
  false)"
validate_owner_only_api_deployment "${updated_deployment}" "${version}"
jq -e --argjson entry_points "${entry_points}" \
  '.entryPoints == $entry_points' <<<"${updated_deployment}" >/dev/null

# Time-driven triggers are bound to the deployment that creates them. Recreate
# them through the exact stable API executable after it is updated, and install
# the dashboard edit trigger required by year-series color controls. A rerun can
# resume this step when promotion succeeded but reconciliation did not.
reconcile_automation_triggers
