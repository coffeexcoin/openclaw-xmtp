import { Buffer } from "node:buffer";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  isAddress,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import * as viemChains from "viem/chains";
import { resolveDefaultXmtpAccountId, resolveXmtpAccount } from "./types.js";
import { GET_REGISTRATION_FEE_ABI, REGISTER_ABI, REGISTRATION_FEE_ABI } from "./abis.js";
import { DEFAULT_ERC8004_REGISTRY_ADDRESS } from "./constants.js";

type TokenUriSource = "arg" | "config" | "generated";
type ChainRegistrationStatus = "success" | "already-registered" | "failed" | "dry-run";

export type ParsedXmtp8004RegisterArgs = {
  help: boolean;
  accountId?: string;
  tokenUri?: string;
  chains: string[];
  dryRun: boolean;
  errors: string[];
};

export type Erc8004ChainRegistrationResult = {
  chainId: number;
  chainName: string;
  registryAddress: string;
  rpcUrl: string;
  status: ChainRegistrationStatus;
  registrationFeeWei?: string;
  txHash?: string;
  error?: string;
};

export type Erc8004RegisterResult =
  | {
      kind: "registered";
      accountId: string;
      accountAddress: string;
      tokenUri: string;
      tokenUriSource: TokenUriSource;
      chainResults: Erc8004ChainRegistrationResult[];
    }
  | {
      kind: "needs-token-uri";
      accountId: string;
      accountAddress: string;
      prompt: string;
    };

type ResolvedTargetChain = {
  chain: Chain;
  rpcUrl: string;
  registryAddress: `0x${string}`;
};

type XmtpCommandAccountConfig = {
  tokenUri?: string;
  defaultChains?: Array<string | number>;
  rpcUrls?: Record<string, string>;
  registryAddresses?: Record<string, string>;
};

function normalizeAlias(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function splitChains(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function tokenizeArgs(raw: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const char of raw) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function parseBooleanFlag(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

export function parseXmtp8004RegisterArgs(rawArgs: string | undefined): ParsedXmtp8004RegisterArgs {
  const parsed: ParsedXmtp8004RegisterArgs = {
    help: false,
    chains: [],
    dryRun: false,
    errors: [],
  };
  const tokens = tokenizeArgs(rawArgs?.trim() ?? "");

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const [key, inlineValue] = token.split("=", 2);
    const valueFromNext = () => {
      const next = tokens[i + 1];
      if (!next) {
        parsed.errors.push(`Missing value for ${key}`);
        return "";
      }
      i += 1;
      return next;
    };

    switch (key) {
      case "-h":
      case "--help": {
        parsed.help = true;
        break;
      }
      case "--chains": {
        const value = inlineValue ?? valueFromNext();
        parsed.chains.push(...splitChains(value));
        break;
      }
      case "--token-uri": {
        const value = (inlineValue ?? valueFromNext()).trim();
        if (value) {
          parsed.tokenUri = value;
        } else {
          parsed.errors.push("Missing value for --token-uri");
        }
        break;
      }
      case "--account": {
        const value = (inlineValue ?? valueFromNext()).trim();
        if (value) {
          parsed.accountId = value;
        } else {
          parsed.errors.push("Missing value for --account");
        }
        break;
      }
      case "--dry-run": {
        parsed.dryRun = parseBooleanFlag(inlineValue, true);
        break;
      }
      default: {
        parsed.errors.push(`Unknown option: ${token}`);
      }
    }
  }

  return parsed;
}

function isChainCandidate(value: unknown): value is Chain {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Chain>;
  return (
    typeof candidate.id === "number" &&
    typeof candidate.name === "string" &&
    typeof candidate.rpcUrls === "object"
  );
}

const chainById = new Map<number, Chain>();
const chainByAlias = new Map<string, Chain>();

for (const chainValue of Object.values(viemChains)) {
  if (!isChainCandidate(chainValue)) continue;
  if (chainById.has(chainValue.id)) continue;

  chainById.set(chainValue.id, chainValue);
  chainByAlias.set(normalizeAlias(String(chainValue.id)), chainValue);
  chainByAlias.set(normalizeAlias(chainValue.name), chainValue);

  const maybeShortName = (chainValue as Record<string, unknown>).shortName;
  if (typeof maybeShortName === "string" && maybeShortName.trim()) {
    chainByAlias.set(normalizeAlias(maybeShortName), chainValue);
  }
}

chainById.set(mainnet.id, mainnet);
chainByAlias.set("eth", mainnet);
chainByAlias.set("ethereum", mainnet);
chainByAlias.set("mainnet", mainnet);

function resolveChainByInput(input: string): Chain | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  const eip155Match = /^eip155:(\d+)$/i.exec(trimmed);
  if (eip155Match) {
    return chainById.get(Number.parseInt(eip155Match[1], 10));
  }

  if (/^\d+$/.test(trimmed)) {
    return chainById.get(Number.parseInt(trimmed, 10));
  }

  return chainByAlias.get(normalizeAlias(trimmed));
}

function pickOverride(
  record: Record<string, string> | undefined,
  aliases: string[],
): string | undefined {
  if (!record) return undefined;
  const aliasSet = new Set(aliases.map((item) => normalizeAlias(item)));
  for (const [key, value] of Object.entries(record)) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (aliasSet.has(normalizeAlias(key))) {
      return trimmed;
    }
  }
  return undefined;
}

function resolveRpcUrl(chain: Chain, overrides: Record<string, string> | undefined): string {
  const aliasKeys = [String(chain.id), chain.name, `eip155:${chain.id}`];
  const override = pickOverride(overrides, aliasKeys);
  if (override) {
    return override;
  }
  const defaultUrl = chain.rpcUrls.default.http[0];
  if (typeof defaultUrl === "string" && defaultUrl.trim()) {
    return defaultUrl.trim();
  }
  const publicUrl = chain.rpcUrls.public?.http?.[0];
  if (typeof publicUrl === "string" && publicUrl.trim()) {
    return publicUrl.trim();
  }
  throw new Error(`No RPC URL available for chain ${chain.name} (${chain.id})`);
}

function resolveRegistryAddress(
  chain: Chain,
  overrides: Record<string, string> | undefined,
): `0x${string}` {
  const aliasKeys = [String(chain.id), chain.name, `eip155:${chain.id}`];
  const override = pickOverride(overrides, aliasKeys);
  const rawAddress = override ?? DEFAULT_ERC8004_REGISTRY_ADDRESS;
  if (!isAddress(rawAddress)) {
    throw new Error(`Invalid ERC-8004 registry address for ${chain.name}: ${rawAddress}`);
  }
  return rawAddress.toLowerCase() as `0x${string}`;
}

export function resolveErc8004TargetChains(params: {
  requestedChains?: string[];
  accountErc8004?: XmtpCommandAccountConfig;
}): ResolvedTargetChain[] {
  const fallbackChainInputs = (params.accountErc8004?.defaultChains ?? []).map((entry) =>
    String(entry),
  );
  const rawChainInputs = params.requestedChains?.length
    ? params.requestedChains
    : fallbackChainInputs.length
      ? fallbackChainInputs
      : ["mainnet"];

  const chains: ResolvedTargetChain[] = [];
  const seen = new Set<number>();
  const unknown: string[] = [];

  for (const chainInput of rawChainInputs) {
    const resolved = resolveChainByInput(chainInput);
    if (!resolved) {
      unknown.push(chainInput);
      continue;
    }
    if (seen.has(resolved.id)) continue;
    seen.add(resolved.id);
    chains.push({
      chain: resolved,
      rpcUrl: resolveRpcUrl(resolved, params.accountErc8004?.rpcUrls),
      registryAddress: resolveRegistryAddress(resolved, params.accountErc8004?.registryAddresses),
    });
  }

  if (unknown.length > 0) {
    throw new Error(`Unsupported chain(s): ${unknown.join(", ")}`);
  }

  if (chains.length === 0) {
    chains.push({
      chain: mainnet,
      rpcUrl: resolveRpcUrl(mainnet, params.accountErc8004?.rpcUrls),
      registryAddress: resolveRegistryAddress(mainnet, params.accountErc8004?.registryAddresses),
    });
  }

  return chains;
}

function buildGeneratedTokenUri(params: { accountId: string; accountAddress: string }): string {
  const payload = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Agent",
    active: true,
    services: [
      {
        name: "XMTP",
        endpoint: params.accountAddress,
      },
    ],
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  return `data:application/json;base64,${encoded}`;
}

export function resolveErc8004TokenUri(params: {
  tokenUriArg?: string;
  accountErc8004?: XmtpCommandAccountConfig;
  accountId: string;
  accountAddress: string;
}):
  | { tokenUri: string; source: TokenUriSource }
  | {
      prompt: string;
    } {
  const fromArgs = params.tokenUriArg?.trim();
  if (fromArgs) {
    return { tokenUri: fromArgs, source: "arg" };
  }

  const fromConfig = params.accountErc8004?.tokenUri?.trim();
  if (fromConfig) {
    return { tokenUri: fromConfig, source: "config" };
  }

  const generated = buildGeneratedTokenUri({
    accountId: params.accountId,
    accountAddress: params.accountAddress,
  }).trim();
  if (generated) {
    return { tokenUri: generated, source: "generated" };
  }

  return {
    prompt: "Token URI is required. Provide one with /xmtp-8004-register --token-uri <uri>.",
  };
}

async function readRegistrationFee(params: {
  publicClient: ReturnType<typeof createPublicClient>;
  registryAddress: `0x${string}`;
}): Promise<bigint> {
  try {
    const fee = await params.publicClient.readContract({
      address: params.registryAddress,
      abi: GET_REGISTRATION_FEE_ABI,
      functionName: "getRegistrationFee",
    });
    if (typeof fee === "bigint") {
      return fee;
    }
  } catch {}

  try {
    const fee = await params.publicClient.readContract({
      address: params.registryAddress,
      abi: REGISTRATION_FEE_ABI,
      functionName: "registrationFee",
    });
    if (typeof fee === "bigint") {
      return fee;
    }
  } catch {}

  return 0n;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function registerXmtpAgentOnErc8004(params: {
  cfg: OpenClawConfig;
  commandAccountId?: string;
  overrideAccountId?: string;
  tokenUriArg?: string;
  requestedChains?: string[];
  dryRun?: boolean;
}): Promise<Erc8004RegisterResult> {
  const accountId =
    params.overrideAccountId?.trim() ||
    params.commandAccountId?.trim() ||
    resolveDefaultXmtpAccountId(params.cfg);

  const account = resolveXmtpAccount({ cfg: params.cfg, accountId });
  if (!account.configured) {
    throw new Error(`XMTP account ${accountId} is not configured`);
  }

  const signer = privateKeyToAccount(account.walletKey as `0x${string}`);
  const resolvedAddress = signer.address.toLowerCase();
  const accountErc8004 = account.config.erc8004;

  const tokenResolution = resolveErc8004TokenUri({
    tokenUriArg: params.tokenUriArg,
    accountErc8004,
    accountId,
    accountAddress: resolvedAddress,
  });
  if ("prompt" in tokenResolution) {
    return {
      kind: "needs-token-uri",
      accountId,
      accountAddress: resolvedAddress,
      prompt: tokenResolution.prompt,
    };
  }

  const targets = resolveErc8004TargetChains({
    requestedChains: params.requestedChains,
    accountErc8004,
  });

  const chainResults: Erc8004ChainRegistrationResult[] = [];

  for (const target of targets) {
    try {
      const publicClient = createPublicClient({
        chain: target.chain,
        transport: http(target.rpcUrl),
      });
      const registrationFee = await readRegistrationFee({
        publicClient,
        registryAddress: target.registryAddress,
      });

      if (params.dryRun) {
        chainResults.push({
          chainId: target.chain.id,
          chainName: target.chain.name,
          registryAddress: target.registryAddress,
          rpcUrl: target.rpcUrl,
          status: "dry-run",
          registrationFeeWei: registrationFee.toString(),
        });
        continue;
      }

      const walletClient = createWalletClient({
        account: signer,
        chain: target.chain,
        transport: http(target.rpcUrl),
      });
      const txData = encodeFunctionData({
        abi: REGISTER_ABI,
        functionName: "register",
        args: [tokenResolution.tokenUri],
      });
      const txHash = await walletClient.sendTransaction({
        account: signer,
        to: target.registryAddress,
        data: txData,
        value: registrationFee,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status !== "success") {
        throw new Error("transaction reverted");
      }

      chainResults.push({
        chainId: target.chain.id,
        chainName: target.chain.name,
        registryAddress: target.registryAddress,
        rpcUrl: target.rpcUrl,
        status: "success",
        registrationFeeWei: registrationFee.toString(),
        txHash,
      });
    } catch (error) {
      const message = formatError(error);
      chainResults.push({
        chainId: target.chain.id,
        chainName: target.chain.name,
        registryAddress: target.registryAddress,
        rpcUrl: target.rpcUrl,
        status: /already\s+registered/i.test(message) ? "already-registered" : "failed",
        error: message,
      });
    }
  }

  return {
    kind: "registered",
    accountId,
    accountAddress: resolvedAddress,
    tokenUri: tokenResolution.tokenUri,
    tokenUriSource: tokenResolution.source,
    chainResults,
  };
}
