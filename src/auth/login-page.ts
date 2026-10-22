const ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

export type LoginFields = Record<string, string | undefined>;

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

export function renderLoginPage(fields: LoginFields, error?: string): string {
    const hidden = Object.entries(fields)
        .filter((entry): entry is [string, string] => entry[1] !== undefined)
        .map(
            ([name, value]) =>
                `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`
        )
        .join('\n');

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>local-mcp</title>
<style>
body {font-family: system-ui, sans-serif; max-width: 22rem; margin: 4rem auto; padding: 0 1rem;}
input, button {width: 100%; padding: 0.6rem; margin-top: 0.75rem; box-sizing: border-box;}
.error {color: #b00020;}
</style>
</head>
<body>
<h1>local-mcp</h1>
<p>Claude wants to access this computer.</p>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/authorize">
${hidden}
<input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required>
<button type="submit">Authorize</button>
</form>
</body>
</html>`;
}
