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

vi.mock("./channel.js", () => ({
  getActiveBuses: () => new Map(mockBuses.buses),
}));

describe("commands", () => {
  beforeEach(() => {
    mockBuses.buses.clear();
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
});
