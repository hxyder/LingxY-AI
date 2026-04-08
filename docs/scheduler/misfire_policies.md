# Misfire Policies

- `skip`: ignore missed runs and advance to the next occurrence
- `run_once`: replay the latest missed run once on recovery
- `run_all`: replay every missed run up to the current recovery limit

Current scaffold caps replay enumeration to protect the queue from catch-up storms.
