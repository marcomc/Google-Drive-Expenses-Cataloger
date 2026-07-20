#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "${TEST_ROOT}"' EXIT
FAKE_BIN="${TEST_ROOT}/bin"
mkdir -p "${FAKE_BIN}"
KERNEL_NAME=''
KERNEL_NAME="$(uname -s)"

file_mode() {
  if [[ "${KERNEL_NAME}" == 'Darwin' ]]; then
    stat -f '%Lp' "$1"
  else
    stat -c '%a' "$1"
  fi
}

cat >"${FAKE_BIN}/git" <<'FAKE_GIT'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  fetch)
    test "$#" -eq 4
    test "$2" = '--no-tags'
    test "$3" = 'origin'
    test "$4" = 'main'
    ;;
  rev-parse)
    test "$#" -eq 2
    test "$2" = 'FETCH_HEAD'
    call_count="$(cat "${TEST_GIT_CALL_COUNT_FILE}")"
    IFS=',' read -r -a main_shas <<<"${TEST_MAIN_SHA_SEQUENCE}"
    last_index="$((${#main_shas[@]} - 1))"
    printf '%s\n' "${main_shas[${call_count}]:-${main_shas[${last_index}]}}"
    printf '%s\n' "$((call_count + 1))" >"${TEST_GIT_CALL_COUNT_FILE}"
    ;;
  *) exit 2 ;;
esac
FAKE_GIT

cat >"${FAKE_BIN}/clasp" <<'FAKE_CLASP'
#!/usr/bin/env bash
set -euo pipefail
command_name=''
auth_file=''
expect_auth_file=0
for argument in "$@"; do
  if [[ "${expect_auth_file}" -eq 1 ]]; then
    auth_file="${argument}"
    expect_auth_file=0
    continue
  fi
  case "${argument}" in
    -A) expect_auth_file=1 ;;
    deployments | pull | push | version)
      command_name="${argument}"
      break
      ;;
  esac
done
test "${auth_file}" = "${RUNNER_TEMP}/clasp-auth/.clasprc.json"
test -f "${auth_file}"
case "${command_name}" in
  deployments)
    deployments_count="$(cat "${TEST_CLASP_DEPLOYMENTS_COUNT_FILE}")"
    deployments_count="$((deployments_count + 1))"
    printf '%s\n' "${deployments_count}" >"${TEST_CLASP_DEPLOYMENTS_COUNT_FILE}"
    if [[ "${deployments_count}" -gt "${TEST_FAIL_DEPLOYMENTS_AFTER}" ]]; then
      exit 9
    fi
    printf '[{"deploymentId":"%s","versionNumber":4}]\n' "${TEST_LISTED_DEPLOYMENT_ID}"
    ;;
  pull)
    printf '%s\n' '{"timeZone":"Europe/Rome"}' >appsscript.json
    ;;
  push)
    jq -e '.timeZone == "Europe/Rome" and .executionApi.access == "MYSELF"' appsscript.json >/dev/null
    if [[ "${TEST_FAIL_PUSH}" == 'true' ]]; then
      exit 11
    fi
    printf '%s\n' push >>"${TEST_COMMAND_LOG}"
    ;;
  version)
    printf '%s\n' version >>"${TEST_COMMAND_LOG}"
    printf '%s\n' '{"versionNumber":5}'
    ;;
  *) exit 2 ;;
esac
FAKE_CLASP

cat >"${FAKE_BIN}/curl" <<'FAKE_CURL'
#!/usr/bin/env bash
set -euo pipefail
method='GET'
payload=''
next=''
url=''
authorization=''
header_source=''
for argument in "$@"; do
  if [[ "${argument}" == Authorization:* ]]; then
    printf '%s\n' 'Authorization header must not be passed through argv.' >&2
    exit 7
  fi
  case "${next}" in
    method)
      method="${argument}"
      next=''
      continue
      ;;
    payload)
      payload="${argument}"
      next=''
      continue
      ;;
    header)
      test "${argument}" = '@-'
      header_source='stdin'
      next=''
      continue
      ;;
  esac
  case "${argument}" in
    --request) next='method' ;;
    --data) next='payload' ;;
    --header) next='header' ;;
    https://*) url="${argument}" ;;
  esac
done
test "${header_source}" = 'stdin'
while IFS= read -r header; do
  if [[ "${header}" == Authorization:* ]]; then
    authorization="${header}"
  fi
done
test "${authorization}" = 'Authorization: Bearer test-token'
deployment_url="https://script.googleapis.com/v1/projects/test-script/deployments/${APPS_SCRIPT_DEPLOYMENT_ID}"
execution_url="https://script.googleapis.com/v1/scripts/${APPS_SCRIPT_DEPLOYMENT_ID}:run"
if [[ "${url}" == "${execution_url}" ]]; then
  test "${method}" = 'POST'
  jq -e '.function == "installAutomationTriggers" and .parameters == [] and .devMode == false' \
    <<<"${payload}" >/dev/null
  printf '%s\n' triggers >>"${TEST_COMMAND_LOG}"
  if [[ "${TEST_TRIGGER_RESULT_VALID}" != 'true' ]]; then
    printf '%s\n' '{"done":true,"response":{"result":{"triggerCounts":{}}}}'
    exit 0
  fi
  printf '%s\n' '{"done":true,"response":{"@type":"type.googleapis.com/google.apps.script.v1.ExecutionResponse","result":{"triggerCounts":{"processDriveEventQueue":1,"runDailyExpenseCataloging":1},"dashboardYearColorEditTriggerCount":1,"missingTriggerHandlers":[],"duplicateTriggerHandlers":[]}}}'
  exit 0
fi
test "${url}" = "${deployment_url}"
entry_points='[{"entryPointType":"EXECUTION_API","executionApi":{"entryPointConfig":{"access":"MYSELF"}}}]'
if [[ "${TEST_HAS_API_ENTRY_POINT}" != 'true' ]]; then
  entry_points='[]'
fi
case "${method}" in
  GET)
    jq -cn --arg id "${TEST_LISTED_DEPLOYMENT_ID}" --argjson entry_points "${entry_points}" \
      '{deploymentId: $id, deploymentConfig: {scriptId: "test-script", versionNumber: 4, manifestFileName: "appsscript"}, entryPoints: $entry_points}'
    ;;
  PUT)
    printf '%s\n' update >>"${TEST_COMMAND_LOG}"
    jq -e '
      .deploymentConfig.scriptId == "test-script" and
      .deploymentConfig.versionNumber == 5 and
      .deploymentConfig.description == "main-111111111111"
    ' <<<"${payload}" >/dev/null
    response_entry_points="${entry_points}"
    if [[ "${TEST_MUTATE_UPDATE}" == 'true' ]]; then
      response_entry_points='[]'
    fi
    jq -cn --arg id "${TEST_LISTED_DEPLOYMENT_ID}" --argjson entry_points "${response_entry_points}" \
      '{deploymentId: $id, deploymentConfig: {scriptId: "test-script", versionNumber: 5, manifestFileName: "appsscript", description: "main-111111111111"}, entryPoints: $entry_points}'
    ;;
  *) exit 2 ;;
esac
FAKE_CURL
chmod +x "${FAKE_BIN}/git" "${FAKE_BIN}/clasp" "${FAKE_BIN}/curl"

run_fixture() {
  local fixture_dir="$1"
  local deploy_sha="$2"
  local current_sha="$3"
  local configured_deployment_id="$4"
  local listed_deployment_id="$5"
  local has_api_entry_point="$6"
  local mutate_update="${7:-false}"
  local main_sha_sequence="${8:-${current_sha},${current_sha},${current_sha}}"
  local trigger_result_valid="${9:-true}"
  local fail_deployments_after="${10:-99}"
  local fail_push="${11:-false}"

  mkdir -p "${fixture_dir}/runner/clasp-auth"
  printf '%s\n' \
    '{"tokens":{"default":{"access_token":"test-token"}}}' \
    >"${fixture_dir}/runner/clasp-auth/.clasprc.json"
  printf '%s\n' '{"scriptId":"test-script","rootDir":"."}' >"${fixture_dir}/.clasp.json"
  printf '%s\n' '{"timeZone":"Etc/UTC"}' >"${fixture_dir}/appsscript.json"
  cp "${fixture_dir}/appsscript.json" "${fixture_dir}/appsscript.original.json"
  : >"${fixture_dir}/commands.log"
  printf '%s\n' 0 >"${fixture_dir}/git-call-count"
  printf '%s\n' 0 >"${fixture_dir}/clasp-deployments-count"
  (
    cd "${fixture_dir}"
    PATH="${FAKE_BIN}:${PATH}" \
      CURL_BIN="${FAKE_BIN}/curl" \
      RUNNER_TEMP="${fixture_dir}/runner" \
      APPS_SCRIPT_DEPLOYMENT_ID="${configured_deployment_id}" \
      DEPLOY_COMMIT_SHA="${deploy_sha}" \
      TEST_GIT_CALL_COUNT_FILE="${fixture_dir}/git-call-count" \
      TEST_MAIN_SHA_SEQUENCE="${main_sha_sequence}" \
      TEST_LISTED_DEPLOYMENT_ID="${listed_deployment_id}" \
      TEST_HAS_API_ENTRY_POINT="${has_api_entry_point}" \
      TEST_MUTATE_UPDATE="${mutate_update}" \
      TEST_TRIGGER_RESULT_VALID="${trigger_result_valid}" \
      TEST_CLASP_DEPLOYMENTS_COUNT_FILE="${fixture_dir}/clasp-deployments-count" \
      TEST_FAIL_DEPLOYMENTS_AFTER="${fail_deployments_after}" \
      TEST_FAIL_PUSH="${fail_push}" \
      TEST_COMMAND_LOG="${fixture_dir}/commands.log" \
      "${PROJECT_ROOT}/scripts/deploy-apps-script.sh"
  )
}

CURRENT_SHA='1111111111111111111111111111111111111111'
STALE_SHA='2222222222222222222222222222222222222222'

success_dir="${TEST_ROOT}/success"
mkdir -p "${success_dir}"
run_fixture "${success_dir}" "${CURRENT_SHA}" "${CURRENT_SHA}" \
  'deployment-1' 'deployment-1' true
cmp "${success_dir}/appsscript.original.json" "${success_dir}/appsscript.json"
success_manifest_mode=''
success_manifest_mode="$(file_mode "${success_dir}/appsscript.json")"
test "${success_manifest_mode}" = '644'
actual_commands="$(tr '\n' ' ' <"${success_dir}/commands.log")"
test "${actual_commands}" = 'push version update triggers '

failed_push_dir="${TEST_ROOT}/failed-push"
mkdir -p "${failed_push_dir}"
set +e
(
  set -e
  run_fixture "${failed_push_dir}" "${CURRENT_SHA}" "${CURRENT_SHA}" \
    'deployment-1' 'deployment-1' true false \
    "${CURRENT_SHA},${CURRENT_SHA},${CURRENT_SHA}" true 99 true
) >/dev/null 2>&1
failed_push_status=$?
set -e
if [[ "${failed_push_status}" -eq 0 ]]; then
  printf '%s\n' 'A failed Apps Script push was accepted.' >&2
  exit 1
fi
cmp "${failed_push_dir}/appsscript.original.json" "${failed_push_dir}/appsscript.json"
failed_push_manifest_mode=''
failed_push_manifest_mode="$(file_mode "${failed_push_dir}/appsscript.json")"
test "${failed_push_manifest_mode}" = '644'
test ! -s "${failed_push_dir}/commands.log"

stale_dir="${TEST_ROOT}/stale"
mkdir -p "${stale_dir}"
run_fixture "${stale_dir}" "${STALE_SHA}" "${CURRENT_SHA}" \
  'deployment-1' 'deployment-1' true
test ! -s "${stale_dir}/commands.log"

stale_before_push_dir="${TEST_ROOT}/stale-before-push"
mkdir -p "${stale_before_push_dir}"
run_fixture "${stale_before_push_dir}" "${CURRENT_SHA}" "${CURRENT_SHA}" \
  'deployment-1' 'deployment-1' true false "${CURRENT_SHA},${STALE_SHA}"
test ! -s "${stale_before_push_dir}/commands.log"

refresh_failure_dir="${TEST_ROOT}/refresh-failure"
mkdir -p "${refresh_failure_dir}"
set +e
(
  set -e
  run_fixture "${refresh_failure_dir}" "${CURRENT_SHA}" "${CURRENT_SHA}" \
    'deployment-1' 'deployment-1' true false \
    "${CURRENT_SHA},${CURRENT_SHA},${CURRENT_SHA}" true 1
) >"${refresh_failure_dir}/output.log" 2>&1
refresh_failure_status=$?
set -e
if [[ "${refresh_failure_status}" -eq 0 ]]; then
  printf '%s\n' 'A failed post-preflight authorization refresh was accepted.' >&2
  exit 1
fi
test ! -s "${refresh_failure_dir}/commands.log"
grep -q 'Could not refresh Apps Script deployment authorization' \
  "${refresh_failure_dir}/output.log"

stale_before_update_dir="${TEST_ROOT}/stale-before-update"
mkdir -p "${stale_before_update_dir}"
run_fixture "${stale_before_update_dir}" "${CURRENT_SHA}" "${CURRENT_SHA}" \
  'deployment-1' 'deployment-1' true false "${CURRENT_SHA},${CURRENT_SHA},${STALE_SHA}"
actual_commands="$(tr '\n' ' ' <"${stale_before_update_dir}/commands.log")"
test "${actual_commands}" = 'push version '

stale_after_update_dir="${TEST_ROOT}/stale-after-update"
mkdir -p "${stale_after_update_dir}"
run_fixture "${stale_after_update_dir}" "${CURRENT_SHA}" "${CURRENT_SHA}" \
  'deployment-1' 'deployment-1' true false "${CURRENT_SHA},${CURRENT_SHA},${CURRENT_SHA},${STALE_SHA}"
actual_commands="$(tr '\n' ' ' <"${stale_after_update_dir}/commands.log")"
test "${actual_commands}" = 'push version update triggers '

missing_entry_point_dir="${TEST_ROOT}/missing-entry-point"
mkdir -p "${missing_entry_point_dir}"
set +e
(
  set -e
  run_fixture "${missing_entry_point_dir}" "${CURRENT_SHA}" "${CURRENT_SHA}" \
    'deployment-1' 'deployment-1' false
) >/dev/null 2>&1
missing_entry_point_status=$?
set -e
if [[ "${missing_entry_point_status}" -eq 0 ]]; then
  printf '%s\n' 'A deployment without the API executable entry point was accepted.' >&2
  exit 1
fi
test ! -s "${missing_entry_point_dir}/commands.log"

mutated_update_dir="${TEST_ROOT}/mutated-update"
mkdir -p "${mutated_update_dir}"
set +e
(
  set -e
  run_fixture "${mutated_update_dir}" "${CURRENT_SHA}" "${CURRENT_SHA}" \
    'deployment-1' 'deployment-1' true true
) >/dev/null 2>&1
mutated_update_status=$?
set -e
if [[ "${mutated_update_status}" -eq 0 ]]; then
  printf '%s\n' 'A mutated API executable entry point was accepted.' >&2
  exit 1
fi
actual_commands="$(tr '\n' ' ' <"${mutated_update_dir}/commands.log")"
test "${actual_commands}" = 'push version update '

invalid_trigger_result_dir="${TEST_ROOT}/invalid-trigger-result"
mkdir -p "${invalid_trigger_result_dir}"
set +e
(
  set -e
  run_fixture "${invalid_trigger_result_dir}" "${CURRENT_SHA}" "${CURRENT_SHA}" \
    'deployment-1' 'deployment-1' true false \
    "${CURRENT_SHA},${CURRENT_SHA},${CURRENT_SHA}" false
) >/dev/null 2>&1
invalid_trigger_result_status=$?
set -e
if [[ "${invalid_trigger_result_status}" -eq 0 ]]; then
  printf '%s\n' 'An invalid trigger execution envelope was accepted.' >&2
  exit 1
fi

printf '%s\n' 'Apps Script deployment tests passed.'
