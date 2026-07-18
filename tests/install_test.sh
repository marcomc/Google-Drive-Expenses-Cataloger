#!/usr/bin/env bash
set -euo pipefail

TEST_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/install-common.sh
source "${TEST_ROOT}/scripts/lib/install-common.sh"

spreadsheet_id="$(extract_google_resource_id 'https://docs.google.com/spreadsheets/d/abcDEF_123456/edit')"
folder_id="$(extract_google_resource_id 'https://drive.google.com/drive/folders/abcDEF_123456')"
[[ "${spreadsheet_id}" == 'abcDEF_123456' ]]
[[ "${folder_id}" == 'abcDEF_123456' ]]
is_supported_locale en
is_supported_locale it
# shellcheck disable=SC2310 # The predicate's nonzero status is the behavior under test.
if is_supported_locale fr; then exit 1; fi
is_valid_gemini_mode gemini_api_with_vertex_fallback
# shellcheck disable=SC2310 # The predicate's nonzero status is the behavior under test.
if is_valid_gemini_mode invalid; then exit 1; fi
is_valid_email test@example.com
# shellcheck disable=SC2310 # The predicate's nonzero status is the behavior under test.
if is_valid_email invalid; then exit 1; fi
is_valid_time_zone Europe/Rome
# shellcheck disable=SC2310 # The predicate's nonzero status is the behavior under test.
if is_valid_time_zone Invalid/Timezone; then exit 1; fi

printf 'installer helper tests passed\n'
