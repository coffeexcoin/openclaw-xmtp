import { describe, expect, it } from "vitest";
import { listXmtpAccountIds, resolveDefaultXmtpAccountId, resolveXmtpAccount } from "./types.js";

const TEST_WALLET_KEY = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TEST_DB_KEY = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const TEST_WALLET_KEY_2 = "0xfedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const TEST_DB_KEY_2 = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

describe("listXmtpAccountIds", () => {
  it("returns empty array when not configured", () => {
    const cfg = { channels: {} };
    expect(listXmtpAccountIds(cfg)).toEqual([]);
  });

  it("returns default when wallet key exists", () => {
    const cfg = {
      channels: {
        xmtp: {
          walletKey: TEST_WALLET_KEY,
        },
      },
    };
    expect(listXmtpAccountIds(cfg)).toEqual(["default"]);
  });

  it("returns account keys when accounts record is present", () => {
    const cfg = {
      channels: {
        xmtp: {
          accounts: {
            alice: { walletKey: TEST_WALLET_KEY, dbEncryptionKey: TEST_DB_KEY },
            bob: { walletKey: TEST_WALLET_KEY_2, dbEncryptionKey: TEST_DB_KEY_2 },
          },
        },
      },
    };
    expect(listXmtpAccountIds(cfg)).toEqual(["alice", "bob"]);
  });

  it("does not add implicit default from env vars when accounts record is present", () => {
    const originalWalletKey = process.env.XMTP_WALLET_KEY;
    const originalDbKey = process.env.XMTP_DB_ENCRYPTION_KEY;
    try {
      process.env.XMTP_WALLET_KEY = TEST_WALLET_KEY;
      process.env.XMTP_DB_ENCRYPTION_KEY = TEST_DB_KEY;

      const cfg = {
        channels: {
          xmtp: {
            accounts: {
              myaccount: { walletKey: TEST_WALLET_KEY_2, dbEncryptionKey: TEST_DB_KEY_2 },
            },
          },
        },
      };
      const ids = listXmtpAccountIds(cfg);
      expect(ids).toEqual(["myaccount"]);
      expect(ids).not.toContain("default");
    } finally {
      if (originalWalletKey === undefined) {
        delete process.env.XMTP_WALLET_KEY;
      } else {
        process.env.XMTP_WALLET_KEY = originalWalletKey;
      }
      if (originalDbKey === undefined) {
        delete process.env.XMTP_DB_ENCRYPTION_KEY;
      } else {
        process.env.XMTP_DB_ENCRYPTION_KEY = originalDbKey;
      }
    }
  });
});

describe("resolveDefaultXmtpAccountId", () => {
  it("returns default when configured", () => {
    const cfg = {
      channels: {
        xmtp: {
          walletKey: TEST_WALLET_KEY,
        },
      },
    };
    expect(resolveDefaultXmtpAccountId(cfg)).toBe("default");
  });

  it("returns default when unconfigured", () => {
    const cfg = { channels: {} };
    expect(resolveDefaultXmtpAccountId(cfg)).toBe("default");
  });
});

describe("resolveXmtpAccount", () => {
  it("resolves configured account and derives address", () => {
    const cfg = {
      channels: {
        xmtp: {
          name: "XMTP Bot",
          enabled: true,
          walletKey: TEST_WALLET_KEY,
          dbEncryptionKey: TEST_DB_KEY,
          env: "dev" as const,
          dbPath: "/tmp/xmtp",
          dmPolicy: "pairing" as const,
          allowFrom: ["0x1234567890abcdef1234567890abcdef12345678"],
        },
      },
    };

    const account = resolveXmtpAccount({ cfg });

    expect(account.accountId).toBe("default");
    expect(account.name).toBe("XMTP Bot");
    expect(account.enabled).toBe(true);
    expect(account.configured).toBe(true);
    expect(account.walletKey).toBe(TEST_WALLET_KEY);
    expect(account.walletKeySource).toBe("config");
    expect(account.dbEncryptionKey).toBe(TEST_DB_KEY);
    expect(account.dbEncryptionKeySource).toBe("config");
    expect(account.address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(account.env).toBe("dev");
    expect(account.config).toEqual({
      name: "XMTP Bot",
      enabled: true,
      walletKey: TEST_WALLET_KEY,
      walletKeyFile: undefined,
      dbEncryptionKey: TEST_DB_KEY,
      dbEncryptionKeyFile: undefined,
      env: "dev",
      dbPath: "/tmp/xmtp",
      dmPolicy: "pairing",
      allowFrom: ["0x1234567890abcdef1234567890abcdef12345678"],
      groupPolicy: undefined,
      groupAllowFrom: undefined,
      erc8004: undefined,
    });
  });

  it("resolves unconfigured account with defaults", () => {
    const cfg = { channels: {} };
    const account = resolveXmtpAccount({ cfg });

    expect(account.accountId).toBe("default");
    expect(account.enabled).toBe(true);
    expect(account.configured).toBe(false);
    expect(account.walletKey).toBe("");
    expect(account.walletKeySource).toBe("none");
    expect(account.dbEncryptionKey).toBe("");
    expect(account.dbEncryptionKeySource).toBe("none");
    expect(account.address).toBe("");
    expect(account.env).toBe("production");
  });

  it("handles disabled channel", () => {
    const cfg = {
      channels: {
        xmtp: {
          enabled: false,
          walletKey: TEST_WALLET_KEY,
          dbEncryptionKey: TEST_DB_KEY,
        },
      },
    };

    const account = resolveXmtpAccount({ cfg });
    expect(account.enabled).toBe(false);
    expect(account.configured).toBe(true);
    expect(account.walletKeySource).toBe("config");
    expect(account.dbEncryptionKeySource).toBe("config");
  });

  it("uses provided accountId", () => {
    const cfg = {
      channels: {
        xmtp: {
          walletKey: TEST_WALLET_KEY,
          dbEncryptionKey: TEST_DB_KEY,
        },
      },
    };

    const account = resolveXmtpAccount({ cfg, accountId: "custom" });
    expect(account.accountId).toBe("custom");
  });

  it("handles invalid wallet key gracefully", () => {
    const cfg = {
      channels: {
        xmtp: {
          walletKey: "not-a-private-key",
          dbEncryptionKey: TEST_DB_KEY,
        },
      },
    };

    const account = resolveXmtpAccount({ cfg });
    expect(account.configured).toBe(true);
    expect(account.address).toBe("");
    expect(account.walletKeySource).toBe("config");
    expect(account.dbEncryptionKeySource).toBe("config");
  });

  it("merges top-level defaults with per-account overrides", () => {
    const cfg = {
      channels: {
        xmtp: {
          env: "dev" as const,
          dmPolicy: "pairing" as const,
          accounts: {
            alice: {
              walletKey: TEST_WALLET_KEY,
              dbEncryptionKey: TEST_DB_KEY,
              env: "production" as const,
            },
          },
        },
      },
    };

    const account = resolveXmtpAccount({ cfg, accountId: "alice" });
    // Per-account override wins
    expect(account.env).toBe("production");
    // Top-level default inherited
    expect(account.config.dmPolicy).toBe("pairing");
    expect(account.configured).toBe(true);
  });

  it("per-account override wins over top-level for same field", () => {
    const cfg = {
      channels: {
        xmtp: {
          dmPolicy: "open" as const,
          groupPolicy: "disabled" as const,
          accounts: {
            bob: {
              walletKey: TEST_WALLET_KEY,
              dbEncryptionKey: TEST_DB_KEY,
              dmPolicy: "allowlist" as const,
              groupPolicy: "open" as const,
            },
          },
        },
      },
    };

    const account = resolveXmtpAccount({ cfg, accountId: "bob" });
    expect(account.config.dmPolicy).toBe("allowlist");
    expect(account.config.groupPolicy).toBe("open");
  });

  it("backward compat: single-account config without accounts field works identically", () => {
    const cfg = {
      channels: {
        xmtp: {
          walletKey: TEST_WALLET_KEY,
          dbEncryptionKey: TEST_DB_KEY,
          env: "dev" as const,
          dmPolicy: "open" as const,
        },
      },
    };

    const account = resolveXmtpAccount({ cfg });
    expect(account.accountId).toBe("default");
    expect(account.configured).toBe(true);
    expect(account.env).toBe("dev");
    expect(account.config.dmPolicy).toBe("open");
  });

  it("includes group fields in config", () => {
    const cfg = {
      channels: {
        xmtp: {
          walletKey: TEST_WALLET_KEY,
          dbEncryptionKey: TEST_DB_KEY,
          groupPolicy: "allowlist" as const,
          groupAllowFrom: ["0x1234567890abcdef1234567890abcdef12345678"],
        },
      },
    };

    const account = resolveXmtpAccount({ cfg });
    expect(account.config.groupPolicy).toBe("allowlist");
    expect(account.config.groupAllowFrom).toEqual(["0x1234567890abcdef1234567890abcdef12345678"]);
  });
});
