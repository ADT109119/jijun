const fs = require('fs');

let content = fs.readFileSync('public/plugins/e_invoice.plugin.js', 'utf8');

// fix empty blocks by adding comments
content = content.replace(/catch \([e]\) \{\}/g, "catch (e) { /* ignore */ }");
content = content.replace(/\} catch\([e]\) \{\}/g, "} catch(e) { /* ignore */ }");

// remove unused vars or add eslint-disable-next-line
content = content.replace(/html5QrcodeScanner.render\(\(decodedText\) => \{([\s\S]*?)\}, \(errorMessage\) => \{([\s\S]*?)\}\);/g, "html5QrcodeScanner.render((decodedText) => {$1}, (/* errorMessage */) => {$2/* ignore */});");

content = content.replace(/checkInvoiceWinning\(invoiceNumber, period, winningData\) \{/g, "checkInvoiceWinning(/* invoiceNumber, period, winningData */) {");

content = content.replace(/invoices.map\(\(inv, index\) => \{/g, "invoices.map((inv) => {");

fs.writeFileSync('public/plugins/e_invoice.plugin.js', content);
