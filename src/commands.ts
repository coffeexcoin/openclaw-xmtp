import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { getActiveBuses } from "./channel.js";
import {
  parseXmtp8004RegisterArgs,
  registerXmtpAgentOnErc8004,
  type Erc8004ChainRegistrationResult,
} from "./erc8004.js";

type CommandContext = {
  args?: string;
  accountId?: string;
  config?: OpenClawConfig;
};

type CommandDefinition = {
  description: string;
  acceptsArgs?: boolean;
  handler: (ctx?: CommandContext) => Promise<{ text: string }>;
};

function formatErc8004Result(result: Erc8004ChainRegistrationResult): string {
  const statusLabel =
    result.status === "success"
      ? "registered"
      : result.status === "already-registered"
        ? "already registered"
        : result.status === "dry-run"
          ? "dry run"
          : "failed";
  const parts = [`- ${result.chainName} (${result.chainId}): ${statusLabel}`];
  if (result.registrationFeeWei) {
    parts.push(`feeWei=${result.registrationFeeWei}`);
  }
  if (result.txHash) {
    parts.push(`tx=${result.txHash}`);
  }
  if (result.error) {
    parts.push(`error=${result.error}`);
  }
  return parts.join(" ");
}

function getRegisterHelpText(): string {
  return [
    "Usage: /xmtp-8004-register [options]",
    "",
    "Options:",
    "  --chains <csv>       Chain names/ids (example: mainnet,base or 1,8453)",
    "  --token-uri <uri>    ERC-8004 token URI (optional; auto-generated if omitted)",
    "  --account <id>       XMTP account id (optional)",
    "  --dry-run            Validate and preview registration without sending transactions",
    "  --help               Show this help",
    "",
    "Defaults:",
    "  chain: mainnet (if no chains provided in args/config)",
    "  rpc: viem public chain rpc (if no custom rpc configured)",
  ].join("\n");
}

export const commands: Record<string, CommandDefinition> = {
  "xmtp-address": {
    description: "Show XMTP agent address(es)",
    async handler(): Promise<{ text: string }> {
      const buses = getActiveBuses();
      if (buses.size === 0) {
        return { text: "No XMTP accounts are currently connected." };
      }

      const lines: string[] = ["XMTP Agent Addresses:"];
      for (const [accountId, bus] of buses) {
        const address = bus.getAddress();
        const inboxId = bus.getInboxId();
        lines.push(`  ${accountId}: ${address ?? "unknown"}`);
        if (inboxId) {
          lines.push(`    inbox: ${inboxId}`);
        }
      }
      return { text: lines.join("\n") };
    },
  },

  "xmtp-groups": {
    description: "List XMTP conversations",
    async handler(): Promise<{ text: string }> {
      const buses = getActiveBuses();
      if (buses.size === 0) {
        return { text: "No XMTP accounts are currently connected." };
      }

      const lines: string[] = ["XMTP Conversations:"];
      for (const [accountId] of buses) {
        lines.push(`  Account: ${accountId}`);
        lines.push("    (Use XMTP client apps to view full conversation list)");
      }
      return { text: lines.join("\n") };
    },
  },

  "xmtp-8004-register": {
    description: "Register XMTP agent wallet in ERC-8004 registry (one or more chains)",
    acceptsArgs: true,
    async handler(ctx): Promise<{ text: string }> {
      const parsed = parseXmtp8004RegisterArgs(ctx?.args);
      if (parsed.help) {
        return { text: getRegisterHelpText() };
      }
      if (parsed.errors.length > 0) {
        return {
          text: [
            `Invalid arguments:`,
            ...parsed.errors.map((error) => `- ${error}`),
            "",
            getRegisterHelpText(),
          ].join("\n"),
        };
      }
      if (!ctx?.config) {
        return { text: "Unable to register: command context is missing config." };
      }

      const result = await registerXmtpAgentOnErc8004({
        cfg: ctx.config,
        commandAccountId: ctx.accountId,
        overrideAccountId: parsed.accountId,
        tokenUriArg: parsed.tokenUri,
        requestedChains: parsed.chains,
        dryRun: parsed.dryRun,
      });

      if (result.kind === "needs-token-uri") {
        return {
          text: [
            `ERC-8004 registration not started for account ${result.accountId} (${result.accountAddress}).`,
            result.prompt,
          ].join("\n"),
        };
      }

      const successCount = result.chainResults.filter((item) => item.status === "success").length;
      const alreadyRegisteredCount = result.chainResults.filter(
        (item) => item.status === "already-registered",
      ).length;
      const dryRunCount = result.chainResults.filter((item) => item.status === "dry-run").length;
      const failedCount =
        result.chainResults.length - successCount - alreadyRegisteredCount - dryRunCount;

      return {
        text: [
          `ERC-8004 registration account: ${result.accountId}`,
          `wallet: ${result.accountAddress}`,
          parsed.dryRun ? `mode: dry-run (no transactions sent)` : `mode: live`,
          `tokenUriSource: ${result.tokenUriSource}`,
          `tokenUri: ${result.tokenUri}`,
          `summary: ${successCount} registered, ${alreadyRegisteredCount} already registered, ${dryRunCount} dry-run, ${failedCount} failed`,
          "",
          ...result.chainResults.map((item) => formatErc8004Result(item)),
        ].join("\n"),
      };
    },
  },
};
