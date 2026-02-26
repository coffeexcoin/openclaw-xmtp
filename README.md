# @coffeexdev/xmtp

XMTP channel plugin for [OpenClaw](https://github.com/open-claw/openclaw) — adds E2E encrypted wallet-to-wallet messaging via the [XMTP protocol](https://xmtp.org/).

## Features

- **Direct + Group Messaging** — Supports both DM and group chat routing
- **Pairing Flow** — Policy-aware consent with pairing codes for new senders
- **Reply Threading** — Native XMTP reply threading support (reference IDs)
- **DM Policies** — Configurable policies: `open`, `pairing`, `allowlist`, `disabled`
- **Group Policies** — Configurable group policies: `open`, `allowlist`, `disabled`
- **Multi-Account Support** — Run multiple XMTP accounts via `channels.xmtp.accounts`
- **Slash Commands** — `/xmtp-address`, `/xmtp-groups`, and `/xmtp-8004-register`
- **Self-Echo Filtering** — Drops messages sent by the agent itself
- **Markdown Inbound Handler** — Handles XMTP `markdown` events (e.g. Converse clients)
- **Startup Retry** — Retries XMTP agent startup with exponential backoff
- **Allowlists** — Separate DM (`allowFrom`) and group (`groupAllowFrom`) allowlists
- **Activity Tracking** — Inbound/outbound message activity recording
- **Markdown Tables** — Automatic markdown table conversion for XMTP clients
- **ERC-8004 Registration** — Register the XMTP agent wallet on ERC-8004 registry chains

## Installation & Setup

The easiest way to install and configure XMTP is through the OpenClaw setup wizard.

First, add the XMTP plugin to your local catalog so the wizard can discover it. Create `~/.openclaw/plugins/catalog.json`:

```json
{
  "entries": [
    {
      "name": "@coffeexdev/xmtp",
      "openclaw": {
        "extensions": ["./index.ts"],
        "channel": {
          "id": "xmtp",
          "label": "XMTP",
          "selectionLabel": "XMTP (E2E Encrypted DMs)",
          "docsPath": "/channels/xmtp",
          "docsLabel": "xmtp",
          "blurb": "E2E encrypted messaging via XMTP protocol; wallet-to-wallet.",
          "order": 101,
          "quickstartAllowFrom": true
        },
        "install": {
          "npmSpec": "@coffeexdev/xmtp",
          "localPath": "extensions/xmtp",
          "defaultChoice": "npm"
        }
      }
    }
  ]
}
```

Then run the setup wizard:

```bash
openclaw configure --section channels
```

1. Select **Configure** when prompted for channel mode
2. Select **XMTP** from the channel list — it appears as `XMTP (plugin · install)`
3. Choose an install method:
   - **Download from npm** (`@coffeexdev/xmtp`) — default, recommended
   - **Use local plugin path** (`extensions/xmtp`) — for development
   - **Skip for now**
4. The wizard walks you through XMTP-specific configuration:
   - **Wallet key** — generate a new wallet, paste an existing private key, or provide a key file path
   - **DB encryption key** — generate, paste, or provide a key file path
   - **XMTP environment** — production (default), dev, or local
5. Configure **DM policy**:
   - **Pairing** (default) — unknown senders receive a pairing code, approved via `openclaw pairing approve xmtp <code>`
   - **Allowlist** — only specific wallet addresses can DM
   - **Open** — accept DMs from anyone
   - **Disabled** — ignore all DMs
6. Start the gateway:

```bash
openclaw gateway run
```

7. Verify the connection:

```bash
openclaw channels status
```

### Manual Installation

Alternatively, install via the CLI or npm directly:

```bash
openclaw plugins install @coffeexdev/xmtp
```

```bash
npm install @coffeexdev/xmtp
```

Then configure XMTP manually in your OpenClaw config (see below).

## Configuration

Add XMTP channel configuration to your OpenClaw config (`~/.openclaw/openclaw.json`):

### Single Account (backward compatible)

```yaml
channels:
  xmtp:
    # Required: XMTP wallet private key (0x-prefixed hex)
    walletKey: "0x..."
    # Or use a file:
    # walletKeyFile: "/path/to/wallet-key"

    # Required: Database encryption key (hex string)
    dbEncryptionKey: "0x..."
    # Or use a file:
    # dbEncryptionKeyFile: "/path/to/db-encryption-key"

    # XMTP network environment (default: production)
    env: production # or: dev, local

    # DM policy (default: pairing)
    dmPolicy: pairing # or: open, allowlist, disabled

    # DM allowlist of Ethereum addresses
    allowFrom:
      - "0x1234567890abcdef1234567890abcdef12345678"

    # Group policy (default: open)
    groupPolicy: open # or: allowlist, disabled

    # Group allowlist of Ethereum addresses (used when groupPolicy=allowlist)
    groupAllowFrom:
      - "0x1234567890abcdef1234567890abcdef12345678"

    # Optional ERC-8004 defaults (all fields optional)
    erc8004:
      # Optional default token URI. If omitted, /xmtp-8004-register auto-generates one.
      # tokenUri: "ipfs://bafy..."
      # Optional default target chains. If omitted, defaults to Ethereum mainnet.
      # defaultChains: ["mainnet", "base"]
      # Optional RPC overrides by chain name/id (otherwise uses viem chain default public RPC)
      # rpcUrls:
      #   "1": "https://eth.llamarpc.com"
      # Optional registry address overrides by chain name/id
      # registryAddresses:
      #   "1": "0x8004fb056e7e6a2ad1ad0c079aecf82f95ca3e6d"

    # Custom database path (optional)
    # dbPath: "~/.openclaw/state/channels/xmtp/production"
```

### Multi-Account

```yaml
channels:
  xmtp:
    # Top-level fields act as defaults for accounts below
    env: production
    dmPolicy: pairing
    groupPolicy: open

    accounts:
      alice:
        walletKey: "0x..."
        dbEncryptionKey: "0x..."
        allowFrom:
          - "0x1234567890abcdef1234567890abcdef12345678"

      bob:
        walletKeyFile: "/path/to/bob-wallet-key"
        dbEncryptionKeyFile: "/path/to/bob-db-key"
        env: dev
        groupPolicy: allowlist
        groupAllowFrom:
          - "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
        erc8004:
          defaultChains: ["mainnet", "abstract"]
          rpcUrls:
            "2741": "https://api.mainnet.abs.xyz"
```

Behavior in multi-account mode:

- Top-level `channels.xmtp` fields are defaults
- Per-account fields in `accounts.<id>` override top-level defaults
- If `accounts` exists, only those account IDs are loaded (no implicit `default`)

### Environment Variables

As an alternative to config file values, you can set:

- `XMTP_WALLET_KEY` — Wallet private key
- `XMTP_DB_ENCRYPTION_KEY` — Database encryption key

When `accounts` is present, env vars can still provide missing secrets for those account IDs, but they do not create an implicit `default` account.

## DM Policies

| Policy      | Behavior                                                                            |
| ----------- | ----------------------------------------------------------------------------------- |
| `open`      | Accept DMs from anyone                                                              |
| `pairing`   | New senders receive a pairing code; approve via `openclaw pair approve xmtp <code>` |
| `allowlist` | Only accept DMs from addresses in `allowFrom` or approved via pairing               |
| `disabled`  | Drop all inbound DMs                                                                |

## Group Policies

| Policy      | Behavior                                                                              |
| ----------- | ------------------------------------------------------------------------------------- |
| `open`      | Accept group messages from anyone                                                     |
| `allowlist` | Only accept group messages from addresses in `groupAllowFrom` or approved via pairing |
| `disabled`  | Drop all inbound group messages                                                       |

## Commands

| Command               | Description                                                              |
| --------------------- | ------------------------------------------------------------------------ |
| `/xmtp-address`       | Show connected XMTP account IDs, wallet addresses, and inbox IDs         |
| `/xmtp-groups`        | List connected XMTP accounts (use XMTP client apps for full group lists) |
| `/xmtp-8004-register` | Register the XMTP agent wallet in ERC-8004 on one or more chains         |

`/xmtp-8004-register` options:

- `--chains <csv>`: chain names/ids (example: `mainnet,base` or `1,8453`)
- `--token-uri <uri>`: optional token URI (if omitted, command auto-generates a metadata URI)
- `--account <id>`: optional account ID override
- `--dry-run`: validate chain/RPC/fee resolution without sending transactions

Defaults:

- Chain defaults to Ethereum mainnet (`1`) when not provided in args/config.
- RPC defaults to viem chain definition public RPC when no custom RPC override is configured.

## Runtime Notes

- Inbound handlers process XMTP `text`, `reply`, and `markdown` events
- Self-echo filtering is applied to `text`, `reply`, and `markdown` events
- XMTP startup retries up to 3 attempts with exponential backoff (2s, then 4s); after that it throws

## Links

- [XMTP Documentation](https://docs.xmtp.org/)
- [XMTP Agent SDK](https://github.com/nicobianchetti/xmtp-agent-sdk)
- [OpenClaw](https://github.com/open-claw/openclaw)

## License

MIT
