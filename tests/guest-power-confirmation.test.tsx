import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GuestPowerConfirmation } from "@/app/lib/guest-power-confirmation";

vi.mock("@/app/lib/use-translation", () => ({ useTranslation: () => ({ language: "en", t: (key: string) => key }) }));
afterEach(cleanup);

describe("guest power confirmation", () => {
  it("requires exact guest IDs before hard stop can run", () => {
    const confirm = vi.fn();
    render(<GuestPowerConfirmation action="stop" guests={[{ vmid: 100, name: "database" }, { vmid: 200 }]} busy={false} onDismiss={vi.fn()} onConfirm={confirm} />);
    const stop = screen.getByRole("button", { name: "vms.stop" });
    expect(stop).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "100" } });
    expect(stop).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "100, 200" } });
    expect(stop).toBeEnabled();
    fireEvent.click(stop);
    expect(confirm).toHaveBeenCalledOnce();
  });
  it("makes graceful shutdown available without hard stop wording", () => {
    const confirm = vi.fn();
    render(<GuestPowerConfirmation action="shutdown" guests={[{ vmid: 100, name: "database" }]} busy={false} onDismiss={vi.fn()} onConfirm={confirm} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "nodeDetail.shutdown" }));
    expect(confirm).toHaveBeenCalledOnce();
  });
});
