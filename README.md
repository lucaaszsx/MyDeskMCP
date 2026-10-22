# MyDeskMCP

A remote [MCP](https://modelcontextprotocol.io) server that gives a client such as Claude access to the computer it runs on. It exposes a shell, background processes, file operations and search as tools, over Streamable HTTP, protected by OAuth 2.1 with PKCE and a single password.

> **Security warning.** This server grants full access to the machine and to every file the user account can reach. Anyone who knows the public URL and the password can run arbitrary commands. Use a long random password, keep the server bound to `127.0.0.1` behind an HTTPS tunnel, and do not run it on a machine you cannot afford to lose control of.

## Requirements

- Linux or macOS with `bash` and [`ripgrep`](https://github.com/BurntSushi/ripgrep) (`rg`)
- Node.js 24 or newer
- pnpm
- An HTTPS tunnel that forwards a public URL to the local port (see below)

## Setup

```sh
git clone https://github.com/lucaaszsx/MyDeskMCP.git
cd MyDeskMCP
pnpm install
pnpm build
```

Create a `.env` file from the example and fill it in:

```sh
cp .env.example .env
```

| Variable | Default | Description |
|---|---|---|
| `MCP_PASSWORD` | required | Login password, at least 16 characters |
| `MCP_PUBLIC_URL` | required | Public HTTP(S) URL of the tunnel. It becomes the OAuth issuer and the base of `/mcp` |
| `MCP_HOST` | `127.0.0.1` | Interface to bind |
| `MCP_PORT` | `3000` | Port to listen on |
| `MCP_CWD` | home directory | Default directory for tools. Relative paths resolve against it. It does not restrict access |
| `MCP_STATE_FILE` | `.oauth-state.json` | Where OAuth clients and tokens are stored, relative to the process working directory |

Generate a password with:

```sh
openssl rand -base64 24
```

## Run

```sh
pnpm start
```

For development with reload, use `pnpm dev`.

## Expose it over HTTPS

The server only listens on a local address. Put an HTTPS tunnel in front of it and use the tunnel URL as `MCP_PUBLIC_URL`. Examples:

```sh
tailscale funnel --bg 3000
cloudflared tunnel --url http://127.0.0.1:3000
```

## Connect from Claude

Add a custom connector and point it at `<MCP_PUBLIC_URL>/mcp`. Claude registers itself, opens the login page, and asks for the password once. Sessions last 30 days and are refreshed automatically. Only the Claude callback URLs are accepted as redirect targets.

To revoke every session, stop the server, delete the state file and start it again. Changing `MCP_PASSWORD` prevents new logins but does not end existing sessions.

## Tools

| Tool | Description |
|---|---|
| `bash` | Run a command in a Bash login shell |
| `process_start` | Start a command in the background |
| `process_read` | Read new output of a background process |
| `process_write` | Write to the input of a background process |
| `process_list` | List background processes |
| `process_stop` | Signal or remove a background process |
| `read_file` | Read a text file, optionally a line range. Required before changing an existing file |
| `read_image` | Read a png, jpg, gif or webp image |
| `write_file` | Create a file, or overwrite one that was read and has not changed since |
| `edit_file` | Replace an exact string in a file that was read and has not changed since |
| `multi_edit` | Apply several replacements across files, all or nothing |
| `move_path` | Move or rename a path |
| `find_files` | Find files by glob |
| `search_text` | Search file contents with ripgrep: content, file list or counts, context lines, multiline, paging |

Child processes do not inherit `MCP_*` variables, and git runs without prompts or editors. Use `bash` for everything else, such as git, directory listings, deleting files and system information.

## Development

```sh
pnpm typecheck
pnpm test
pnpm format
```
