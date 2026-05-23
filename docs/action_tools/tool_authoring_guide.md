# Tool Authoring Guide

Every new tool must define:

- stable `id`
- human-readable description
- input schema
- risk level
- required capabilities
- deterministic observation text

Rules:

- never allow arbitrary shell execution
- validate all path-like inputs
- declare confirmation behavior through the risk matrix
- emit audit records for every call and denial
