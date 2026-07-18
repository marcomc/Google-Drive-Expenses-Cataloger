#!/usr/bin/env bash

# Shared side-effect-free helpers for the installer and its tests.

extract_google_resource_id() {
  local input_value="${1:-}"
  if [[ "${input_value}" =~ /d/([^/?]+) || "${input_value}" =~ folders/([^/?]+) || \
    "${input_value}" =~ open\?id=([^&]+) ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
  elif [[ "${input_value}" =~ ^[A-Za-z0-9_-]{10,}$ ]]; then
    printf '%s\n' "${input_value}"
  else
    return 1
  fi
}

is_supported_locale() {
  [[ "${1:-}" == 'en' || "${1:-}" == 'it' ]]
}

is_valid_gemini_mode() {
  case "${1:-}" in
    gemini_api|vertex_ai|gemini_api_with_vertex_fallback) return 0 ;;
    *) return 1 ;;
  esac
}

is_valid_email() {
  [[ "${1:-}" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]
}

is_valid_time_zone() {
  local time_zone="${1:-}"
  node -e '
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: process.argv[1] }).format();
    } catch (error) {
      process.exit(1);
    }
  ' "${time_zone}" >/dev/null 2>&1
}
