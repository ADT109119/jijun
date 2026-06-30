## 2025-02-18 - XSS via plugin innerHTML templating
**Vulnerability:** The bill_splitter plugin used `innerHTML` to render contact names and category names via ES6 template literals (`${c.name}`). An attacker could create a contact with a malicious name (e.g. `<img src=x onerror=alert(1)>`) and execute arbitrary JavaScript.
**Learning:** Plugins injected into the UI via the `ui.registerPage()` API still process raw HTML. Unescaped template literals in `innerHTML` are a common pattern in vanilla JS apps and present a high risk for XSS even inside loaded plugins.
**Prevention:** Always define and use an `escapeHTML` helper to sanitize any user-controlled input (like names) before interpolating them into HTML strings that are assigned to `innerHTML`.
