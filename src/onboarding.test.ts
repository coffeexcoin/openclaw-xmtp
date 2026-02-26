import { describe, expect, it, vi } from "vitest";
import type { WizardPrompter, OpenClawConfig } from "openclaw/plugin-sdk";
import { xmtpOnboardingAdapter } from "./onboarding.js";

const TEST_WALLET_KEY = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TEST_DB_KEY = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd";

function createMockPrompter(overrides: Partial<WizardPrompter> = {}): WizardPrompter {
  return {
    intro: vi.fn().mockResolvedValue(undefined),
    outro: vi.fn().mockResolvedValue(undefined),
    note: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockResolvedValue("generate"),
    multiselect: vi.fn().mockResolvedValue([]),
    text: vi.fn().mockResolvedValue(""),
    confirm: vi.fn().mockResolvedValue(true),
    progress: vi.fn().mockReturnValue({ update: vi.fn(), stop: vi.fn() }),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getStatus
// ---------------------------------------------------------------------------

describe("getStatus", () => {
  it("returns configured: false with empty config", async () => {
    const cfg = { channels: {} } as OpenClawConfig;
    const result = await xmtpOnboardingAdapter.getStatus({
      cfg,
      accountOverrides: {},
    });
    expect(result.configured).toBe(false);
    expect(result.channel).toBe("xmtp");
    expect(result.statusLines).toContain("XMTP: needs setup");
    expect(result.quickstartScore).toBe(0);
  });

  it("returns configured: true when account has walletKey + dbEncryptionKey", async () => {
    const cfg = {
      channels: {
        xmtp: {
          walletKey: TEST_WALLET_KEY,
          dbEncryptionKey: TEST_DB_KEY,
        },
      },
    } as OpenClawConfig;
    const result = await xmtpOnboardingAdapter.getStatus({
      cfg,
      accountOverrides: {},
    });
    expect(result.configured).toBe(true);
    expect(result.channel).toBe("xmtp");
    expect(result.statusLines[0]).toMatch(/1 account configured/);
    expect(result.quickstartScore).toBe(1);
    expect(result.selectionHint).toBe("configured");
  });

  it("returns configured: true when account has walletKeyFile + dbEncryptionKeyFile", async () => {
    const cfg = {
      channels: {
        xmtp: {
          walletKeyFile: "/some/path/wallet.key",
          dbEncryptionKeyFile: "/some/path/db.key",
        },
      },
    } as OpenClawConfig;
    const result = await xmtpOnboardingAdapter.getStatus({
      cfg,
      accountOverrides: {},
    });
    expect(result.configured).toBe(true);
  });

  it("does NOT throw when config references nonexistent files", async () => {
    const cfg = {
      channels: {
        xmtp: {
          walletKeyFile: "/nonexistent/path/wallet.key",
          dbEncryptionKeyFile: "/nonexistent/path/db.key",
        },
      },
    } as OpenClawConfig;
    // Should not throw — getStatus does no file I/O
    const result = await xmtpOnboardingAdapter.getStatus({
      cfg,
      accountOverrides: {},
    });
    expect(result.configured).toBe(true);
  });

  it("includes channel: 'xmtp' in result", async () => {
    const cfg = { channels: {} } as OpenClawConfig;
    const result = await xmtpOnboardingAdapter.getStatus({
      cfg,
      accountOverrides: {},
    });
    expect(result.channel).toBe("xmtp");
  });

  it("counts multiple configured accounts", async () => {
    const cfg = {
      channels: {
        xmtp: {
          accounts: {
            alice: { walletKey: TEST_WALLET_KEY, dbEncryptionKey: TEST_DB_KEY },
            bob: { walletKey: TEST_WALLET_KEY, dbEncryptionKey: TEST_DB_KEY },
          },
        },
      },
    } as OpenClawConfig;
    const result = await xmtpOnboardingAdapter.getStatus({
      cfg,
      accountOverrides: {},
    });
    expect(result.configured).toBe(true);
    expect(result.statusLines[0]).toMatch(/2 accounts configured/);
  });

  it("returns configured via env vars for default account", async () => {
    const origWallet = process.env.XMTP_WALLET_KEY;
    const origDb = process.env.XMTP_DB_ENCRYPTION_KEY;
    try {
      process.env.XMTP_WALLET_KEY = TEST_WALLET_KEY;
      process.env.XMTP_DB_ENCRYPTION_KEY = TEST_DB_KEY;

      const cfg = { channels: { xmtp: {} } } as OpenClawConfig;
      const result = await xmtpOnboardingAdapter.getStatus({
        cfg,
        accountOverrides: {},
      });
      expect(result.configured).toBe(true);
    } finally {
      if (origWallet === undefined) delete process.env.XMTP_WALLET_KEY;
      else process.env.XMTP_WALLET_KEY = origWallet;
      if (origDb === undefined) delete process.env.XMTP_DB_ENCRYPTION_KEY;
      else process.env.XMTP_DB_ENCRYPTION_KEY = origDb;
    }
  });
});

// ---------------------------------------------------------------------------
// configure
// ---------------------------------------------------------------------------

describe("configure", () => {
  const baseCtx = {
    runtime: {} as never,
    accountOverrides: {} as Record<string, string>,
    shouldPromptAccountIds: false,
    forceAllowFrom: false,
  };

  it("generates wallet key and db encryption key", async () => {
    const prompter = createMockPrompter({
      select: vi
        .fn()
        .mockResolvedValueOnce("generate") // wallet method
        .mockResolvedValueOnce("generate") // db method
        .mockResolvedValueOnce("production"), // env
    });

    const cfg = { channels: {} } as OpenClawConfig;
    const result = await xmtpOnboardingAdapter.configure({
      ...baseCtx,
      cfg,
      prompter,
    });

    const xmtp = (result.cfg.channels as Record<string, unknown>).xmtp as Record<string, unknown>;
    expect(xmtp.walletKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(xmtp.dbEncryptionKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(xmtp.env).toBe("production");
    expect(xmtp.enabled).toBe(true);
  });

  it("applies pasted keys to correct config location", async () => {
    const prompter = createMockPrompter({
      select: vi
        .fn()
        .mockResolvedValueOnce("paste") // wallet method
        .mockResolvedValueOnce("paste") // db method
        .mockResolvedValueOnce("dev"), // env
      text: vi
        .fn()
        .mockResolvedValueOnce(TEST_WALLET_KEY) // wallet key
        .mockResolvedValueOnce(TEST_DB_KEY), // db key
    });

    const cfg = { channels: {} } as OpenClawConfig;
    const result = await xmtpOnboardingAdapter.configure({
      ...baseCtx,
      cfg,
      prompter,
    });

    const xmtp = (result.cfg.channels as Record<string, unknown>).xmtp as Record<string, unknown>;
    expect(xmtp.walletKey).toBe(TEST_WALLET_KEY);
    expect(xmtp.dbEncryptionKey).toBe(TEST_DB_KEY);
    expect(xmtp.env).toBe("dev");
  });

  it("applies file paths to walletKeyFile and dbEncryptionKeyFile", async () => {
    const prompter = createMockPrompter({
      select: vi
        .fn()
        .mockResolvedValueOnce("file") // wallet method
        .mockResolvedValueOnce("file") // db method
        .mockResolvedValueOnce("production"), // env
      text: vi
        .fn()
        .mockResolvedValueOnce("/path/to/wallet.key")
        .mockResolvedValueOnce("/path/to/db.key"),
    });

    const cfg = { channels: {} } as OpenClawConfig;
    const result = await xmtpOnboardingAdapter.configure({
      ...baseCtx,
      cfg,
      prompter,
    });

    const xmtp = (result.cfg.channels as Record<string, unknown>).xmtp as Record<string, unknown>;
    expect(xmtp.walletKeyFile).toBe("/path/to/wallet.key");
    expect(xmtp.dbEncryptionKeyFile).toBe("/path/to/db.key");
    expect(xmtp.walletKey).toBeUndefined();
    expect(xmtp.dbEncryptionKey).toBeUndefined();
  });

  it("handles named account (nests under accounts)", async () => {
    const prompter = createMockPrompter({
      select: vi
        .fn()
        .mockResolvedValueOnce("paste") // wallet method
        .mockResolvedValueOnce("paste") // db method
        .mockResolvedValueOnce("production"), // env
      text: vi.fn().mockResolvedValueOnce(TEST_WALLET_KEY).mockResolvedValueOnce(TEST_DB_KEY),
    });

    const cfg = { channels: {} } as OpenClawConfig;
    const result = await xmtpOnboardingAdapter.configure({
      ...baseCtx,
      cfg,
      prompter,
      accountOverrides: { xmtp: "alice" },
    });

    expect(result.accountId).toBe("alice");
    const xmtp = (result.cfg.channels as Record<string, unknown>).xmtp as Record<string, unknown>;
    const accounts = xmtp.accounts as Record<string, Record<string, unknown>>;
    expect(accounts.alice.walletKey).toBe(TEST_WALLET_KEY);
    expect(accounts.alice.dbEncryptionKey).toBe(TEST_DB_KEY);
  });

  it("respects existing wallet key when user confirms keep", async () => {
    const prompter = createMockPrompter({
      confirm: vi
        .fn()
        .mockResolvedValueOnce(true) // keep existing wallet
        .mockResolvedValueOnce(true) // keep existing db
        .mockResolvedValueOnce(true), // keep existing env
    });

    const cfg = {
      channels: {
        xmtp: {
          walletKey: TEST_WALLET_KEY,
          dbEncryptionKey: TEST_DB_KEY,
          env: "production",
        },
      },
    } as OpenClawConfig;

    const result = await xmtpOnboardingAdapter.configure({
      ...baseCtx,
      cfg,
      prompter,
    });

    const xmtp = (result.cfg.channels as Record<string, unknown>).xmtp as Record<string, unknown>;
    // Should keep existing values — no new walletKey/dbEncryptionKey set
    expect(xmtp.walletKey).toBe(TEST_WALLET_KEY);
    expect(xmtp.dbEncryptionKey).toBe(TEST_DB_KEY);
    expect(xmtp.enabled).toBe(true);
  });

  it("replaces existing wallet key when user declines keep", async () => {
    const prompter = createMockPrompter({
      confirm: vi
        .fn()
        .mockResolvedValueOnce(false) // don't keep wallet
        .mockResolvedValueOnce(true) // keep db
        .mockResolvedValueOnce(true), // keep env
      select: vi.fn().mockResolvedValueOnce("generate"), // wallet method
    });

    const cfg = {
      channels: {
        xmtp: {
          walletKey: TEST_WALLET_KEY,
          dbEncryptionKey: TEST_DB_KEY,
          env: "dev",
        },
      },
    } as OpenClawConfig;

    const result = await xmtpOnboardingAdapter.configure({
      ...baseCtx,
      cfg,
      prompter,
    });

    const xmtp = (result.cfg.channels as Record<string, unknown>).xmtp as Record<string, unknown>;
    // Should have a new generated key
    expect(xmtp.walletKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(xmtp.walletKey).not.toBe(TEST_WALLET_KEY);
    // DB key should be preserved from existing config
    expect(xmtp.dbEncryptionKey).toBe(TEST_DB_KEY);
  });

  it("returns accountId for default account", async () => {
    const prompter = createMockPrompter({
      select: vi
        .fn()
        .mockResolvedValueOnce("generate")
        .mockResolvedValueOnce("generate")
        .mockResolvedValueOnce("production"),
    });

    const cfg = { channels: {} } as OpenClawConfig;
    const result = await xmtpOnboardingAdapter.configure({
      ...baseCtx,
      cfg,
      prompter,
    });

    expect(result.accountId).toBe("default");
  });
});

// ---------------------------------------------------------------------------
// dmPolicy
// ---------------------------------------------------------------------------

describe("dmPolicy", () => {
  const dm = xmtpOnboardingAdapter.dmPolicy!;

  it("getCurrent returns correct policy from config", () => {
    const cfg = {
      channels: { xmtp: { dmPolicy: "allowlist" } },
    } as OpenClawConfig;
    expect(dm.getCurrent(cfg)).toBe("allowlist");
  });

  it("getCurrent returns pairing as default", () => {
    const cfg = { channels: {} } as OpenClawConfig;
    expect(dm.getCurrent(cfg)).toBe("pairing");
  });

  it("setPolicy writes policy to correct config path", () => {
    const cfg = { channels: {} } as OpenClawConfig;
    const result = dm.setPolicy(cfg, "allowlist");
    const xmtp = (result.channels as Record<string, unknown>).xmtp as Record<string, unknown>;
    expect(xmtp.dmPolicy).toBe("allowlist");
  });

  it("setPolicy('open') adds wildcard to allowFrom", () => {
    const cfg = { channels: {} } as OpenClawConfig;
    const result = dm.setPolicy(cfg, "open");
    const xmtp = (result.channels as Record<string, unknown>).xmtp as Record<string, unknown>;
    expect(xmtp.dmPolicy).toBe("open");
    expect(xmtp.allowFrom).toContain("*");
  });

  it("setPolicy preserves existing config fields", () => {
    const cfg = {
      channels: {
        xmtp: {
          walletKey: TEST_WALLET_KEY,
          env: "dev",
        },
      },
    } as OpenClawConfig;
    const result = dm.setPolicy(cfg, "pairing");
    const xmtp = (result.channels as Record<string, unknown>).xmtp as Record<string, unknown>;
    expect(xmtp.dmPolicy).toBe("pairing");
    expect(xmtp.walletKey).toBe(TEST_WALLET_KEY);
    expect(xmtp.env).toBe("dev");
  });
});

// ---------------------------------------------------------------------------
// disable
// ---------------------------------------------------------------------------

describe("disable", () => {
  it("sets enabled: false", () => {
    const cfg = {
      channels: {
        xmtp: {
          walletKey: TEST_WALLET_KEY,
          dbEncryptionKey: TEST_DB_KEY,
          enabled: true,
        },
      },
    } as OpenClawConfig;
    const result = xmtpOnboardingAdapter.disable!(cfg);
    const xmtp = (result.channels as Record<string, unknown>).xmtp as Record<string, unknown>;
    expect(xmtp.enabled).toBe(false);
    // Should preserve other fields
    expect(xmtp.walletKey).toBe(TEST_WALLET_KEY);
    expect(xmtp.dbEncryptionKey).toBe(TEST_DB_KEY);
  });
});

// ---------------------------------------------------------------------------
// error/cancel tests
// ---------------------------------------------------------------------------

describe("error handling", () => {
  const baseCtx = {
    runtime: {} as never,
    accountOverrides: {} as Record<string, string>,
    shouldPromptAccountIds: false,
    forceAllowFrom: false,
  };

  it("propagates prompter errors without partial config mutation", async () => {
    const error = new Error("User cancelled");
    const prompter = createMockPrompter({
      select: vi.fn().mockRejectedValueOnce(error),
    });

    const cfg = { channels: {} } as OpenClawConfig;
    await expect(
      xmtpOnboardingAdapter.configure({
        ...baseCtx,
        cfg,
        prompter,
      }),
    ).rejects.toThrow("User cancelled");

    // Original config should be unchanged
    expect(cfg.channels).toEqual({});
  });

  it("validate functions reject invalid key formats", async () => {
    let capturedValidate: ((value: string) => string | undefined) | undefined;
    const prompter = createMockPrompter({
      select: vi.fn().mockResolvedValueOnce("paste"),
      text: vi
        .fn()
        .mockImplementationOnce((params: { validate?: (value: string) => string | undefined }) => {
          capturedValidate = params.validate;
          return Promise.resolve(TEST_WALLET_KEY);
        }),
    });

    const cfg = { channels: {} } as OpenClawConfig;
    // We don't need to await the full configure — just capture the validate fn
    xmtpOnboardingAdapter.configure({ ...baseCtx, cfg, prompter }).catch(() => {});

    // Wait for the mock to be called
    await vi.waitFor(() => expect(capturedValidate).toBeDefined());

    // Test validation
    expect(capturedValidate!("")).toBe("Required");
    expect(capturedValidate!("not-hex")).toBe(
      "Must be a 0x-prefixed 64-character hex string (32 bytes)",
    );
    expect(capturedValidate!("0x123")).toBe(
      "Must be a 0x-prefixed 64-character hex string (32 bytes)",
    );
    expect(capturedValidate!(TEST_WALLET_KEY)).toBeUndefined();
  });
});
