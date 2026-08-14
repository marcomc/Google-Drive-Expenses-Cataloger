#!/usr/bin/env bash

# Install one private Google Drive Expenses Cataloger instance. It never writes
# credentials to Git or to local installer state.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly PROJECT_ROOT
readonly STATE_DIR="${PROJECT_ROOT}/.installer"
readonly STATE_FILE="${STATE_DIR}/state.json"
readonly CONFIG_FILE="${PROJECT_ROOT}/config.local.json"
readonly CLASP=(npx --yes @google/clasp@3.3.0)
readonly DEFAULT_GEMINI_MODEL='gemini-3.7-flash'

# shellcheck source=lib/install-common.sh
source "${PROJECT_ROOT}/scripts/lib/install-common.sh"

MODE='install'

info() { printf 'INFO: %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

state_set() {
  local key="$1"
  local value="$2"
  local temporary_file
  mkdir -p "${STATE_DIR}"
  [[ -f "${STATE_FILE}" ]] || printf '%s\n' '{}' >"${STATE_FILE}"
  temporary_file="$(mktemp "${STATE_DIR}/state.XXXXXX")"
  jq --arg key "${key}" --arg value "${value}" '.[$key] = $value' "${STATE_FILE}" >"${temporary_file}"
  mv "${temporary_file}" "${STATE_FILE}"
}

state_get() {
  jq -er "$1" "${STATE_FILE}"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

install_check() {
  require_command bash
  require_command gcloud
  require_command jq
  require_command node
  require_command npx
  "${CLASP[@]}" --version >/dev/null
  gcloud auth list --filter='status:ACTIVE' --format='value(account)' | grep -q . || \
    die 'No active gcloud account. Run gcloud auth login first.'
  info 'Local and Google account preflight passed.'
}

ensure_local_config() {
  local locale recipient
  if [[ ! -f "${CONFIG_FILE}" ]]; then
    cp "${PROJECT_ROOT}/config.example.json" "${CONFIG_FILE}"
    die "Created config.local.json; replace its placeholders, then rerun."
  fi
  jq empty "${CONFIG_FILE}" >/dev/null || die 'config.local.json is invalid JSON.'
  locale="$(jq -r '.locale // empty' "${CONFIG_FILE}")"
  recipient="$(jq -r '.notification_recipient // empty' "${CONFIG_FILE}")"
  # shellcheck disable=SC2310 # Predicate functions intentionally signal invalid input with nonzero status.
  is_supported_locale "${locale}" || die 'config.local.json locale must be en or it.'
  # shellcheck disable=SC2310 # Predicate functions intentionally signal invalid input with nonzero status.
  is_valid_email "${recipient}" || die 'config.local.json requires notification_recipient.'
}

prompt_if_empty() {
  local variable_name="$1"
  local label="$2"
  local value
  if [[ -z "${!variable_name:-}" ]]; then
    read -r -p "${label}: " value
    printf -v "${variable_name}" '%s' "${value}"
  fi
}

collect_settings() {
  local recipient
  local root_folder_id
  local spreadsheet_id
  local configured_time_zone configured_gemini_model
  ensure_local_config
  : "${GDEC_PROJECT_NAME:=Google Drive Expenses Cataloger}"
  : "${GDEC_GEMINI_MODE:=gemini_api_with_vertex_fallback}"
  configured_time_zone="$(jq -r '.time_zone // empty' "${CONFIG_FILE}")"
  configured_gemini_model="$(jq -r '.gemini_model // empty' "${CONFIG_FILE}")"
  : "${GDEC_TIME_ZONE:=${configured_time_zone:-Europe/Rome}}"
  : "${GDEC_GEMINI_MODEL:=${configured_gemini_model:-${DEFAULT_GEMINI_MODEL}}}"
  recipient="$(jq -r '.notification_recipient' "${CONFIG_FILE}")"
  : "${GDEC_NOTIFICATION_RECIPIENT:=${recipient}}"
  : "${GDEC_ROOT_FOLDER:=}"
  : "${GDEC_PROJECT_ID:=}"
  : "${GDEC_SPREADSHEET:=}"
  : "${GDEC_BILLING_ACCOUNT_ID:=}"
  prompt_if_empty GDEC_PROJECT_ID 'Cloud project ID'
  prompt_if_empty GDEC_ROOT_FOLDER 'Drive root folder URL or ID'
  prompt_if_empty GDEC_BILLING_ACCOUNT_ID \
    'Open billing account ID for the cataloger Cloud project'
  # shellcheck disable=SC2310 # Predicate functions intentionally signal invalid input with nonzero status.
  is_valid_gemini_mode "${GDEC_GEMINI_MODE}" || die 'Invalid GDEC_GEMINI_MODE.'
  # shellcheck disable=SC2310 # Predicate functions intentionally signal invalid input with nonzero status.
  is_valid_time_zone "${GDEC_TIME_ZONE}" || die 'Invalid GDEC_TIME_ZONE.'
  # shellcheck disable=SC2310 # Predicate functions intentionally signal invalid input with nonzero status.
  is_valid_email "${GDEC_NOTIFICATION_RECIPIENT}" || die 'Invalid notification recipient.'
  root_folder_id="$(extract_google_resource_id "${GDEC_ROOT_FOLDER}")"
  spreadsheet_id=''
  if [[ -n "${GDEC_SPREADSHEET}" ]]; then
    spreadsheet_id="$(extract_google_resource_id "${GDEC_SPREADSHEET}")"
  fi
  state_set projectId "${GDEC_PROJECT_ID}"
  state_set rootFolderId "${root_folder_id}"
  state_set spreadsheetId "${spreadsheet_id}"
  state_set projectName "${GDEC_PROJECT_NAME}"
  state_set geminiMode "${GDEC_GEMINI_MODE}"
  state_set timeZone "${GDEC_TIME_ZONE}"
  state_set notificationRecipient "${GDEC_NOTIFICATION_RECIPIENT}"
  state_set geminiModel "${GDEC_GEMINI_MODEL}"
  state_set billingAccountId "${GDEC_BILLING_ACCOUNT_ID#billingAccounts/}"
  state_set installationState 'provisioning'
}

push_script_with_configured_time_zone() (
  local time_zone manifest_backup manifest_tmp
  time_zone="${1:-$(state_get '.timeZone')}"
  manifest_backup="$(mktemp "${PROJECT_ROOT}/appsscript.backup.XXXXXX")"
  manifest_tmp="$(mktemp "${PROJECT_ROOT}/appsscript.XXXXXX")"
  if ! cp "${PROJECT_ROOT}/appsscript.json" "${manifest_backup}"; then
    rm -f "${manifest_backup}" "${manifest_tmp}"
    return 1
  fi
  # shellcheck disable=SC2154 # command_status is assigned when the EXIT trap executes.
  trap '
    command_status=$?
    rm -f "${manifest_tmp}"
    if [[ -f "${manifest_backup}" ]]; then
      mv "${manifest_backup}" "${PROJECT_ROOT}/appsscript.json" || exit 1
    fi
    exit "${command_status}"
  ' EXIT
  jq --arg time_zone "${time_zone}" '.timeZone = $time_zone' \
    "${PROJECT_ROOT}/appsscript.json" >"${manifest_tmp}"
  mv "${manifest_tmp}" "${PROJECT_ROOT}/appsscript.json"
  (
    cd "${PROJECT_ROOT}"
    "${CLASP[@]}" push --force
  )
)

ensure_cloud_project() {
  local project_id
  local project_name
  local billing_account_id
  project_id="$(state_get '.projectId')"
  project_name="$(state_get '.projectName')"
  billing_account_id="$(state_get '.billingAccountId')"
  if ! gcloud projects describe "${project_id}" >/dev/null 2>&1; then
    gcloud projects create "${project_id}" --name="${project_name}"
  fi
  gcloud billing projects link "${project_id}" \
    --billing-account="${billing_account_id}"
  gcloud config set project "${project_id}" >/dev/null
  gcloud services enable --project="${project_id}" aiplatform.googleapis.com \
    secretmanager.googleapis.com script.googleapis.com drive.googleapis.com sheets.googleapis.com
}

create_gemini_api_key() {
  local mode key key_project key_resource
  mode="$(state_get '.geminiMode')"
  [[ "${mode}" == 'vertex_ai' ]] && return
  : "${GDEC_GEMINI_PROJECT_ID:=}"
  prompt_if_empty GDEC_GEMINI_PROJECT_ID 'Gemini Free Tier Google Cloud project ID'
  key_project="${GDEC_GEMINI_PROJECT_ID}"
  gcloud services enable --project="${key_project}" apikeys.googleapis.com generativelanguage.googleapis.com
  key="${GDEC_GEMINI_API_KEY:-}"
  if [[ -z "${key}" ]]; then
    key_resource="${GDEC_GEMINI_KEY_RESOURCE:-}"
    if [[ -z "${key_resource}" ]]; then
      gcloud services api-keys create --project="${key_project}" \
        --display-name='drive-expenses-cataloger-gemini' \
        --api-target=service=generativelanguage.googleapis.com --quiet >/dev/null 2>&1
      key_resource="$(gcloud services api-keys list --project="${key_project}" \
        --filter='displayName="drive-expenses-cataloger-gemini"' \
        --format='value(name)' | head -n1)"
    fi
    [[ -n "${key_resource}" ]] || die 'Could not create a Gemini API key resource.'
    info "Gemini API key resource: ${key_resource}"
    info "To copy it to Bitwarden: gcloud services api-keys get-key-string ${key_resource}"
    key="$(gcloud services api-keys get-key-string "${key_resource}" \
      --project="${key_project}" --format='value(keyString)')"
  fi
  [[ -n "${key}" ]] || die 'Could not retrieve a Gemini API key.'
  GEMINI_API_KEY_VALUE="${key}"
}

create_and_push_script() {
  local project_name
  project_name="$(state_get '.projectName')"
  if [[ ! -f "${PROJECT_ROOT}/.clasp.json" ]]; then
    (
      cd "${PROJECT_ROOT}"
      "${CLASP[@]}" create --type standalone --title="${project_name}"
    )
  fi
  push_script_with_configured_time_zone
}

ensure_api_executable_deployment() {
  local deployment_id
  local deployment_output
  deployment_id="$(jq -r '.deploymentId // empty' "${STATE_FILE}")"
  if [[ -n "${deployment_id}" ]]; then
    deployment_output="$(
      cd "${PROJECT_ROOT}"
      "${CLASP[@]}" --json deploy --deploymentId="${deployment_id}" \
        --description='Owner-only expenses cataloger bootstrap'
    )" || die 'Could not update the Apps Script API executable deployment.'
  else
    deployment_output="$(
      cd "${PROJECT_ROOT}"
      "${CLASP[@]}" --json deploy --description='Owner-only expenses cataloger bootstrap'
    )" || die 'Could not create the Apps Script API executable deployment.'
    deployment_id="$(printf '%s' "${deployment_output}" | jq -r '.deploymentId // empty')"
    [[ -n "${deployment_id}" ]] || die 'Could not identify the Apps Script API deployment.'
    state_set deploymentId "${deployment_id}"
  fi
}

transfer_gemini_key() {
  local mode project_id script_id secret_id account
  mode="$(state_get '.geminiMode')"
  [[ "${mode}" == 'vertex_ai' ]] && return
  [[ -n "${GEMINI_API_KEY_VALUE:-}" ]] || die 'Gemini key is not available for transfer.'
  project_id="$(state_get '.projectId')"
  script_id="$(jq -r '.scriptId' "${PROJECT_ROOT}/.clasp.json")"
  secret_id="drive-expenses-cataloger-${script_id}"
  account="$(gcloud auth list --filter='status:ACTIVE' --format='value(account)' | head -n1)"
  gcloud secrets describe "${secret_id}" --project="${project_id}" >/dev/null 2>&1 || \
    gcloud secrets create "${secret_id}" --project="${project_id}" --replication-policy='automatic'
  gcloud projects add-iam-policy-binding "${project_id}" --member="user:${account}" \
    --role='roles/secretmanager.secretAccessor' --quiet >/dev/null
  printf '%s' "${GEMINI_API_KEY_VALUE}" | gcloud secrets versions add "${secret_id}" \
    --project="${project_id}" --data-file=- >/dev/null
  state_set geminiSecretVersion "projects/${project_id}/secrets/${secret_id}/versions/latest"
  unset GEMINI_API_KEY_VALUE
}

run_bootstrap() {
  local options parameters secret_version mode project_id root_folder_id spreadsheet_id
  local notification_recipient time_zone config_json gemini_backend gemini_model auto_vertex_fallback
  local bootstrap_output bootstrap_status preserve_automatic_processing reuse_existing_gemini_api_key
  [[ -f "${STATE_FILE}" ]] || die 'No resumable installer state exists.'
  reuse_existing_gemini_api_key="${1:-false}"
  preserve_automatic_processing="${2:-false}"
  [[ "${reuse_existing_gemini_api_key}" == 'true' || \
    "${reuse_existing_gemini_api_key}" == 'false' ]] || die 'Invalid Gemini credential reuse mode.'
  [[ "${preserve_automatic_processing}" == 'true' || \
    "${preserve_automatic_processing}" == 'false' ]] || die 'Invalid automatic processing preservation mode.'
  mode="$(state_get '.geminiMode')"
  secret_version=''
  if [[ "${mode}" != 'vertex_ai' && "${reuse_existing_gemini_api_key}" != 'true' ]]; then
    secret_version="$(state_get '.geminiSecretVersion')"
  fi
  project_id="$(state_get '.projectId')"
  root_folder_id="$(state_get '.rootFolderId')"
  spreadsheet_id="$(state_get '.spreadsheetId')"
  notification_recipient="$(state_get '.notificationRecipient')"
  if [[ "$#" -ge 3 ]]; then
    gemini_model="$3"
  else
    gemini_model="$(state_get ".geminiModel // \"${DEFAULT_GEMINI_MODEL}\"")"
  fi
  time_zone="${4:-$(state_get '.timeZone')}"
  config_json="$(jq --arg time_zone "${time_zone}" '.time_zone = $time_zone' "${CONFIG_FILE}")"
  gemini_backend='gemini_api'
  auto_vertex_fallback='false'
  if [[ "${mode}" == 'vertex_ai' ]]; then
    gemini_backend='vertex_ai'
  elif [[ "${mode}" == 'gemini_api_with_vertex_fallback' ]]; then
    auto_vertex_fallback='true'
  fi
  options="$(jq -cn \
    --arg projectId "${project_id}" \
    --arg rootFolderId "${root_folder_id}" \
    --arg spreadsheetId "${spreadsheet_id}" \
    --arg spreadsheetTitle 'HoStello - Spese' \
    --arg notificationRecipient "${notification_recipient}" \
    --arg geminiBackend "${gemini_backend}" \
    --arg geminiModel "${gemini_model}" \
    --arg vertexLocation 'global' \
    --arg geminiSecretVersion "${secret_version}" \
    --arg agentsPolicy "$(<"${PROJECT_ROOT}/AGENTS.example.md")" \
    --arg timeZone "${time_zone}" \
    --argjson automationConfig "${config_json}" \
    --argjson reuseExistingGeminiApiKey "${reuse_existing_gemini_api_key}" \
    --argjson preserveAutomaticProcessing "${preserve_automatic_processing}" \
    --argjson autoVertexFallback "${auto_vertex_fallback}" \
    '{projectId:$projectId,rootFolderId:$rootFolderId,spreadsheetId:$spreadsheetId,spreadsheetTitle:$spreadsheetTitle,notificationRecipient:$notificationRecipient,geminiBackend:$geminiBackend,geminiModel:$geminiModel,vertexLocation:$vertexLocation,geminiSecretVersion:$geminiSecretVersion,agentsPolicy:$agentsPolicy,timeZone:$timeZone,automationConfig:$automationConfig,reuseExistingGeminiApiKey:$reuseExistingGeminiApiKey,preserveAutomaticProcessing:$preserveAutomaticProcessing,autoVertexFallback:$autoVertexFallback}')"
  parameters="$(jq -cn --argjson options "${options}" '[ $options ]')"
  push_script_with_configured_time_zone "${time_zone}"
  ensure_api_executable_deployment
  set +e
  bootstrap_output="$(
    cd "${PROJECT_ROOT}"
    "${CLASP[@]}" --json run bootstrapCatalogerInstallation --params "${parameters}" 2>&1
  )"
  bootstrap_status=$?
  set -e
  if [[ "${bootstrap_status}" -ne 0 ]] || ! printf '%s' "${bootstrap_output}" |
    jq -e '.response.installed == true' >/dev/null 2>&1; then
    printf '%s\n' "${bootstrap_output}" >&2
    die 'Apps Script bootstrap failed; the temporary Gemini secret was retained for retry.'
  fi
}

get_desired_settings() {
  local configured_time_zone configured_gemini_model legacy_gemini_model
  ensure_local_config
  configured_time_zone="$(jq -r '.time_zone // empty' "${CONFIG_FILE}")"
  configured_gemini_model="$(jq -r '.gemini_model // empty' "${CONFIG_FILE}")"
  : "${GDEC_TIME_ZONE:=${configured_time_zone:-Europe/Rome}}"
  legacy_gemini_model="$(jq -r '.geminiModel // empty' "${STATE_FILE}")"
  : "${GDEC_GEMINI_MODEL:=${configured_gemini_model:-${legacy_gemini_model:-${DEFAULT_GEMINI_MODEL}}}}"
  # shellcheck disable=SC2310 # Predicate functions intentionally signal invalid input with nonzero status.
  is_valid_time_zone "${GDEC_TIME_ZONE}" || die 'Invalid GDEC_TIME_ZONE.'
}

set_configured_gemini_model() {
  local gemini_model="$1"
  local temporary_file
  temporary_file="$(mktemp "${PROJECT_ROOT}/config.local.XXXXXX")"
  jq --arg gemini_model "${gemini_model}" '.gemini_model = $gemini_model' \
    "${CONFIG_FILE}" >"${temporary_file}"
  mv "${temporary_file}" "${CONFIG_FILE}"
}

installation_needs_resume() {
  local deployment_id gemini_secret_version installation_state mode project_id secret_name
  local secret_probe secret_probe_status
  installation_state="$(jq -r '.installationState // empty' "${STATE_FILE}")" ||
    die 'Installer state is invalid.'
  [[ "${installation_state}" == 'complete' ]] && return 1
  mode="$(state_get '.geminiMode')"
  deployment_id="$(jq -r '.deploymentId // empty' "${STATE_FILE}")"
  [[ "${mode}" == 'vertex_ai' ]] && [[ -z "${deployment_id}" ]] && return 0
  gemini_secret_version="$(jq -r '.geminiSecretVersion // empty' "${STATE_FILE}")"
  [[ -n "${gemini_secret_version}" ]] || return 1
  project_id="$(state_get '.projectId')"
  secret_name="${gemini_secret_version%/versions/*}"
  set +e
  secret_probe="$(gcloud secrets describe "${secret_name##*/}" --project="${project_id}" 2>&1)"
  secret_probe_status=$?
  set -e
  [[ "${secret_probe_status}" -eq 0 ]] && return 0
  if [[ "${secret_probe}" == *'NOT_FOUND'* || "${secret_probe}" == *'not found'* ]]; then
    return 1
  fi
  printf '%s\n' "${secret_probe}" >&2
  die 'Could not determine whether the temporary Gemini secret is still available.'
}

installation_needs_provisioning() {
  local gemini_secret_version installation_state mode
  installation_state="$(jq -r '.installationState // empty' "${STATE_FILE}")" ||
    die 'Installer state is invalid.'
  if [[ "${installation_state}" == 'provisioning' ]]; then
    gemini_secret_version="$(jq -r '.geminiSecretVersion // empty' "${STATE_FILE}")"
    [[ -z "${gemini_secret_version}" ]]
    return
  fi
  [[ "${installation_state}" == 'pending' ]] || return 1
  mode="$(state_get '.geminiMode')"
  [[ "${mode}" == 'vertex_ai' ]] && return 1
  gemini_secret_version="$(jq -r '.geminiSecretVersion // empty' "${STATE_FILE}")"
  [[ -z "${gemini_secret_version}" ]]
}

provision_initial_installation() {
  ensure_cloud_project
  create_gemini_api_key
  create_and_push_script
  transfer_gemini_key
  state_set installationState 'pending'
  info 'Source was pushed. Complete the clasp browser authorization, then rerun make install.'
}

reconcile_installation() {
  [[ -f "${STATE_FILE}" ]] || die 'No existing installer state exists.'
  get_desired_settings
  run_bootstrap true true "${GDEC_GEMINI_MODEL}" "${GDEC_TIME_ZONE}"
  state_set timeZone "${GDEC_TIME_ZONE}"
  if [[ -n "${GDEC_GEMINI_MODEL}" ]]; then
    state_set geminiModel "${GDEC_GEMINI_MODEL}"
  fi
  state_set installationState 'complete'
  info "Installation reconciled with Gemini model ${GDEC_GEMINI_MODEL} and timezone ${GDEC_TIME_ZONE}."
}

require_completed_installation() {
  local installation_state
  installation_state="$(jq -r '.installationState // empty' "${STATE_FILE}")" ||
    die 'Installer state is invalid.'
  if [[ "${installation_state}" == 'pending' || "${installation_state}" == 'provisioning' ]]; then
    die 'Installation is incomplete; run make install after the browser handoff.'
  fi
  # shellcheck disable=SC2310 # This predicate distinguishes resumable and completed installations.
  if installation_needs_resume; then
    die 'Installation is incomplete; run make install after the browser handoff.'
  fi
}

apply_installer_defaults() {
  [[ -f "${STATE_FILE}" ]] || die 'No existing installer state exists.'
  require_completed_installation
  get_desired_settings
  run_bootstrap true true "${DEFAULT_GEMINI_MODEL}" "${GDEC_TIME_ZONE}"
  state_set timeZone "${GDEC_TIME_ZONE}"
  state_set geminiModel "${DEFAULT_GEMINI_MODEL}"
  state_set installationState 'complete'
  set_configured_gemini_model "${DEFAULT_GEMINI_MODEL}"
  info 'Current installer defaults were applied successfully.'
}

remove_transfer_secret() {
  local secret_version secret_name project_id
  [[ -f "${STATE_FILE}" ]] || return
  secret_version="$(jq -r '.geminiSecretVersion // empty' "${STATE_FILE}")"
  [[ -n "${secret_version}" ]] || return
  project_id="$(state_get '.projectId')"
  secret_name="${secret_version%/versions/*}"
  gcloud secrets delete "${secret_name##*/}" --project="${project_id}" --quiet
  state_set geminiSecretVersion ''
}

reset_state() {
  rm -rf "${STATE_DIR}"
  rm -f "${PROJECT_ROOT}/.clasp.json"
  info 'Removed local installer state; remote Google resources remain unchanged.'
}

main() {
  case "${MODE}" in
    check) install_check; return ;;
    reset) reset_state; return ;;
    apply-defaults)
      install_check
      apply_installer_defaults
      return
      ;;
    install) ;;
    *) die 'Unsupported mode.' ;;
  esac
  install_check
  if [[ -f "${STATE_FILE}" ]]; then
    # shellcheck disable=SC2310 # This predicate distinguishes interrupted provisioning from browser-handoff resume.
    if installation_needs_provisioning; then
      provision_initial_installation
      return
    fi
    # shellcheck disable=SC2310 # This predicate distinguishes resumable and completed installations.
    if installation_needs_resume; then
      get_desired_settings
      run_bootstrap false false "${GDEC_GEMINI_MODEL}" "${GDEC_TIME_ZONE}"
      remove_transfer_secret
      state_set timeZone "${GDEC_TIME_ZONE}"
      if [[ -n "${GDEC_GEMINI_MODEL}" ]]; then
        state_set geminiModel "${GDEC_GEMINI_MODEL}"
      fi
      state_set installationState 'complete'
      info 'Installation resumed and completed. The Gemini API key remains only in Bitwarden and Script Properties.'
    else
      reconcile_installation
    fi
    return
  fi
  collect_settings
  provision_initial_installation
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) MODE='check' ;;
    --apply-defaults) MODE='apply-defaults' ;;
    --reset) MODE='reset' ;;
    --debug) ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
done

main
