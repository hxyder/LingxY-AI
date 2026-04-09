# DAG Runtime

This directory contains the Phase 6 directed-acyclic-graph validation, scheduling, visualization, and checkpoint / resume logic.

Current runtime behavior:

- DAG execution is still sequential
- each run can write checkpoints under the runtime `data/dag/runs/` directory
- failed executions can resume from the last checkpointed state
