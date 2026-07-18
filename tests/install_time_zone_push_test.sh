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
    geminiMode: "vertex_ai",
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
fi
EOF
  cat >"${fixture_dir}/fake-bin/npx" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case " $* " in
  *' --version '*) printf '%s\n' '3.3.0' ;;
  *' push --force '*)
    jq -e '.timeZone == "Pacific/Auckland"' appsscript.json >/dev/null
    if [[ "${TEST_PUSH_FAILURE:-false}" == 'true' ]]; then
      exit 17
    fi
    ;;
  *' --json deploy '*) printf '%s\n' '{"deploymentId":"test-deployment"}' ;;
  *' --json run bootstrapCatalogerInstallation '*)
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

success_fixture="$(mktemp -d)"
failure_fixture="$(mktemp -d)"
trap 'rm -rf "${success_fixture}" "${failure_fixture}"' EXIT
make_fixture "${success_fixture}"
(
  cd "${success_fixture}"
  PATH="${success_fixture}/fake-bin:${PATH}" ./scripts/install.sh --reconfigure-time-zone
)
assert_manifest_restored "${success_fixture}"

make_fixture "${failure_fixture}"
set +e
(
  cd "${failure_fixture}"
  PATH="${failure_fixture}/fake-bin:${PATH}" TEST_PUSH_FAILURE=true \
    ./scripts/install.sh --reconfigure-time-zone
)
failure_status=$?
set -e
[[ "${failure_status}" -eq 17 ]]
assert_manifest_restored "${failure_fixture}"

printf 'installer timezone push tests passed\n'
