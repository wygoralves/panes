import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinuxWindowFrame } from "./LinuxWindowFrame";

const mockCloseCurrentWindow = vi.hoisted(() => vi.fn());
const mockMinimizeCurrentWindow = vi.hoisted(() => vi.fn());
const mockToggleCurrentWindowMaximize = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../lib/windowActions", () => ({
  closeCurrentWindow: mockCloseCurrentWindow,
  minimizeCurrentWindow: mockMinimizeCurrentWindow,
  requestWindowClose: vi.fn(),
  toggleCurrentWindowMaximize: mockToggleCurrentWindowMaximize,
  toggleWindowFullscreen: vi.fn(),
}));

describe("LinuxWindowFrame", () => {
  function findElement(
    node: ReactNode,
    predicate: (props: Record<string, unknown>) => boolean,
  ): Record<string, unknown> | null {
    if (Array.isArray(node)) {
      for (const child of node) {
        const match = findElement(child, predicate);
        if (match) {
          return match;
        }
      }
      return null;
    }

    if (!isValidElement(node)) {
      return null;
    }

    const props = node.props as Record<string, unknown>;
    if (predicate(props)) {
      return props;
    }

    return findElement(props.children as ReactNode, predicate);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockCloseCurrentWindow.mockResolvedValue(undefined);
    mockMinimizeCurrentWindow.mockResolvedValue(undefined);
    mockToggleCurrentWindowMaximize.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("uses the native close action for the close control", async () => {
    const tree = LinuxWindowFrame({ frameState: { isFullscreen: false, isMaximized: false } });
    const closeButtonProps = findElement(
      tree,
      (props) => props["aria-label"] === "windowControls.close",
    );

    expect(closeButtonProps).not.toBeNull();
    await (closeButtonProps?.onClick as (() => Promise<void> | void) | undefined)?.();

    expect(mockCloseCurrentWindow).toHaveBeenCalledTimes(1);
  });

  it("renders the restore label while maximized", () => {
    const tree = LinuxWindowFrame({ frameState: { isFullscreen: false, isMaximized: true } });
    const maximizeButtonProps = findElement(
      tree,
      (props) => props["aria-label"] === "windowControls.restore",
    );

    expect(maximizeButtonProps).not.toBeNull();
  });
});
