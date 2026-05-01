# service module

`service/` is a first-class runtime module responsible for model launch/provider resolution.

## CLI

- `service/bin/service.sh launch`
- `service/bin/service.sh version`

## Config

- Module defaults: `service/config/service.conf`
- Runtime layered configs remain in `/etc/llama-server` (or `LLAMA_CONFIG_DIR`).

## Versioning

- Independent semantic version in `service/VERSION`.

## Tests

- `service/tests/test_cli.sh`
