import { describe, expect, it } from "vitest";
import { mainnet } from "viem/chains";
import {
  parseXmtp8004RegisterArgs,
  resolveErc8004TargetChains,
  resolveErc8004TokenUri,
} from "./erc8004.js";

describe("parseXmtp8004RegisterArgs", () => {
  it("parses supported flags", () => {
    const parsed = parseXmtp8004RegisterArgs(
      '--chains mainnet,base --token-uri "ipfs://agent 1" --account alice',
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.help).toBe(false);
    expect(parsed.chains).toEqual(["mainnet", "base"]);
    expect(parsed.tokenUri).toBe("ipfs://agent 1");
    expect(parsed.accountId).toBe("alice");
    expect(parsed.dryRun).toBe(false);
  });

  it("returns parser errors for unknown flags", () => {
    const parsed = parseXmtp8004RegisterArgs("--bad value");
    expect(parsed.errors).toContain("Unknown option: --bad");
  });

  it("parses --dry-run as true", () => {
    const parsed = parseXmtp8004RegisterArgs("--dry-run");
    expect(parsed.dryRun).toBe(true);
    expect(parsed.errors).toEqual([]);
  });

  it("parses --dry-run=false", () => {
    const parsed = parseXmtp8004RegisterArgs("--dry-run=false");
    expect(parsed.dryRun).toBe(false);
    expect(parsed.errors).toEqual([]);
  });
});

describe("resolveErc8004TargetChains", () => {
  it("defaults to ethereum mainnet when no chains are provided", () => {
    const targets = resolveErc8004TargetChains({});
    expect(targets).toHaveLength(1);
    expect(targets[0].chain.id).toBe(1);
  });

  it("uses configured rpc override when provided", () => {
    const targets = resolveErc8004TargetChains({
      requestedChains: ["1"],
      accountErc8004: {
        rpcUrls: {
          "1": "https://rpc.example.org",
        },
      },
    });
    expect(targets[0].rpcUrl).toBe("https://rpc.example.org");
  });

  it("falls back to viem chain default rpc", () => {
    const targets = resolveErc8004TargetChains({
      requestedChains: ["mainnet"],
      accountErc8004: {
        rpcUrls: {},
      },
    });
    const expected = mainnet.rpcUrls.default.http[0] ?? mainnet.rpcUrls.public?.http?.[0];
    expect(targets[0].rpcUrl).toBe(expected);
  });

  it("throws for unsupported chains", () => {
    expect(() =>
      resolveErc8004TargetChains({
        requestedChains: ["not-a-real-chain"],
      }),
    ).toThrow("Unsupported chain(s): not-a-real-chain");
  });
});

describe("resolveErc8004TokenUri", () => {
  it("prioritizes command token uri", () => {
    const result = resolveErc8004TokenUri({
      tokenUriArg: "ipfs://from-arg",
      accountErc8004: { tokenUri: "ipfs://from-config" },
      accountId: "default",
      accountAddress: "0x1111111111111111111111111111111111111111",
    });
    expect("tokenUri" in result && result.tokenUri).toBe("ipfs://from-arg");
  });

  it("uses config token uri when arg missing", () => {
    const result = resolveErc8004TokenUri({
      accountErc8004: { tokenUri: "ipfs://from-config" },
      accountId: "default",
      accountAddress: "0x1111111111111111111111111111111111111111",
    });
    expect("tokenUri" in result && result.tokenUri).toBe("ipfs://from-config");
  });

  it("auto-generates token uri when arg/config are missing", () => {
    const result = resolveErc8004TokenUri({
      accountId: "default",
      accountAddress: "0x1111111111111111111111111111111111111111",
    });
    expect("tokenUri" in result).toBe(true);
    if ("tokenUri" in result) {
      expect(result.source).toBe("generated");
      expect(result.tokenUri.startsWith("data:application/json;base64,")).toBe(true);
    }
  });
});
