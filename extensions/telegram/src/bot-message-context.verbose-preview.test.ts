// Telegram tests cover verbose preview logging for inbound message context.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { logVerboseMock } = vi.hoisted(() => ({
  logVerboseMock: vi.fn<(message: string) => void>(),
}));

vi.mock("openclaw/plugin-sdk/runtime-env", async () => {
  const actual = await vi.importActual<typeof import("openclaw/plugin-sdk/runtime-env")>(
    "openclaw/plugin-sdk/runtime-env",
  );
  return {
    ...actual,
    logVerbose: (message: string) => logVerboseMock(message),
    shouldLogVerbose: () => true,
  };
});

const { buildTelegramMessageContextForTest } =
  await import("./bot-message-context.test-harness.js");

function findVerboseLog(prefix: string): string {
  const log = logVerboseMock.mock.calls
    .map(([message]) => message)
    .find((message) => message.startsWith(prefix));
  if (!log) {
    throw new Error(`Expected verbose log starting with ${prefix}`);
  }
  return log;
}

function previewFromInboundLog(log: string): string {
  const match = / preview="([\s\S]*)"$/.exec(log);
  if (!match) {
    throw new Error(`Expected inbound preview in log: ${log}`);
  }
  return match[1];
}

function containsLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      const previous = value.charCodeAt(index - 1);
      if (!(previous >= 0xd800 && previous <= 0xdbff)) {
        return true;
      }
    }
  }
  return false;
}

async function buildContextForText(text: string, replyText?: string) {
  await buildTelegramMessageContextForTest({
    message: {
      chat: { id: 42, type: "private", first_name: "Pat" },
      text,
      ...(replyText
        ? {
            reply_to_message: {
              message_id: 9,
              date: 1_700_000_000,
              chat: { id: 42, type: "private", first_name: "Pat" },
              from: { id: 42, first_name: "Pat" },
              text: replyText,
            },
          }
        : {}),
    },
  });
}

describe("Telegram verbose previews", () => {
  beforeEach(() => {
    logVerboseMock.mockClear();
  });

  it("does not split surrogate pairs in inbound message previews", async () => {
    await buildContextForText("MARKER");
    const prefixLength = previewFromInboundLog(findVerboseLog("telegram inbound:")).indexOf(
      "MARKER",
    );
    expect(prefixLength).toBeGreaterThanOrEqual(0);
    expect(prefixLength).toBeLessThan(199);

    logVerboseMock.mockClear();
    await buildContextForText(`${"A".repeat(199 - prefixLength)}🧪 tail`);

    const log = findVerboseLog("telegram inbound:");
    expect(containsLoneSurrogate(log)).toBe(false);
  });

  it("does not split surrogate pairs in reply-context previews", async () => {
    await buildContextForText("reply check", `${"B".repeat(119)}🧪 parent`);

    const log = findVerboseLog("telegram reply-context:");
    expect(containsLoneSurrogate(log)).toBe(false);
  });
});
