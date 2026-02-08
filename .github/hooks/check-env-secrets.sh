#!/bin/sh
# Validate that .env secrets are not versioned in tracked files.
# - Silently passes if .env does not exist.
# - Fails if .env is tracked by git.
# - Scans tracked working-tree files for exact .env value matches.
# - Supports optional allowlist file with non-secret keys.

set -eu

ENV_FILE=".env"
ALLOWLIST_FILE=".github/hooks/env-key-allowlist.txt"
MATCHES_FILE="$(mktemp)"
trap 'rm -f "$MATCHES_FILE"' EXIT

is_key_allowlisted() {
    key="$1"
    if [ ! -f "$ALLOWLIST_FILE" ]; then
        return 1
    fi

    while IFS= read -r allowlisted_key || [ -n "$allowlisted_key" ]; do
        allowlisted_key="$(printf '%s' "$allowlisted_key" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
        case "$allowlisted_key" in
            "" | \#*) continue ;;
        esac
        if [ "$allowlisted_key" = "$key" ]; then
            return 0
        fi
    done < "$ALLOWLIST_FILE"

    return 1
}

parse_env_value() {
    value_input="$1"

    # Trim leading/trailing whitespace first.
    value="$(printf '%s' "$value_input" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"

    case "$value" in
        \"*\")
            value="${value#\"}"
            value="${value%\"}"
            ;;
        \'*\')
            value="${value#\'}"
            value="${value%\'}"
            ;;
        *)
            # Strip inline comments for unquoted values.
            value="$(printf '%s' "$value" | sed 's/[[:space:]]#.*$//; s/[[:space:]]*$//')"
            ;;
    esac

    printf '%s' "$value"
}

if [ ! -f "$ENV_FILE" ]; then
    exit 0
fi

if git ls-files --error-unmatch -- "$ENV_FILE" >/dev/null 2>&1; then
    echo "Error: Git versioning secrets is disallowed."
    echo "Tracked file detected: $ENV_FILE"
    echo "Remove it from version control (for current index: git rm --cached $ENV_FILE)."
    exit 1
fi

while IFS= read -r raw_line || [ -n "$raw_line" ]; do
    line="$(printf '%s' "$raw_line" | sed 's/\r$//; s/^[[:space:]]*//')"

    case "$line" in
        "" | \#*) continue ;;
    esac

    case "$line" in
        export[[:space:]]*)
            line="$(printf '%s' "$line" | sed 's/^export[[:space:]]*//')"
            ;;
    esac

    case "$line" in
        *=*) ;;
        *) continue ;;
    esac

    key="$(printf '%s' "${line%%=*}" | sed 's/[[:space:]]*$//')"
    if ! printf '%s' "$key" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]*$'; then
        continue
    fi

    if is_key_allowlisted "$key"; then
        continue
    fi

    value="$(parse_env_value "${line#*=}")"
    if [ -z "$value" ]; then
        continue
    fi

    # Search tracked files in the working tree only.
    raw_matches="$(git grep -n -I -F -- "$value" -- . \
        ':(exclude).env' \
        ':(exclude).github/hooks/env-key-allowlist.txt' 2>/dev/null || true)"
    if [ -z "$raw_matches" ]; then
        continue
    fi

    printf '%s\n' "$raw_matches" | while IFS= read -r match_line || [ -n "$match_line" ]; do
        file_path="${match_line%%:*}"
        remainder="${match_line#*:}"
        line_number="${remainder%%:*}"
        printf '%s %s:%s\n' "$key" "$file_path" "$line_number" >> "$MATCHES_FILE"
    done
done < "$ENV_FILE"

if [ -s "$MATCHES_FILE" ]; then
    echo "Error: Git versioning secrets is disallowed."
    echo "Detected .env values in tracked files:"
    sort -u "$MATCHES_FILE" | while IFS= read -r finding || [ -n "$finding" ]; do
        finding_key="${finding%% *}"
        finding_location="${finding#* }"
        echo "  - ${finding_key}: ${finding_location}"
    done
    echo "If a variable is not a secret, add its KEY to $ALLOWLIST_FILE (one key per line)."
    exit 1
fi
