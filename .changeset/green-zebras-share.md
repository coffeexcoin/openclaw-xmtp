---
"@coffeexdev/xmtp": minor
---

Add ERC-8004 registration support to the XMTP plugin via a new `/xmtp-8004-register` slash command.

Highlights:

- New `/xmtp-8004-register` command with optional flags:
  - `--chains <csv>`
  - `--token-uri <uri>`
  - `--account <id>`
  - `--dry-run`
- Adds optional `channels.xmtp.erc8004` config (including per-account overrides) for:
  - `tokenUri`
  - `defaultChains`
  - `rpcUrls`
  - `registryAddresses`
- Default behavior when values are omitted:
  - target chain defaults to Ethereum mainnet (`1`)
  - RPC URL defaults to viem chain public/default RPC
  - token URI is auto-generated when not provided by args/config
- `--dry-run` mode validates chain/RPC/fee resolution and reports per-chain results without sending transactions.
- Improves command registration metadata by passing `acceptsArgs` during plugin command registration.
