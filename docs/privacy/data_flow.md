# Privacy Data Flow

1. Capture source creates a raw context packet.
2. Security Broker applies blocklist, presenter mode, kill switch, and redaction.
3. Only filtered context reaches executors.
4. Audit logs record the action.
