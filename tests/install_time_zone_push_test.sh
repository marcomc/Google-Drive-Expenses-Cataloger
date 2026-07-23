#!/usr/bin/env bash
set -euo pipefail

TEST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

make_fixture() {
  local fixture_dir="$1"
  mkdir -p "${fixture_dir}/.installer" "${fixture_dir}/fake-bin"
  cp -R "${TEST_ROOT}/scripts" "${fixture_dir}/scripts"
  cp "${TEST_ROOT}/AGENTS.example.md" "${fixture_dir}/AGENTS.example.md"
  cp "${TEST_ROOT}/appsscript.json" "${fixture_dir}/appsscript.json"
  jq '.notification_recipient = "test@example.com" | .time_zone = "Pacific/Auckland"' \
    "${TEST_ROOT}/config.example.json" >"${fixture_dir}/config.local.json"
  jq -n '{
    projectId: "test-project",
    rootFolderId: "test-folder",
    spreadsheetId: "",
    projectName: "Test cataloger",
    geminiMode: "gemini_api_with_vertex_fallback",
    geminiSecretVersion: "projects/test-project/secrets/deleted-transfer-secret/versions/latest",
    timeZone: "Europe/Rome",
    notificationRecipient: "test@example.com",
    billingAccountId: "test-billing",
    deploymentId: "test-deployment"
  }' >"${fixture_dir}/.installer/state.json"
  cat >"${fixture_dir}/fake-bin/gcloud" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == 'auth list --filter=status:ACTIVE --format=value(account)' ]]; then
  printf '%s\n' 'test@example.com'
elif [[ "$*" == 'secrets describe deleted-transfer-secret --project=test-project' ]]; then
  if [[ "${TEST_SECRET_PROBE_FAILURE:-false}" == 'true' ]]; then
    printf '%s\n' 'ERROR: (gcloud.secrets.describe) PERMISSION_DENIED: access denied.' >&2
    exit 1
  fi
  printf '%s\n' 'ERROR: (gcloud.secrets.describe) NOT_FOUND: Secret not found.' >&2
  exit 1
elif [[ "$*" == 'secrets describe completed-transfer-secret --project=test-project' ]]; then
  printf '%s\n' 'completed installations must not probe transfer secrets' >&2
  exit 23
elif [[ "${TEST_PROVISIONING_RETRY:-false}" == 'true' ]]; then
  exit 0
fi
EOF
  cat >"${fixture_dir}/fake-bin/npx" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case " $* " in
  *' --version '*) printf '%s\n' '3.3.0' ;;
  *' create --type standalone '*) printf '%s\n' '{"scriptId":"test-script"}' >.clasp.json ;;
  *' push --force '*)
    jq -e --arg expected_time_zone "${TEST_EXPECT_TIME_ZONE:-Pacific/Auckland}" \
      '.timeZone == $expected_time_zone' appsscript.json >/dev/null
    if [[ "${TEST_PUSH_FAILURE:-false}" == 'true' ]]; then
      exit 17
    fi
    ;;
  *' --json deploy '*) printf '%s\n' '{"deploymentId":"test-deployment"}' ;;
  *' --json run bootstrapCatalogerInstallation '*)
    jq -e --arg expected_time_zone "${TEST_EXPECT_TIME_ZONE:-Pacific/Auckland}" \
      --arg expected_model "${TEST_EXPECT_MODEL-gemini-3.5-flash}" \
      '.[0].geminiSecretVersion == "" and
      .[0].reuseExistingGeminiApiKey == true and
      .[0].preserveAutomaticProcessing == true and
      .[0].geminiModel == $expected_model and
      .[0].timeZone == $expected_time_zone' <<<"${!#}" >/dev/null
    printf '%s\n' '{"response":{"installed":true}}'
    ;;
  *)
    printf 'unexpected npx invocation: %s\n' "$*" >&2
    exit 1
    ;;
esac
EOF
  chmod +x "${fixture_dir}/fake-bin/gcloud" "${fixture_dir}/fake-bin/npx"
}

assert_manifest_restored() {
  local actual_time_zone fixture_dir temporary_file
  fixture_dir="$1"
  actual_time_zone="$(jq -r '.timeZone' "${fixture_dir}/appsscript.json")"
  temporary_file="$(find "${fixture_dir}" -maxdepth 1 -name 'appsscript.*.??????' -print -quit)"
  [[ "${actual_time_zone}" == 'Europe/Rome' ]]
  [[ -z "${temporary_file}" ]]
}

assert_installer_model() {
  local actual_model expected_model fixture_dir
  fixture_dir="$1"
  expected_model="$2"
  actual_model="$(jq -r '.geminiModel // empty' "${fixture_dir}/.installer/state.json")"
  [[ "${actual_model}" == "${expected_model}" ]]
}

assert_installation_state() {
  local actual_state fixture_dir
  fixture_dir="$1"
  actual_state="$(jq -r '.installationState // empty' "${fixture_dir}/.installer/state.json")"
  [[ "${actual_state}" == 'complete' ]]
}

assert_configured_model() {
  local actual_model fixture_dir
  fixture_dir="$1"
  actual_model="$(jq -r '.gemini_model // empty' "${fixture_dir}/config.local.json")"
  [[ "${actual_model}" == 'gemini-3.6-flash' ]]
}

assert_no_configured_model() {
  local actual_model fixture_dir
  fixture_dir="$1"
  actual_model="$(jq -r '.gemini_model // empty' "${fixture_dir}/config.local.json")" || return 1
  [[ -z "${actual_model}" ]]
}

success_fixture="$(mktemp -d)"
failure_fixture="$(mktemp -d)"
migration_fixture="$(mktemp -d)"
migration_failure_fixture="$(mktemp -d)"
probe_failure_fixture="$(mktemp -d)"
complete_fixture="$(mktemp -d)"
pending_defaults_fixture="$(mktemp -d)"
trap 'rm -rf "${success_fixture}" "${failure_fixture}" "${migration_fixture}" "${migration_failure_fixture}" "${probe_failure_fixture}" "${complete_fixture}" "${pending_defaults_fixture}"' EXIT
make_fixture "${success_fixture}"
jq 'del(.gemini_model)' "${success_fixture}/config.local.json" >"${success_fixture}/config.local.migrated.json"
mv "${success_fixture}/config.local.migrated.json" "${success_fixture}/config.local.json"
(
  cd "${success_fixture}"
  PATH="${success_fixture}/fake-bin:${PATH}" TEST_EXPECT_MODEL='' ./scripts/install.sh
)
assert_manifest_restored "${success_fixture}"
assert_installer_model "${success_fixture}" ''
assert_installation_state "${success_fixture}"
assert_no_configured_model "${success_fixture}"

make_fixture "${failure_fixture}"
set +e
(
  cd "${failure_fixture}"
  PATH="${failure_fixture}/fake-bin:${PATH}" TEST_PUSH_FAILURE=true \
    ./scripts/install.sh
)
failure_status=$?
set -e
[[ "${failure_status}" -eq 17 ]]
assert_manifest_restored "${failure_fixture}"
assert_installer_model "${failure_fixture}" ''

make_fixture "${pending_defaults_fixture}"
jq '.installationState = "pending"' "${pending_defaults_fixture}/.installer/state.json" \
  >"${pending_defaults_fixture}/.installer/state.updated.json"
mv "${pending_defaults_fixture}/.installer/state.updated.json" \
  "${pending_defaults_fixture}/.installer/state.json"
set +e
(
  cd "${pending_defaults_fixture}"
  PATH="${pending_defaults_fixture}/fake-bin:${PATH}" ./scripts/install.sh --apply-defaults
) >"${pending_defaults_fixture}/output.log" 2>&1
pending_defaults_status=$?
set -e
[[ "${pending_defaults_status}" -eq 1 ]]
grep -q 'Installation is incomplete; run make install after the browser handoff.' \
  "${pending_defaults_fixture}/output.log"
assert_manifest_restored "${pending_defaults_fixture}"
assert_installer_model "${pending_defaults_fixture}" ''

make_fixture "${complete_fixture}"
jq '.installationState = "complete" |
  .geminiSecretVersion = "projects/test-project/secrets/completed-transfer-secret/versions/latest"' \
  "${complete_fixture}/.installer/state.json" >"${complete_fixture}/.installer/state.updated.json"
mv "${complete_fixture}/.installer/state.updated.json" "${complete_fixture}/.installer/state.json"
(
  cd "${complete_fixture}"
  PATH="${complete_fixture}/fake-bin:${PATH}" TEST_EXPECT_MODEL='gemini-3.6-flash' ./scripts/install.sh
)
assert_manifest_restored "${complete_fixture}"
assert_installer_model "${complete_fixture}" 'gemini-3.6-flash'
assert_installation_state "${complete_fixture}"

make_fixture "${probe_failure_fixture}"
set +e
(
  cd "${probe_failure_fixture}"
  PATH="${probe_failure_fixture}/fake-bin:${PATH}" TEST_SECRET_PROBE_FAILURE=true ./scripts/install.sh
)
probe_failure_status=$?
set -e
[[ "${probe_failure_status}" -eq 1 ]]
assert_manifest_restored "${probe_failure_fixture}"
assert_installer_model "${probe_failure_fixture}" ''

make_fixture "${migration_fixture}"
jq 'del(.gemini_model)' "${migration_fixture}/config.local.json" >"${migration_fixture}/config.local.migrated.json"
mv "${migration_fixture}/config.local.migrated.json" "${migration_fixture}/config.local.json"
(
  cd "${migration_fixture}"
  PATH="${migration_fixture}/fake-bin:${PATH}" TEST_EXPECT_MODEL='gemini-3.6-flash' \
    ./scripts/install.sh --apply-defaults
)
assert_manifest_restored "${migration_fixture}"
assert_installer_model "${migration_fixture}" 'gemini-3.6-flash'
assert_installation_state "${migration_fixture}"
assert_configured_model "${migration_fixture}"

make_fixture "${migration_failure_fixture}"
jq 'del(.gemini_model)' "${migration_failure_fixture}/config.local.json" >"${migration_failure_fixture}/config.local.migrated.json"
mv "${migration_failure_fixture}/config.local.migrated.json" "${migration_failure_fixture}/config.local.json"
set +e
(
  cd "${migration_failure_fixture}"
  PATH="${migration_failure_fixture}/fake-bin:${PATH}" TEST_PUSH_FAILURE=true \
    ./scripts/install.sh --apply-defaults
)
migration_failure_status=$?
set -e
[[ "${migration_failure_status}" -eq 17 ]]
assert_manifest_restored "${migration_failure_fixture}"
assert_installer_model "${migration_failure_fixture}" ''
assert_no_configured_model "${migration_failure_fixture}"

printf 'installer reconciliation tests passed\n'
