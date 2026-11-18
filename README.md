# Crash Override CI Telemetry Action

This repository is the public GitHub Action package for Wax CI/CD telemetry.
It must not vendor private Wax source. The action downloads a verified Linux CI
runtime bundle, starts the Wax CI service as the runner user, starts the Linux
CI sensor stub with `sudo --non-interactive`, and stops both processes from the
post step.

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

### With an organization API key

Store an organization API key as an Actions secret and pass it as `api-key`.
The action then exchanges the key at Gatekeeper and does not ask GitHub for an
OIDC token, so the job does not need `id-token: write`:

```yaml
permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: crashappsec/crayon-ci-telemetry@<commit-sha>
        with:
          api-key: ${{ secrets.CRASHOVERRIDE_API_KEY }}

      - run: npm ci
      - run: npm test
```

Never put the key itself in a workflow file. The action masks it in the log,
never writes it to disk or to saved state, and removes it from the environment
before it starts any other process.

## Inputs

`gatekeeper-base` points at Gatekeeper. `token-exchange-path` defaults to
`/v1/token/exchange`. `oidc-audience` defaults to `gatekeeper-base`.

`api-key` selects the API-key exchange. The action posts the key to
`<gatekeeper-base><token-exchange-path>` as an RFC 8693 subject token:

```json
{
  "contract_version": "gatekeeper.token-exchange-request/v1",
  "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
  "subject_token": "<api-key>",
  "subject_token_type": "urn:crashoverride:token-type:workos_api_key"
}
```

`api-key-audience` and `api-key-scope`, when set, are sent as `audience` and
`scope`. The answer must be the same `gatekeeper.ci-ingest-credential/v1`
credential the OIDC exchange returns; any other answer, such as a bare
transaction token, fails the step with a message that names what came back.
With `api-key` empty, the action uses the GitHub Actions OIDC exchange as
before.

`runtime-url`, `runtime-sha256`, `runtime-signature-url`, and
`runtime-signing-identity` are development overrides. In normal customer use,
Gatekeeper returns runtime metadata in the CI ingest credential response.

`allow-unsigned-runtime` is for fake local dry runs only. Release validation
must leave it false.

`dry-run` performs the Gatekeeper exchange (API key or OIDC) and runtime
metadata validation without starting the Wax CI service or Linux CI sensor
stub.

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

The main step reports which Gatekeeper exchange it used (organization API key
or GitHub Actions OIDC), runtime verification, and process startup state. The post step reports completion delivery, shutdown results, upload
health if the Wax CI service returns it, and backup skip or ciphertext path.

## Local Tests

```sh
npm test
```
