## 2025-02-14 - Remove Hardcoded Secrets

**Vulnerability:** Hardcoded GOOGLE_CLIENT_ID and GOOGLE_API_KEY in `src/js/syncService.js`.
**Learning:** Hardcoded secrets in client-side code are easily extracted by attackers, leading to potential unauthorized access or API quota abuse.
**Prevention:** Use environment variables (e.g. via `vite`s `import.meta.env`) mapped from configuration or build tools rather than storing secrets directly in code.
