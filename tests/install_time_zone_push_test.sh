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
  exit 1
fi
EOF
  cat >"${fixture_dir}/fake-bin/npx" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case " $* " in
  *' --version '*) printf '%s\n' '3.3.0' ;;
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
      --arg expected_model "${TEST_EXPECT_MODEL:-gemini-3.5-flash}" \
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

success_fixture="$(mktemp -d)"
failure_fixture="$(mktemp -d)"
trap 'rm -rf "${success_fixture}" "${failure_fixture}"' EXIT
make_fixture "${success_fixture}"
jq 'del(.gemini_model)' "${success_fixture}/config.local.json" >"${success_fixture}/config.local.migrated.json"
mv "${success_fixture}/config.local.migrated.json" "${success_fixture}/config.local.json"
(
  cd "${success_fixture}"
  PATH="${success_fixture}/fake-bin:${PATH}" TEST_EXPECT_MODEL='gemini-3.6-flash' ./scripts/install.sh
)
assert_manifest_restored "${success_fixture}"
assert_installer_model "${success_fixture}" 'gemini-3.6-flash'
assert_installation_state "${success_fixture}"
assert_configured_model "${success_fixture}"

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

printf 'installer reconciliation tests passed\n'
