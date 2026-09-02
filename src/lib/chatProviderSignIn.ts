import { chatProviderSignInCommand } from "./chatProviders";
import { engineKind } from "./engineKind";
import { t } from "../i18n";
import { toast } from "../stores/toastStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useUiStore } from "../stores/uiStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import type { ChatProviderInstance } from "../types";

/** The provider row to sign in for an engine id, falling back to the built-in instance. */
export function chatProviderForEngine(
  engineId: string,
  providers: ChatProviderInstance[],
): ChatProviderInstance {
  const match = providers.find((provider) => provider.id === engineId);
  if (match) return match;
  const kind = engineKind(engineId);
  return {
    id: engineId,
    kind,
    displayName: engineId,
    binaryPath: null,
    homePath: null,
    launchArgs: null,
    env: {},
    enabled: true,
    builtIn: engineId === kind,
  };
}

/** Opens a terminal in the active workspace running the provider's sign-in command. */
export async function signInChatProviderInTerminal(
  provider: ChatProviderInstance,
  workspaceId?: string | null,
): Promise<boolean> {
  const targetWorkspaceId = workspaceId ?? useWorkspaceStore.getState().activeWorkspaceId ?? null;
  if (!targetWorkspaceId) {
    toast.error(t("app:settingsPage.chat.signInNoWorkspace"));
    return false;
  }
  const started = await useTerminalStore
    .getState()
    .runCommandInTerminal(targetWorkspaceId, chatProviderSignInCommand(provider));
  if (!started) {
    toast.error(t("app:settingsPage.chat.signInFailed"));
    return false;
  }
  useUiStore.getState().setActiveView("chat");
  return true;
}
