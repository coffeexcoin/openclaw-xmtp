import { readFileSync } from "node:fs";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { privateKeyToAccount } from "viem/accounts";

export interface XmtpAccountConfig {
  enabled?: boolean;
  name?: string;
  walletKey?: string;
  walletKeyFile?: string;
  dbEncryptionKey?: string;
  dbEncryptionKeyFile?: string;
  env?: "local" | "dev" | "production";
  dbPath?: string;
  dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
  allowFrom?: string[];
  groupPolicy?: "open" | "disabled" | "allowlist";
  groupAllowFrom?: string[];
}

export type XmtpSecretSource = "env" | "secretFile" | "config" | "none";

export interface ResolvedXmtpAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;
  walletKey: string;
  walletKeySource: XmtpSecretSource;
  dbEncryptionKey: string;
  dbEncryptionKeySource: XmtpSecretSource;
  address: string;
  env: "local" | "dev" | "production";
  config: XmtpAccountConfig;
}

const DEFAULT_ACCOUNT_ID = "default";
const DEFAULT_ENV = "production" as const;

function deriveAddressFromKey(walletKey: string): string {
  try {
    const account = privateKeyToAccount(walletKey as `0x${string}`);
    return account.address.toLowerCase();
  } catch {
    return "";
  }
}

type XmtpChannelRawConfig = XmtpAccountConfig & {
  accounts?: Record<string, XmtpAccountConfig>;
};

export function listXmtpAccountIds(cfg: OpenClawConfig): string[] {
  const xmtpCfg = (cfg.channels as Record<string, unknown> | undefined)?.xmtp as
    | XmtpChannelRawConfig
    | undefined;

  // Multi-account: if `accounts` record is present and non-empty, return its keys.
  // Env vars do NOT create an implicit "default" in multi-account mode.
  if (xmtpCfg?.accounts && Object.keys(xmtpCfg.accounts).length > 0) {
    return Object.keys(xmtpCfg.accounts);
  }

  // Single-account fallback: check top-level config fields + env vars
  const hasConfig =
    Boolean(xmtpCfg?.walletKey?.trim()) ||
    Boolean(xmtpCfg?.walletKeyFile?.trim()) ||
    Boolean(xmtpCfg?.dbEncryptionKey?.trim()) ||
    Boolean(xmtpCfg?.dbEncryptionKeyFile?.trim());
  const hasEnv =
    Boolean(process.env.XMTP_WALLET_KEY?.trim()) ||
    Boolean(process.env.XMTP_DB_ENCRYPTION_KEY?.trim());

  if (hasConfig || hasEnv) {
    return [DEFAULT_ACCOUNT_ID];
  }

  return [];
}

export function resolveDefaultXmtpAccountId(cfg: OpenClawConfig): string {
  const ids = listXmtpAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

export function resolveXmtpAccount(opts: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedXmtpAccount {
  const accountId = opts.accountId ?? DEFAULT_ACCOUNT_ID;
  const xmtpCfg = (opts.cfg.channels as Record<string, unknown> | undefined)?.xmtp as
    | XmtpChannelRawConfig
    | undefined;

  // Extract top-level account fields (strip `accounts` key)
  const { accounts: _accounts, ...topLevelFields } = xmtpCfg ?? {};

  // Merge per-account overrides on top
  const accountOverrides = _accounts?.[accountId] ?? {};
  const merged: XmtpAccountConfig = { ...topLevelFields, ...accountOverrides };

  const baseEnabled = merged.enabled !== false;
  const walletKeyResolution = resolveWalletKey(accountId, merged);
  const dbEncryptionKeyResolution = resolveDbEncryptionKey(accountId, merged);
  const configured = Boolean(walletKeyResolution.secret && dbEncryptionKeyResolution.secret);

  let address = "";
  if (configured) {
    address = deriveAddressFromKey(walletKeyResolution.secret);
  }

  return {
    accountId,
    name: merged.name?.trim() || undefined,
    enabled: baseEnabled,
    configured,
    walletKey: walletKeyResolution.secret,
    walletKeySource: walletKeyResolution.source,
    dbEncryptionKey: dbEncryptionKeyResolution.secret,
    dbEncryptionKeySource: dbEncryptionKeyResolution.source,
    address,
    env: merged.env ?? DEFAULT_ENV,
    config: {
      enabled: merged.enabled,
      name: merged.name,
      walletKey: merged.walletKey,
      walletKeyFile: merged.walletKeyFile,
      dbEncryptionKey: merged.dbEncryptionKey,
      dbEncryptionKeyFile: merged.dbEncryptionKeyFile,
      env: merged.env,
      dbPath: merged.dbPath,
      dmPolicy: merged.dmPolicy,
      allowFrom: merged.allowFrom,
      groupPolicy: merged.groupPolicy,
      groupAllowFrom: merged.groupAllowFrom,
    },
  };
}

function resolveWalletKey(
  accountId: string,
  cfg?: XmtpAccountConfig,
): { secret: string; source: XmtpSecretSource } {
  const walletKeyFile = cfg?.walletKeyFile?.trim();
  if (walletKeyFile) {
    try {
      const secret = readFileSync(walletKeyFile, "utf-8").trim();
      if (secret) {
        return { secret, source: "secretFile" };
      }
    } catch {
      return { secret: "", source: "none" };
    }
  }

  const configKey = cfg?.walletKey?.trim();
  if (configKey) {
    return { secret: configKey, source: "config" };
  }

  if (accountId === DEFAULT_ACCOUNT_ID) {
    const envKey = process.env.XMTP_WALLET_KEY?.trim();
    if (envKey) {
      return { secret: envKey, source: "env" };
    }
  }

  return { secret: "", source: "none" };
}

function resolveDbEncryptionKey(
  accountId: string,
  cfg?: XmtpAccountConfig,
): { secret: string; source: XmtpSecretSource } {
  const secretFile = cfg?.dbEncryptionKeyFile?.trim();
  if (secretFile) {
    try {
      const secret = readFileSync(secretFile, "utf-8").trim();
      if (secret) {
        return { secret, source: "secretFile" };
      }
    } catch {
      return { secret: "", source: "none" };
    }
  }

  const configKey = cfg?.dbEncryptionKey?.trim();
  if (configKey) {
    return { secret: configKey, source: "config" };
  }

  if (accountId === DEFAULT_ACCOUNT_ID) {
    const envKey = process.env.XMTP_DB_ENCRYPTION_KEY?.trim();
    if (envKey) {
      return { secret: envKey, source: "env" };
    }
  }

  return { secret: "", source: "none" };
}
