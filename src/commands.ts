import { getActiveBuses } from "./channel.js";

export const commands = {
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
};
