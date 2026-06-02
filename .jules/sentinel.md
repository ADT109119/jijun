## 2025-02-25 - Fix XSS Vulnerability in QuickSelectManager
**Vulnerability:** In `src/js/quickSelectManager.js`, the `descriptionText` property (derived from user input via `record.description`) was directly injected into the DOM using `innerHTML` within a template literal without sanitization. This allowed for Cross-Site Scripting (XSS) if a user entered malicious HTML/JS as a description.
**Learning:** Even internal tool components like a "quick select" history need proper output encoding. Because it takes previously entered user inputs and re-renders them, it is a stored XSS vector locally.
**Prevention:** Always use `escapeHTML` from `src/js/utils.js` when interpolating user-provided text into template literals that are assigned to `innerHTML`.
