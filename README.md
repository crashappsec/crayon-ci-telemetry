# Crash Override CI Telemetry Action

This repository is the public GitHub Action package for Wax CI/CD telemetry.
It must not vendor private Wax source. The action downloads a verified Linux CI
runtime bundle, starts the Wax CI service as the runner user, starts the Linux
CI sensor stub with `sudo --non-interactive`, and stops both processes from the
post step.

## Status

`v1` is the first tagged version: `uses: crashappsec/crayon-ci-telemetry@v1`.
For a stricter pin, use the full SHA of a commit on `main`
(`git ls-remote https://github.com/crashappsec/crayon-ci-telemetry refs/heads/main`
prints the newest one).

The action cannot deliver telemetry yet. Gatekeeper has no GitHub Actions OIDC
sign-in for CI telemetry, so the main step fails at the token exchange and says
so. Sign-in with an organization API key is in progress in
[#2](https://github.com/crashappsec/crayon-ci-telemetry/pull/2).

## Customer Workflow

```yaml
name: CI With Crash Override Telemetry

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: crashappsec/crayon-ci-telemetry@v1
        with:
          gatekeeper-base: https://api.gatekeeper.crashoverride.run
        env:
          CRASHOVERRIDE_TELEMETRY_BACKUP_PUBLIC_KEY: ${{ vars.CRASHOVERRIDE_TELEMETRY_BACKUP_PUBLIC_KEY }}

      - run: npm ci
      - run: npm test
      - run: npm run build
```

## Inputs

`gatekeeper-base` points at Gatekeeper. `token-exchange-path` defaults to
`/v1/token/exchange`. `oidc-audience` defaults to `gatekeeper-base`.

`runtime-url`, `runtime-sha256`, `runtime-signature-url`, and
`runtime-signing-identity` are development overrides. In normal customer use,
Gatekeeper returns runtime metadata in the CI ingest credential response.

`allow-unsigned-runtime` is for fake local dry runs only. Release validation
must leave it false.

`dry-run` performs OIDC exchange and runtime metadata validation without
starting the Wax CI service or Linux CI sensor stub.

## Environment

`CRASHOVERRIDE_TELEMETRY_BACKUP_PUBLIC_KEY` is optional. When absent, the post
step skips backup upload if undelivered telemetry remains. Plaintext backup
upload is never allowed.

## Saved State

The main script saves these state keys for the post script:

- `ci_session_id`
- `run_root`
- `runtime_dir`
- `credential_path`
- `control_socket`
- `provider_socket`
- `journal_path`
- `service_pid`
- `sensor_sudo_pid`
- `sensor_pid_file`

## Summary Output

The main step reports OIDC exchange, runtime verification, and process startup
state. The post step reports completion delivery, shutdown results, upload
health if the Wax CI service returns it, and backup skip or ciphertext path.

## Local Tests

```sh
npm test
```
