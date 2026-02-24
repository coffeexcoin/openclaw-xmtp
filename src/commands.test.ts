import { describe, expect, it, vi, beforeEach } from "vitest";
import { commands } from "./commands.js";

const mockBuses = vi.hoisted(() => {
  const buses = new Map<
    string,
    {
      getAddress: () => string;
      getInboxId: () => string | undefined;
    }
  >();
  return { buses };
});

const erc8004Mock = vi.hoisted(() => ({
  parseXmtp8004RegisterArgs: vi.fn(),
  registerXmtpAgentOnErc8004: vi.fn(),
}));

vi.mock("./channel.js", () => ({
  getActiveBuses: () => new Map(mockBuses.buses),
}));

vi.mock("./erc8004.js", () => ({
  parseXmtp8004RegisterArgs: erc8004Mock.parseXmtp8004RegisterArgs,
  registerXmtpAgentOnErc8004: erc8004Mock.registerXmtpAgentOnErc8004,
}));

describe("commands", () => {
  beforeEach(() => {
    mockBuses.buses.clear();
    erc8004Mock.parseXmtp8004RegisterArgs.mockReset();
    erc8004Mock.registerXmtpAgentOnErc8004.mockReset();
  });

  describe("/xmtp-address", () => {
    it("returns no accounts message when no buses are running", async () => {
      const result = await commands["xmtp-address"].handler();
      expect(result).toEqual({ text: "No XMTP accounts are currently connected." });
    });

    it("shows address and inbox ID for running bus", async () => {
      mockBuses.buses.set("default", {
        getAddress: () => "0xaabbccddeeff0011223344556677889900aabbcc",
        getInboxId: () => "inbox-abc-123",
      });

      const result = await commands["xmtp-address"].handler();
      expect(result.text).toContain("XMTP Agent Addresses:");
      expect(result.text).toContain("default: 0xaabbccddeeff0011223344556677889900aabbcc");
      expect(result.text).toContain("inbox: inbox-abc-123");
    });

    it("shows address without inbox ID when not available", async () => {
      mockBuses.buses.set("default", {
        getAddress: () => "0xaabbccddeeff0011223344556677889900aabbcc",
        getInboxId: () => undefined,
      });

      const result = await commands["xmtp-address"].handler();
      expect(result.text).toContain("default: 0xaabbccddeeff0011223344556677889900aabbcc");
      expect(result.text).not.toContain("inbox:");
    });
  });

  describe("/xmtp-groups", () => {
    it("returns no accounts message when no buses are running", async () => {
      const result = await commands["xmtp-groups"].handler();
      expect(result).toEqual({ text: "No XMTP accounts are currently connected." });
    });

    it("lists connected accounts", async () => {
      mockBuses.buses.set("alice", {
        getAddress: () => "0x1111111111111111111111111111111111111111",
        getInboxId: () => "inbox-1",
      });
      mockBuses.buses.set("bob", {
        getAddress: () => "0x2222222222222222222222222222222222222222",
        getInboxId: () => "inbox-2",
      });

      const result = await commands["xmtp-groups"].handler();
      expect(result.text).toContain("XMTP Conversations:");
      expect(result.text).toContain("Account: alice");
      expect(result.text).toContain("Account: bob");
      expect(result.text).toContain("Use XMTP client apps to view full conversation list");
    });
  });

  describe("/xmtp-8004-register", () => {
    it("shows help text when parser reports help", async () => {
      erc8004Mock.parseXmtp8004RegisterArgs.mockReturnValue({
        help: true,
        chains: [],
        dryRun: false,
        errors: [],
      });

      const result = await commands["xmtp-8004-register"].handler({
        args: "--help",
      });

      expect(result.text).toContain("Usage: /xmtp-8004-register [options]");
      expect(erc8004Mock.registerXmtpAgentOnErc8004).not.toHaveBeenCalled();
    });

    it("returns parser errors", async () => {
      erc8004Mock.parseXmtp8004RegisterArgs.mockReturnValue({
        help: false,
        chains: [],
        dryRun: false,
        errors: ["Unknown option: --bad"],
      });

      const result = await commands["xmtp-8004-register"].handler({
        args: "--bad",
      });

      expect(result.text).toContain("Invalid arguments:");
      expect(result.text).toContain("Unknown option: --bad");
      expect(erc8004Mock.registerXmtpAgentOnErc8004).not.toHaveBeenCalled();
    });

    it("requires command context config", async () => {
      erc8004Mock.parseXmtp8004RegisterArgs.mockReturnValue({
        help: false,
        chains: [],
        dryRun: false,
        errors: [],
      });

      const result = await commands["xmtp-8004-register"].handler({
        args: "",
      });

      expect(result).toEqual({ text: "Unable to register: command context is missing config." });
      expect(erc8004Mock.registerXmtpAgentOnErc8004).not.toHaveBeenCalled();
    });

    it("formats successful multi-chain output", async () => {
      erc8004Mock.parseXmtp8004RegisterArgs.mockReturnValue({
        help: false,
        chains: ["mainnet", "base"],
        dryRun: false,
        errors: [],
        tokenUri: "ipfs://agent",
        accountId: "alice",
      });
      erc8004Mock.registerXmtpAgentOnErc8004.mockResolvedValue({
        kind: "registered",
        accountId: "alice",
        accountAddress: "0xabc",
        tokenUri: "ipfs://agent",
        tokenUriSource: "arg",
        chainResults: [
          {
            chainId: 1,
            chainName: "Ethereum",
            registryAddress: "0x1",
            rpcUrl: "https://rpc1",
            status: "success",
            registrationFeeWei: "1000",
            txHash: "0xtx1",
          },
          {
            chainId: 8453,
            chainName: "Base",
            registryAddress: "0x2",
            rpcUrl: "https://rpc2",
            status: "failed",
            error: "boom",
          },
        ],
      });

      const config = { channels: { xmtp: {} } };
      const result = await commands["xmtp-8004-register"].handler({
        args: "--chains mainnet,base",
        accountId: "default",
        config,
      });

      expect(erc8004Mock.registerXmtpAgentOnErc8004).toHaveBeenCalledWith({
        cfg: config,
        commandAccountId: "default",
        overrideAccountId: "alice",
        tokenUriArg: "ipfs://agent",
        requestedChains: ["mainnet", "base"],
        dryRun: false,
      });
      expect(result.text).toContain(
        "summary: 1 registered, 0 already registered, 0 dry-run, 1 failed",
      );
      expect(result.text).toContain("mode: live");
      expect(result.text).toContain("feeWei=1000");
      expect(result.text).toContain("Ethereum (1): registered");
      expect(result.text).toContain("Base (8453): failed");
    });

    it("returns token URI prompt when registration flow asks for one", async () => {
      erc8004Mock.parseXmtp8004RegisterArgs.mockReturnValue({
        help: false,
        chains: [],
        dryRun: false,
        errors: [],
      });
      erc8004Mock.registerXmtpAgentOnErc8004.mockResolvedValue({
        kind: "needs-token-uri",
        accountId: "default",
        accountAddress: "0xabc",
        prompt: "Provide a token URI.",
      });

      const result = await commands["xmtp-8004-register"].handler({
        args: "",
        config: { channels: { xmtp: {} } },
      });

      expect(result.text).toContain("ERC-8004 registration not started");
      expect(result.text).toContain("Provide a token URI.");
    });

    it("shows dry-run mode and summary when --dry-run is enabled", async () => {
      erc8004Mock.parseXmtp8004RegisterArgs.mockReturnValue({
        help: false,
        chains: ["mainnet"],
        dryRun: true,
        errors: [],
      });
      erc8004Mock.registerXmtpAgentOnErc8004.mockResolvedValue({
        kind: "registered",
        accountId: "default",
        accountAddress: "0xabc",
        tokenUri: "data:application/json;base64,abc",
        tokenUriSource: "generated",
        chainResults: [
          {
            chainId: 1,
            chainName: "Ethereum",
            registryAddress: "0x1",
            rpcUrl: "https://rpc1",
            status: "dry-run",
            registrationFeeWei: "42",
          },
        ],
      });

      const result = await commands["xmtp-8004-register"].handler({
        args: "--dry-run",
        config: { channels: { xmtp: {} } },
      });

      expect(result.text).toContain("mode: dry-run (no transactions sent)");
      expect(result.text).toContain(
        "summary: 0 registered, 0 already registered, 1 dry-run, 0 failed",
      );
      expect(result.text).toContain("Ethereum (1): dry run");
      expect(result.text).toContain("feeWei=42");
    });
  });
});
