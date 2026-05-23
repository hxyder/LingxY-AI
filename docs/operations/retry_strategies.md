# Retry Strategies

Supported retry modes:

- `retry_same`
- `retry_modified`
- `retry_different_executor`

Current implementation notes:

- retry requests preserve the original source context
- new tasks point `parent_task_id` to the original lineage root
- `retry_resume` is not enabled yet because no executor exposes checkpoints
