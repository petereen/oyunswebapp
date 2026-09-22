import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminBroadcasts } from "./AdminBroadcasts";

vi.mock("./AdminPanelPrimitives", () => ({
  AdminRefreshButton: ({ onClick }: { onClick: () => void }) => <button type="button" onClick={onClick}>Refresh</button>,
  AdminSectionHeader: ({ title, action }: { title: string; action: React.ReactNode }) => <div><h2>{title}</h2>{action}</div>,
}));

describe("AdminBroadcasts", () => {
  it("requires a second confirmation step before queueing a manual broadcast", () => {
    render(<AdminBroadcasts />);

    fireEvent.click(screen.getByRole("button", { name: "Prepare broadcast" }));
    expect(screen.getByRole("dialog", { name: "Broadcast preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText(/Confirm & Send дарсны дараа/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm & Send" }));

    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Broadcast дараалалд нэмэгдлээ.")).toBeInTheDocument();
  });

  it("keeps Current Rate Broadcast protected and creates editable rules", () => {
    render(<AdminBroadcasts />);
    fireEvent.click(screen.getByRole("tab", { name: "Automated" }));

    expect(screen.getByText("Current Rate Broadcast")).toBeInTheDocument();
    expect(screen.getByText("Protected")).toBeInTheDocument();
    const protectedRow = screen.getByText("Current Rate Broadcast").closest("tr");
    expect(protectedRow).not.toBeNull();
    expect(within(protectedRow as HTMLElement).queryByRole("button", { name: "Дүрэм засах" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create rule" }));
    fireEvent.change(screen.getByLabelText("Rule name"), { target: { value: "Weekend reminder" } });
    fireEvent.change(screen.getByLabelText("Trigger condition"), { target: { value: "Өдөр бүрийн 18:00" } });
    fireEvent.change(screen.getByLabelText("Frequency / interval"), { target: { value: "Өдөр бүр" } });
    fireEvent.click(screen.getByRole("button", { name: "Save rule" }));

    expect(screen.getByText("Weekend reminder")).toBeInTheDocument();
  });
});
