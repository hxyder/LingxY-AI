# Native Messaging Protocol

LingxY currently keeps the Native Messaging host id `com.uca.host` as a
legacy compatibility namespace. The visible product name is LingxY; the host
id should only change together with a tested registry migration.

## Transport

- 4-byte little-endian payload length
- UTF-8 JSON body

## Actions

- `ping`
- `submit_capture`
- `get_recent_tasks`

## Current Host Name

- `com.uca.host`
