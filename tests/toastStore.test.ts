import { describe, expect, it, beforeEach } from "vitest";
import { useToastStore, toast } from "../src/stores/toastStore";

describe("toastStore", () => {
  beforeEach(() => {
    // Reset the store between tests
    useToastStore.setState({ toasts: [] });
  });

  describe("addToast", () => {
    it("adds a toast to the list", () => {
      const id = useToastStore.getState().addToast({
        variant: "success",
        message: "Saved!",
      });

      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].id).toBe(id);
      expect(toasts[0].variant).toBe("success");
      expect(toasts[0].message).toBe("Saved!");
    });

    it("uses default duration for each variant", () => {
      useToastStore.getState().addToast({ variant: "success", message: "s" });
      expect(useToastStore.getState().toasts[0].duration).toBe(4000);

      useToastStore.setState({ toasts: [] });
      useToastStore.getState().addToast({ variant: "error", message: "e" });
      expect(useToastStore.getState().toasts[0].duration).toBe(8000);

      useToastStore.setState({ toasts: [] });
      useToastStore.getState().addToast({ variant: "warning", message: "w" });
      expect(useToastStore.getState().toasts[0].duration).toBe(6000);

      useToastStore.setState({ toasts: [] });
      useToastStore.getState().addToast({ variant: "info", message: "i" });
      expect(useToastStore.getState().toasts[0].duration).toBe(4000);
    });

    it("allows custom duration", () => {
      useToastStore.getState().addToast({
        variant: "info",
        message: "Custom",
        duration: 10000,
      });

      expect(useToastStore.getState().toasts[0].duration).toBe(10000);
    });

    it("limits to MAX_TOASTS (5), removing oldest", () => {
      for (let i = 0; i < 7; i++) {
        useToastStore.getState().addToast({
          variant: "info",
          message: `Toast ${i}`,
        });
      }

      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(5);
      expect(toasts[0].message).toBe("Toast 2");
      expect(toasts[4].message).toBe("Toast 6");
    });

    it("returns unique ids for each toast", () => {
      const id1 = useToastStore.getState().addToast({ variant: "info", message: "a" });
      const id2 = useToastStore.getState().addToast({ variant: "info", message: "b" });
      expect(id1).not.toBe(id2);
    });
  });

  describe("dismissToast", () => {
    it("removes a specific toast by id", () => {
      const id1 = useToastStore.getState().addToast({ variant: "info", message: "first" });
      useToastStore.getState().addToast({ variant: "info", message: "second" });

      useToastStore.getState().dismissToast(id1);
      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0].message).toBe("second");
    });

    it("does nothing when id does not exist", () => {
      useToastStore.getState().addToast({ variant: "info", message: "a" });
      useToastStore.getState().dismissToast("nonexistent");
      expect(useToastStore.getState().toasts).toHaveLength(1);
    });
  });

  describe("toast convenience helpers", () => {
    it("toast.success adds a success toast", () => {
      toast.success("OK");
      const toasts = useToastStore.getState().toasts;
      expect(toasts[toasts.length - 1].variant).toBe("success");
      expect(toasts[toasts.length - 1].message).toBe("OK");
    });

    it("toast.error adds an error toast", () => {
      toast.error("Fail");
      const toasts = useToastStore.getState().toasts;
      expect(toasts[toasts.length - 1].variant).toBe("error");
    });

    it("toast.warning adds a warning toast", () => {
      toast.warning("Warn");
      const toasts = useToastStore.getState().toasts;
      expect(toasts[toasts.length - 1].variant).toBe("warning");
    });

    it("toast.info adds an info toast", () => {
      toast.info("Note");
      const toasts = useToastStore.getState().toasts;
      expect(toasts[toasts.length - 1].variant).toBe("info");
    });

    it("toast helpers accept custom duration", () => {
      toast.success("OK", 1234);
      const toasts = useToastStore.getState().toasts;
      expect(toasts[toasts.length - 1].duration).toBe(1234);
    });
  });
});
