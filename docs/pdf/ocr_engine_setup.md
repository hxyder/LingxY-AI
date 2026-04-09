# OCR Engine Setup

Selected local OCR family for the scaffold:

- engine id: `paddle-3.0-placeholder`
- install mode: on-demand runtime outside the main application package

Planned health checks:

1. runtime present
2. model assets present
3. OCR worker responds to a synthetic image request
4. crash recovery restarts the OCR worker

Current repository only provides the contract and verification scaffold.
