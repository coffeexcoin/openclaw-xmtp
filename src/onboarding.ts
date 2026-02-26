import { accessSync, constants, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import type {
  ChannelOnboardingAdapter,
  ChannelOnboardingDmPolicy,
  DmPolicy,
  OpenClawConfig,
  WizardPrompter,
} from "openclaw/plugin-sdk";
import {
  DEFAULT_ACCOUNT_ID,
  addWildcardAllowFrom,
  mergeAllowFromEntries,
  normalizeAccountId,
  promptAccountId,
} from "openclaw/plugin-sdk";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { listXmtpAccountIds, resolveDefaultXmtpAccountId } from "./types.js";

const channel = "xmtp" as const;

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

type XmtpChannelConfig = Record<string, unknown> & {
  dmPolicy?: DmPolicy;
  allowFrom?: Array<string | number>;
  accounts?: Record<string, Record<string, unknown>>;
};

function getXmtpCfg(cfg: OpenClawConfig): XmtpChannelConfig | undefined {
  return (cfg.channels as Record<string, unknown> | undefined)?.xmtp as
    | XmtpChannelConfig
    | undefined;
}

function setXmtpDmPolicy(cfg: OpenClawConfig, dmPolicy: DmPolicy): OpenClawConfig {
  const xmtp = getXmtpCfg(cfg);
  const allowFrom = dmPolicy === "open" ? addWildcardAllowFrom(xmtp?.allowFrom) : undefined;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      xmtp: {
        ...xmtp,
        dmPolicy,
        ...(allowFrom ? { allowFrom } : {}),
      },
    },
  };
}

function setXmtpAllowFrom(
  cfg: OpenClawConfig,
  accountId: string,
  allowFrom: string[],
): OpenClawConfig {
  const xmtp = getXmtpCfg(cfg);
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        xmtp: { ...xmtp, allowFrom },
      },
    };
  }
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      xmtp: {
        ...xmtp,
        accounts: {
          ...xmtp?.accounts,
          [accountId]: {
            ...xmtp?.accounts?.[accountId],
            allowFrom,
          },
        },
      },
    },
  };
}

function parseAllowFromInput(raw: string): string[] {
  return raw
    .split(/[\n,]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function promptXmtpAllowFrom(params: {
  cfg: OpenClawConfig;
  prompter: WizardPrompter;
  accountId?: string;
}): Promise<OpenClawConfig> {
  const accountId =
    params.accountId && normalizeAccountId(params.accountId)
      ? (normalizeAccountId(params.accountId) ?? DEFAULT_ACCOUNT_ID)
      : resolveDefaultXmtpAccountId(params.cfg);

  const xmtp = getXmtpCfg(params.cfg);
  const existing = (
    accountId === DEFAULT_ACCOUNT_ID
      ? xmtp?.allowFrom
      : (xmtp?.accounts?.[accountId] as Record<string, unknown> | undefined)?.allowFrom
  ) as string[] | undefined;

  await params.prompter.note(
    [
      "Allowlist XMTP DMs by Ethereum address.",
      "Examples:",
      "- 0x1234567890abcdef1234567890abcdef12345678",
      "- * (wildcard, allow all)",
      "Multiple entries: comma- or newline-separated.",
    ].join("\n"),
    "XMTP allowlist",
  );

  const entry = await params.prompter.text({
    message: "XMTP allowFrom (Ethereum address)",
    placeholder: "0x1234..., 0xabcd...",
    initialValue: existing?.[0] ? String(existing[0]) : undefined,
    validate: (value) => {
      const raw = String(value ?? "").trim();
      if (!raw) return "Required";
      const parts = parseAllowFromInput(raw);
      for (const part of parts) {
        if (part === "*") continue;
        if (!/^0x[0-9a-fA-F]{40}$/.test(part)) {
          return `Invalid Ethereum address: ${part}`;
        }
      }
      return undefined;
    },
  });

  const parts = parseAllowFromInput(String(entry));
  const unique = mergeAllowFromEntries(undefined, parts);
  return setXmtpAllowFrom(params.cfg, accountId, unique);
}

// ---------------------------------------------------------------------------
// Lightweight config key presence check (no file I/O)
// ---------------------------------------------------------------------------

function hasConfigKeys(xmtp: XmtpChannelConfig | undefined, accountId: string): boolean {
  if (!xmtp) return false;

  const acctCfg =
    accountId === DEFAULT_ACCOUNT_ID
      ? xmtp
      : (xmtp.accounts?.[accountId] as Record<string, unknown> | undefined);

  // Check config-level keys
  const hasWalletConfig =
    Boolean((acctCfg as Record<string, unknown> | undefined)?.walletKey) ||
    Boolean((acctCfg as Record<string, unknown> | undefined)?.walletKeyFile);
  const hasDbConfig =
    Boolean((acctCfg as Record<string, unknown> | undefined)?.dbEncryptionKey) ||
    Boolean((acctCfg as Record<string, unknown> | undefined)?.dbEncryptionKeyFile);

  // Also check top-level for named accounts (inherited fields)
  const hasWalletTopLevel = Boolean(xmtp.walletKey) || Boolean(xmtp.walletKeyFile);
  const hasDbTopLevel = Boolean(xmtp.dbEncryptionKey) || Boolean(xmtp.dbEncryptionKeyFile);

  const hasWallet = hasWalletConfig || hasWalletTopLevel;
  const hasDb = hasDbConfig || hasDbTopLevel;

  if (hasWallet && hasDb) return true;

  // For default account only: check env vars
  if (accountId === DEFAULT_ACCOUNT_ID) {
    const walletFromEnv = Boolean(process.env.XMTP_WALLET_KEY?.trim());
    const dbFromEnv = Boolean(process.env.XMTP_DB_ENCRYPTION_KEY?.trim());
    return (hasWallet || walletFromEnv) && (hasDb || dbFromEnv);
  }

  return false;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const HEX_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

function validateHexKey(value: string): string | undefined {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "Required";
  if (!HEX_KEY_PATTERN.test(trimmed)) {
    return "Must be a 0x-prefixed 64-character hex string (32 bytes)";
  }
  return undefined;
}

function validateFilePath(value: string): string | undefined {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "Required";
  try {
    accessSync(trimmed, constants.R_OK);
    return undefined;
  } catch {
    return "File does not exist or is not readable";
  }
}

// ---------------------------------------------------------------------------
// DM policy adapter
// ---------------------------------------------------------------------------

const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "XMTP",
  channel,
  policyKey: "channels.xmtp.dmPolicy",
  allowFromKey: "channels.xmtp.allowFrom",
  getCurrent: (cfg) => (getXmtpCfg(cfg)?.dmPolicy as DmPolicy | undefined) ?? "pairing",
  setPolicy: (cfg, policy) => setXmtpDmPolicy(cfg, policy),
  promptAllowFrom: promptXmtpAllowFrom,
};

// ---------------------------------------------------------------------------
// Onboarding adapter
// ---------------------------------------------------------------------------

export const xmtpOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,

  getStatus: async ({ cfg }) => {
    const accountIds = listXmtpAccountIds(cfg);
    const xmtp = getXmtpCfg(cfg);
    const configuredCount = accountIds.filter((id) => hasConfigKeys(xmtp, id)).length;
    const configured = configuredCount > 0;

    return {
      channel,
      configured,
      statusLines: [
        configured
          ? `XMTP: ${configuredCount} account${configuredCount === 1 ? "" : "s"} configured`
          : "XMTP: needs setup",
      ],
      selectionHint: configured ? "configured" : "E2E encrypted wallet messaging",
      quickstartScore: configured ? 1 : 0,
    };
  },

  configure: async ({ cfg, prompter, accountOverrides, shouldPromptAccountIds }) => {
    const xmtpOverride = accountOverrides.xmtp?.trim();
    const defaultAccountId = resolveDefaultXmtpAccountId(cfg);
    let accountId = xmtpOverride ? normalizeAccountId(xmtpOverride) : defaultAccountId;

    if (shouldPromptAccountIds && !xmtpOverride) {
      accountId = await promptAccountId({
        cfg,
        prompter,
        label: "XMTP",
        currentId: accountId,
        listAccountIds: listXmtpAccountIds,
        defaultAccountId,
      });
    }

    let next = cfg;
    const xmtp = getXmtpCfg(next);

    // Determine existing config for this account
    const acctCfg =
      accountId === DEFAULT_ACCOUNT_ID
        ? (xmtp as Record<string, unknown> | undefined)
        : (xmtp?.accounts?.[accountId] as Record<string, unknown> | undefined);

    const existingWalletKey =
      (acctCfg?.walletKey as string | undefined)?.trim() ||
      (xmtp?.walletKey as string | undefined)?.trim();
    const existingWalletKeyFile =
      (acctCfg?.walletKeyFile as string | undefined)?.trim() ||
      (xmtp?.walletKeyFile as string | undefined)?.trim();
    const existingDbKey =
      (acctCfg?.dbEncryptionKey as string | undefined)?.trim() ||
      (xmtp?.dbEncryptionKey as string | undefined)?.trim();
    const existingDbKeyFile =
      (acctCfg?.dbEncryptionKeyFile as string | undefined)?.trim() ||
      (xmtp?.dbEncryptionKeyFile as string | undefined)?.trim();
    const existingEnv =
      (acctCfg?.env as string | undefined)?.trim() || (xmtp?.env as string | undefined)?.trim();

    const hasExistingWallet = Boolean(existingWalletKey || existingWalletKeyFile);
    const hasExistingDb = Boolean(existingDbKey || existingDbKeyFile);

    // --- Wallet Key ---
    let walletKey: string | undefined;
    let walletKeyFile: string | undefined;
    let walletAddress: string | undefined;

    let shouldPromptWallet = true;
    if (hasExistingWallet) {
      const keep = await prompter.confirm({
        message: "Keep existing wallet key?",
        initialValue: true,
      });
      if (keep) shouldPromptWallet = false;
    }

    if (shouldPromptWallet) {
      const method = await prompter.select({
        message: "How to configure wallet key?",
        options: [
          { value: "generate" as const, label: "Generate new wallet" },
          { value: "paste" as const, label: "Paste existing key" },
          { value: "file" as const, label: "Provide key file path" },
        ],
      });

      if (method === "generate") {
        walletKey = generatePrivateKey();
        const account = privateKeyToAccount(walletKey as `0x${string}`);
        walletAddress = account.address.toLowerCase();
        await prompter.note(`Generated wallet address: ${walletAddress}`, "New wallet");
        await prompter.note(
          "Your private key will be stored in your OpenClaw config.\nFor production, consider using `walletKeyFile` with restricted file permissions.",
          "Security note",
        );
      } else if (method === "paste") {
        const entered = await prompter.text({
          message: "Wallet private key",
          placeholder: "0x...",
          validate: (value) => {
            const err = validateHexKey(value);
            if (err) return err;
            try {
              privateKeyToAccount(value.trim() as `0x${string}`);
              return undefined;
            } catch {
              return "Invalid private key";
            }
          },
        });
        walletKey = String(entered).trim();
        const account = privateKeyToAccount(walletKey as `0x${string}`);
        walletAddress = account.address.toLowerCase();
        await prompter.note(`Wallet address: ${walletAddress}`, "Wallet");
        await prompter.note(
          "Your private key will be stored in your OpenClaw config.\nFor production, consider using `walletKeyFile` with restricted file permissions.",
          "Security note",
        );
      } else {
        // file
        const entered = await prompter.text({
          message: "Path to wallet key file",
          validate: validateFilePath,
        });
        walletKeyFile = String(entered).trim();
        try {
          const key = readFileSync(walletKeyFile, "utf-8").trim();
          const account = privateKeyToAccount(key as `0x${string}`);
          walletAddress = account.address.toLowerCase();
          await prompter.note(`Wallet address: ${walletAddress}`, "Wallet");
        } catch {
          await prompter.note(
            "Could not derive address from key file. The file will be read at runtime.",
            "Wallet",
          );
        }
      }
    }

    // --- DB Encryption Key ---
    let dbEncryptionKey: string | undefined;
    let dbEncryptionKeyFile: string | undefined;

    let shouldPromptDb = true;
    if (hasExistingDb) {
      const keep = await prompter.confirm({
        message: "Keep existing encryption key?",
        initialValue: true,
      });
      if (keep) shouldPromptDb = false;
    }

    if (shouldPromptDb) {
      const method = await prompter.select({
        message: "How to configure DB encryption key?",
        options: [
          { value: "generate" as const, label: "Generate new key" },
          { value: "paste" as const, label: "Paste existing key" },
          { value: "file" as const, label: "Provide key file path" },
        ],
      });

      if (method === "generate") {
        dbEncryptionKey = `0x${randomBytes(32).toString("hex")}`;
      } else if (method === "paste") {
        const entered = await prompter.text({
          message: "DB encryption key",
          placeholder: "0x...",
          validate: validateHexKey,
        });
        dbEncryptionKey = String(entered).trim();
      } else {
        // file
        const entered = await prompter.text({
          message: "Path to DB encryption key file",
          validate: validateFilePath,
        });
        dbEncryptionKeyFile = String(entered).trim();
      }
    }

    // --- Environment ---
    let env: string | undefined;
    if (existingEnv) {
      const keep = await prompter.confirm({
        message: `Keep existing environment (${existingEnv})?`,
        initialValue: true,
      });
      if (!keep) {
        env = await prompter.select({
          message: "XMTP environment",
          options: [
            { value: "production", label: "Production" },
            { value: "dev", label: "Dev" },
            { value: "local", label: "Local" },
          ],
          initialValue: "production",
        });
      }
    } else {
      env = await prompter.select({
        message: "XMTP environment",
        options: [
          { value: "production", label: "Production" },
          { value: "dev", label: "Dev" },
          { value: "local", label: "Local" },
        ],
        initialValue: "production",
      });
    }

    // --- Apply config ---
    const patch: Record<string, unknown> = { enabled: true };
    if (walletKey !== undefined) patch.walletKey = walletKey;
    if (walletKeyFile !== undefined) patch.walletKeyFile = walletKeyFile;
    if (dbEncryptionKey !== undefined) patch.dbEncryptionKey = dbEncryptionKey;
    if (dbEncryptionKeyFile !== undefined) patch.dbEncryptionKeyFile = dbEncryptionKeyFile;
    if (env !== undefined) patch.env = env;

    const currentXmtp = getXmtpCfg(next);
    if (accountId === DEFAULT_ACCOUNT_ID) {
      next = {
        ...next,
        channels: {
          ...next.channels,
          xmtp: {
            ...currentXmtp,
            ...patch,
          },
        },
      };
    } else {
      next = {
        ...next,
        channels: {
          ...next.channels,
          xmtp: {
            ...currentXmtp,
            enabled: true,
            accounts: {
              ...currentXmtp?.accounts,
              [accountId]: {
                ...currentXmtp?.accounts?.[accountId],
                ...patch,
              },
            },
          },
        },
      };
    }

    // --- Outro ---
    const outroLines = ["XMTP channel configured."];
    if (walletAddress) {
      outroLines.push(`Wallet address: ${walletAddress}`);
    }
    outroLines.push(`Environment: ${env ?? existingEnv ?? "production"}`);
    outroLines.push("Next: configure DM policy with `openclaw setup dm-policy`");
    await prompter.note(outroLines.join("\n"), "XMTP setup complete");

    return { cfg: next, accountId };
  },

  dmPolicy,

  disable: (cfg) => ({
    ...cfg,
    channels: {
      ...cfg.channels,
      xmtp: { ...getXmtpCfg(cfg), enabled: false },
    },
  }),
};
