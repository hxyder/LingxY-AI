# LingxY Native Host

`uca-native-host` is the legacy package path for the LingxY browser-facing
bridge between MV3 extensions and the local desktop runtime.

The Native Messaging host name remains `com.uca.host` for compatibility with
existing Chrome / Edge registry entries. Do not rename it without a tested
registry migration and extension update.

Current scope:

- Native Messaging framing helpers
- request router for `ping`, `submit_capture`, and `get_recent_tasks`
- registry manifest generator for Chrome and Edge
- .NET native host executable in `UcaNativeHost/` that forwards requests to the local runtime
