# @coffeexdev/openclaw-xmtp

XMTP channel plugin for [OpenClaw](https://github.com/open-claw/openclaw) — adds E2E encrypted wallet-to-wallet messaging via the [XMTP protocol](https://xmtp.org/).

## Features

- **Direct Messages** — Wallet-to-wallet E2E encrypted DMs over XMTP
- **Pairing Flow** — Policy-aware consent with pairing codes for new senders
- **Reply Threading** — Native XMTP reply threading support (reference IDs)
- **DM Policies** — Configurable policies: `open`, `pairing`, `allowlist`, `disabled`
- **Allowlist** — Restrict access to specific Ethereum addresses
- **Activity Tracking** — Inbound/outbound message activity recording
- **Markdown Tables** — Automatic markdown table conversion for XMTP clients

## Installation

```bash
openclaw plugins install @coffeexdev/openclaw-xmtp
```

Or install manually via npm:

```bash
npm install @coffeexdev/openclaw-xmtp
```

## Configuration

Add XMTP channel configuration to your OpenClaw config (`openclaw.yaml` or equivalent):

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

    # Allowlist of Ethereum addresses (used with allowlist/pairing policies)
    allowFrom:
      - "0x1234567890abcdef1234567890abcdef12345678"

    # Custom database path (optional)
    # dbPath: "~/.openclaw/state/channels/xmtp/production"
```

### Environment Variables

As an alternative to config file values, you can set:

- `XMTP_WALLET_KEY` — Wallet private key
- `XMTP_DB_ENCRYPTION_KEY` — Database encryption key

## DM Policies

| Policy      | Behavior                                                                            |
| ----------- | ----------------------------------------------------------------------------------- |
| `open`      | Accept DMs from anyone                                                              |
| `pairing`   | New senders receive a pairing code; approve via `openclaw pair approve xmtp <code>` |
| `allowlist` | Only accept DMs from addresses in `allowFrom` or approved via pairing               |
| `disabled`  | Drop all inbound DMs                                                                |

## Links

- [XMTP Documentation](https://docs.xmtp.org/)
- [XMTP Agent SDK](https://github.com/nicobianchetti/xmtp-agent-sdk)
- [OpenClaw](https://github.com/open-claw/openclaw)

## License

MIT
