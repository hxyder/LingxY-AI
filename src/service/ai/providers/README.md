# AI Providers

This directory contains AI provider adapters and runtime health detection.

Current built-in providers:

- Anthropic
- OpenAI
- Kimi API
- Ollama

The runtime layer exposes provider availability, configuration state, and local health details for the console and onboarding flow.

Adapters should implement the shared contracts in `src/shared/contracts/ai-provider.ts`.
