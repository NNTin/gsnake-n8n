# Git Hooks for gsnake-n8n

This directory contains shared git hooks for the gsnake-n8n repository.

## Enabling Hooks

To enable these hooks, run from the gsnake-n8n directory:

```bash
git config core.hooksPath .github/hooks
```

## Verification

Verify that hooks are enabled:

```bash
git config core.hooksPath
```

This should output: `.github/hooks`

## Disabling Hooks

To disable the hooks and revert to default behavior:

```bash
git config --unset core.hooksPath
```

## Available Hooks

### pre-commit

The pre-commit hook runs the following checks:

1. **Secret Scan**:
   - Fails if `.env` is tracked by git
   - Scans tracked files in the working tree for exact matches of `.env` values
   - Reports only `KEY` + `file:line` without printing secret values
   - Optional allowlist file: `.github/hooks/env-key-allowlist.txt` (one key per line)

**Note:** If `.env` is missing, the secret scan passes silently.
