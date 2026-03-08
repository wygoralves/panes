import { describe, expect, it } from "vitest";
import commonEn from "./resources/en/common.json";
import appEn from "./resources/en/app.json";
import chatEn from "./resources/en/chat.json";
import workspaceEn from "./resources/en/workspace.json";
import setupEn from "./resources/en/setup.json";
import gitEn from "./resources/en/git.json";
import nativeEn from "./resources/en/native.json";
import commonPtBr from "./resources/pt-BR/common.json";
import appPtBr from "./resources/pt-BR/app.json";
import chatPtBr from "./resources/pt-BR/chat.json";
import workspacePtBr from "./resources/pt-BR/workspace.json";
import setupPtBr from "./resources/pt-BR/setup.json";
import gitPtBr from "./resources/pt-BR/git.json";
import nativePtBr from "./resources/pt-BR/native.json";

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

function readNestedString(
  value: Record<string, unknown>,
  path: string,
): string | undefined {
  const segments = path.split(".");
  let current: unknown = value;

  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return typeof current === "string" ? current : undefined;
}

describe("i18n resources", () => {
  it("keeps pt-BR keys aligned with en", () => {
    const enKeys = [
      ...flattenKeys(commonEn, "common"),
      ...flattenKeys(appEn, "app"),
      ...flattenKeys(chatEn, "chat"),
      ...flattenKeys(workspaceEn, "workspace"),
      ...flattenKeys(setupEn, "setup"),
      ...flattenKeys(gitEn, "git"),
      ...flattenKeys(nativeEn, "native"),
    ].sort();
    const ptBrKeys = [
      ...flattenKeys(commonPtBr, "common"),
      ...flattenKeys(appPtBr, "app"),
      ...flattenKeys(chatPtBr, "chat"),
      ...flattenKeys(workspacePtBr, "workspace"),
      ...flattenKeys(setupPtBr, "setup"),
      ...flattenKeys(gitPtBr, "git"),
      ...flattenKeys(nativePtBr, "native"),
    ].sort();

    expect(ptBrKeys).toEqual(enKeys);
  });

  it("defines fallback thread titles used by the chat panel", () => {
    expect(readNestedString(chatEn, "panel.workspaceChatTitle")).toBeTruthy();
    expect(readNestedString(chatEn, "panel.repoChatTitle")).toBeTruthy();
    expect(readNestedString(chatPtBr, "panel.workspaceChatTitle")).toBeTruthy();
    expect(readNestedString(chatPtBr, "panel.repoChatTitle")).toBeTruthy();
  });
});
