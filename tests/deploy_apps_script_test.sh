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
    printf '%s\n' main-check >>"${TEST_ORDER_LOG}"
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
    if [[ "${deployments_count}" -eq 1 ]]; then
      printf '%s\n' list-deployments >>"${TEST_ORDER_LOG}"
    else
      printf '%s\n' auth-refresh >>"${TEST_ORDER_LOG}"
    fi
    if [[ "${deployments_count}" -eq "${TEST_REMOVE_TOKEN_AFTER}" ]]; then
      printf '%s\n' '{"tokens":{"default":{}}}' >"${auth_file}"
    fi
    if [[ "${TEST_REFRESH_TOKEN_ON_DEPLOYMENTS}" == 'true' && "${deployments_count}" -eq 2 ]]; then
      printf '%s\n' '{"tokens":{"default":{"access_token":"refreshed-test-token"}}}' >"${auth_file}"
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
    printf '%s\n' push >>"${TEST_ORDER_LOG}"
    ;;
  version)
    printf '%s\n' version >>"${TEST_COMMAND_LOG}"
    printf '%s\n' version >>"${TEST_ORDER_LOG}"
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
test "${authorization}" = "Authorization: Bearer ${TEST_EXPECTED_ACCESS_TOKEN}"
deployment_url="https://script.googleapis.com/v1/projects/test-script/deployments/${APPS_SCRIPT_DEPLOYMENT_ID}"
execution_url="https://script.googleapis.com/v1/scripts/${APPS_SCRIPT_DEPLOYMENT_ID}:run"
if [[ "${url}" == "${execution_url}" ]]; then
  if [[ "${TEST_CURL_FAIL_AT}" == 'TRIGGERS' ]]; then
    exit 28
  fi
  test "${method}" = 'POST'
  jq -e '.function == "installAutomationTriggers" and .parameters == [] and .devMode == false' \
    <<<"${payload}" >/dev/null
  printf '%s\n' triggers >>"${TEST_COMMAND_LOG}"
  printf '%s\n' triggers >>"${TEST_ORDER_LOG}"
  if [[ "${TEST_TRIGGER_RESULT_VALID}" != 'true' ]]; then
    printf '%s\n' '{"done":true,"response":{"result":{"triggerCounts":{"processDriveEventQueue":1,"runDailyExpenseCataloging":1},"dashboardYearColorEditTriggerCount":0,"missingTriggerHandlers":[],"duplicateTriggerHandlers":[]}}}'
    exit 0
  fi
  printf '%s\n' '{"done":true,"response":{"@type":"type.googleapis.com/google.apps.script.v1.ExecutionResponse","result":{"triggerCounts":{"processDriveEventQueue":1,"runDailyExpenseCataloging":1},"dashboardYearColorEditTriggerCount":1,"missingTriggerHandlers":[],"duplicateTriggerHandlers":[]}}}'
  exit 0
fi
test "${url}" = "${deployment_url}"
entry_points='[{"entryPointType":"EXECUTION_API","executionApi":{"entryPointConfig":{"access":"MYSELF"}}}]'
response_script_id='test-script'
response_manifest='appsscript'
if [[ "${TEST_HAS_API_ENTRY_POINT}" != 'true' ]]; then
  entry_points='[]'
fi
case "${TEST_DEPLOYMENT_SCENARIO}" in
  valid) ;;
  wrong-access)
    entry_points='[{"entryPointType":"EXECUTION_API","executionApi":{"entryPointConfig":{"access":"ANYONE"}}}]'
    ;;
  mixed-public)
    entry_points='[{"entryPointType":"EXECUTION_API","executionApi":{"entryPointConfig":{"access":"MYSELF"}}},{"entryPointType":"WEB_APP","webApp":{"entryPointConfig":{"access":"ANYONE"}}}]'
    ;;
  wrong-script) response_script_id='other-script' ;;
  wrong-manifest) response_manifest='other-manifest' ;;
  *) exit 2 ;;
esac
case "${method}" in
  GET)
    if [[ "${TEST_CURL_FAIL_AT}" == 'GET' ]]; then
      exit 28
    fi
    jq -cn --arg id "${TEST_GET_RESPONSE_DEPLOYMENT_ID}" \
      --argjson version "${TEST_GET_RESPONSE_VERSION}" \
      --arg script_id "${response_script_id}" --arg manifest "${response_manifest}" \
      --argjson entry_points "${entry_points}" \
      '{deploymentId: $id, deploymentConfig: {scriptId: $script_id, versionNumber: $version, manifestFileName: $manifest}, entryPoints: $entry_points}'
    ;;
  PUT)
    if [[ "${TEST_CURL_FAIL_AT}" == 'PUT' ]]; then
      exit 28
    fi
    printf '%s\n' update >>"${TEST_COMMAND_LOG}"
    printf '%s\n' update >>"${TEST_ORDER_LOG}"
    jq -e '
      .deploymentConfig.scriptId == "test-script" and
      .deploymentConfig.versionNumber == 5 and
      .deploymentConfig.description == "main-111111111111"
    ' <<<"${payload}" >/dev/null
    case "${TEST_MUTATE_UPDATE}" in
      false) ;;
      true | entry-points) entry_points='[]' ;;
      access)
        entry_points='[{"entryPointType":"EXECUTION_API","executionApi":{"entryPointConfig":{"access":"ANYONE"}}}]'
        ;;
      script-id) response_script_id='other-script' ;;
      manifest) response_manifest='other-manifest' ;;
      *) exit 2 ;;
    esac
    jq -cn --arg id "${TEST_PUT_RESPONSE_DEPLOYMENT_ID}" \
      --argjson version "${TEST_PUT_RESPONSE_VERSION}" \
      --arg script_id "${response_script_id}" --arg manifest "${response_manifest}" \
      --argjson entry_points "${entry_points}" \
      '{deploymentId: $id, deploymentConfig: {scriptId: $script_id, versionNumber: $version, manifestFileName: $manifest, description: "main-111111111111"}, entryPoints: $entry_points}'
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
  local deployment_scenario="${11:-valid}"
  local remove_token_after="${12:-0}"
  local curl_fail_at="${13:-none}"
  local get_response_deployment_id="${14:-${listed_deployment_id}}"
  local get_response_version="${15:-4}"
  local put_response_deployment_id="${16:-${listed_deployment_id}}"
  local put_response_version="${17:-5}"
  local fail_push="${18:-false}"
  local refresh_token_on_deployments="${19:-false}"
  local initial_access_token="${20:-sensitive-test-token-do-not-log}"
  local expected_access_token="${21:-${initial_access_token}}"

  mkdir -p "${fixture_dir}/runner/clasp-auth"
  printf '%s\n' \
    "{\"tokens\":{\"default\":{\"access_token\":\"${initial_access_token}\"}}}" \
    >"${fixture_dir}/runner/clasp-auth/.clasprc.json"
  printf '%s\n' '{"scriptId":"test-script","rootDir":"."}' >"${fixture_dir}/.clasp.json"
  printf '%s\n' '{"timeZone":"Etc/UTC"}' >"${fixture_dir}/appsscript.json"
  cp "${fixture_dir}/appsscript.json" "${fixture_dir}/appsscript.original.json"
  : >"${fixture_dir}/commands.log"
  : >"${fixture_dir}/order.log"
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
      TEST_DEPLOYMENT_SCENARIO="${deployment_scenario}" \
      TEST_REMOVE_TOKEN_AFTER="${remove_token_after}" \
      TEST_CURL_FAIL_AT="${curl_fail_at}" \
      TEST_GET_RESPONSE_DEPLOYMENT_ID="${get_response_deployment_id}" \
      TEST_GET_RESPONSE_VERSION="${get_response_version}" \
      TEST_PUT_RESPONSE_DEPLOYMENT_ID="${put_response_deployment_id}" \
      TEST_PUT_RESPONSE_VERSION="${put_response_version}" \
      TEST_FAIL_PUSH="${fail_push}" \
      TEST_REFRESH_TOKEN_ON_DEPLOYMENTS="${refresh_token_on_deployments}" \
      TEST_EXPECTED_ACCESS_TOKEN="${expected_access_token}" \
      TEST_COMMAND_LOG="${fixture_dir}/commands.log" \
      TEST_ORDER_LOG="${fixture_dir}/order.log" \
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
actual_order="$(tr '\n' ' ' <"${success_dir}/order.log")"
test "${actual_order}" = \
  'main-check list-deployments auth-refresh main-check push version auth-refresh main-check update auth-refresh triggers '

refreshed_token_dir="${TEST_ROOT}/refreshed-token"
mkdir -p "${refreshed_token_dir}"
run_fixture "${refreshed_token_dir}" "${CURRENT_SHA}" "${CURRENT_SHA}" \
  'deployment-1' 'deployment-1' true false \
  "${CURRENT_SHA},${CURRENT_SHA},${CURRENT_SHA}" true 99 valid 0 none \
  'deployment-1' 4 'deployment-1' 5 false true expired-test-token refreshed-test-token

failed_push_dir="${TEST_ROOT}/failed-push"
mkdir -p "${failed_push_dir}"
set +e
(
  set -e
  run_fixture "${failed_push_dir}" "${CURRENT_SHA}" "${CURRENT_SHA}" \
    'deployment-1' 'deployment-1' true false \
    "${CURRENT_SHA},${CURRENT_SHA},${CURRENT_SHA}" true 99 valid 0 none \
    'deployment-1' 4 'deployment-1' 5 true
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
actual_order="$(tr '\n' ' ' <"${stale_before_update_dir}/order.log")"
test "${actual_order}" = \
  'main-check list-deployments auth-refresh main-check push version auth-refresh main-check '

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

for scenario in wrong-access mixed-public wrong-script wrong-manifest; do
  invalid_preflight_dir="${TEST_ROOT}/preflight-${scenario}"
  mkdir -p "${invalid_preflight_dir}"
  set +e
  (
    set -e
    run_fixture "${invalid_preflight_dir}" "${CURRENT_SHA}" "${CURRENT_SHA}" \
      'deployment-1' 'deployment-1' true false \
      "${CURRENT_SHA},${CURRENT_SHA},${CURRENT_SHA}" true 99 "${scenario}"
  ) >/dev/null 2>&1
  invalid_preflight_status=$?
  set -e
  if [[ "${invalid_preflight_status}" -eq 0 ]]; then
    printf 'An unsafe %s deployment passed preflight validation.\n' "${scenario}" >&2
    exit 1
  fi
  test ! -s "${invalid_preflight_dir}/commands.log"
done

for identity_case in deployment-id version; do
  invalid_preflight_dir="${TEST_ROOT}/preflight-wrong-${identity_case}"
  mkdir -p "${invalid_preflight_dir}"
  get_response_id='deployment-1'
  get_response_version=4
  if [[ "${identity_case}" == 'deployment-id' ]]; then
    get_response_id='deployment-2'
  else
    get_response_version=3
  fi
  set +e
  (
    set -e
    run_fixture "${invalid_preflight_dir}" "${CURRENT_SHA}" "${CURRENT_SHA}" \
      'deployment-1' 'deployment-1' true false \
      "${CURRENT_SHA},${CURRENT_SHA},${CURRENT_SHA}" true 99 valid 0 none \
      "${get_response_id}" "${get_response_version}"
  ) >/dev/null 2>&1
  invalid_preflight_status=$?
  set -e
  if [[ "${invalid_preflight_status}" -eq 0 ]]; then
    printf 'A preflight response with the wrong %s was accepted.\n' \
      "${identity_case}" >&2
    exit 1
  fi
  test ! -s "${invalid_preflight_dir}/commands.log"
done

for mutation in entry-points access script-id manifest; do
  mutated_update_dir="${TEST_ROOT}/mutated-update-${mutation}"
  mkdir -p "${mutated_update_dir}"
  set +e
  (
    set -e
    run_fixture "${mutated_update_dir}" "${CURRENT_SHA}" "${CURRENT_SHA}" \
      'deployment-1' 'deployment-1' true "${mutation}"
  ) >/dev/null 2>&1
  mutated_update_status=$?
  set -e
  if [[ "${mutated_update_status}" -eq 0 ]]; then
    printf 'A post-update %s mutation was accepted.\n' "${mutation}" >&2
    exit 1
  fi
  actual_commands="$(tr '\n' ' ' <"${mutated_update_dir}/commands.log")"
  test "${actual_commands}" = 'push version update '
done

for identity_case in deployment-id version; do
  mutated_update_dir="${TEST_ROOT}/mutated-update-${identity_case}"
  mkdir -p "${mutated_update_dir}"
  put_response_id='deployment-1'
  put_response_version=5
  if [[ "${identity_case}" == 'deployment-id' ]]; then
    put_response_id='deployment-2'
  else
    put_response_version=6
  fi
  set +e
  (
    set -e
    run_fixture "${mutated_update_dir}" "${CURRENT_SHA}" "${CURRENT_SHA}" \
      'deployment-1' 'deployment-1' true false \
      "${CURRENT_SHA},${CURRENT_SHA},${CURRENT_SHA}" true 99 valid 0 none \
      'deployment-1' 4 "${put_response_id}" "${put_response_version}"
  ) >/dev/null 2>&1
  mutated_update_status=$?
  set -e
  if [[ "${mutated_update_status}" -eq 0 ]]; then
    printf 'A post-update response with the wrong %s was accepted.\n' \
      "${identity_case}" >&2
    exit 1
  fi
  actual_commands="$(tr '\n' ' ' <"${mutated_update_dir}/commands.log")"
  test "${actual_commands}" = 'push version update '
done

missing_token_dir="${TEST_ROOT}/missing-token"
mkdir -p "${missing_token_dir}"
set +e
(
  set -e
  run_fixture "${missing_token_dir}" "${CURRENT_SHA}" "${CURRENT_SHA}" \
    'deployment-1' 'deployment-1' true false \
    "${CURRENT_SHA},${CURRENT_SHA},${CURRENT_SHA}" true 99 valid 2
) >"${missing_token_dir}/output.log" 2>&1
missing_token_status=$?
set -e
if [[ "${missing_token_status}" -eq 0 ]]; then
  printf '%s\n' 'A missing refreshed access token was accepted.' >&2
  exit 1
fi
test ! -s "${missing_token_dir}/commands.log"
grep -q 'authorization has no usable access token' "${missing_token_dir}/output.log"

curl_failure_dir="${TEST_ROOT}/curl-failure"
mkdir -p "${curl_failure_dir}"
set +e
(
  set -e
  run_fixture "${curl_failure_dir}" "${CURRENT_SHA}" "${CURRENT_SHA}" \
    'deployment-1' 'deployment-1' true false \
    "${CURRENT_SHA},${CURRENT_SHA},${CURRENT_SHA}" true 99 valid 0 GET
) >"${curl_failure_dir}/output.log" 2>&1
curl_failure_status=$?
set -e
if [[ "${curl_failure_status}" -eq 0 ]]; then
  printf '%s\n' 'A failed deployment inspection transport was accepted.' >&2
  exit 1
fi
test ! -s "${curl_failure_dir}/commands.log"
grep -q 'curl status 28' "${curl_failure_dir}/output.log"
if grep -q 'sensitive-test-token-do-not-log' "${curl_failure_dir}/output.log"; then
  printf '%s\n' 'The Apps Script access token leaked into deployment output.' >&2
  exit 1
fi

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
