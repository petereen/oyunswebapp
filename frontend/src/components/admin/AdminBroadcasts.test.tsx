import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminBroadcasts } from "./AdminBroadcasts";
import { sendAdminBroadcast } from "../../api";

vi.mock("../../api", () => ({
  sendAdminBroadcast: vi.fn().mockResolvedValue({ id: "broadcast-1", status: "sent", total_recipients: 1, delivered_count: 1, sent_at: "2026-09-22T09:17:00Z" }),
}));

vi.mock("./AdminPanelPrimitives", () => ({
  AdminRefreshButton: ({ onClick }: { onClick: () => void }) => <button type="button" onClick={onClick}>Refresh</button>,
  AdminSectionHeader: ({ title, action }: { title: string; action: React.ReactNode }) => <div><h2>{title}</h2>{action}</div>,
}));

describe("AdminBroadcasts", () => {
  it("requires a second confirmation step before sending a manual broadcast", async () => {
    render(<AdminBroadcasts />);

    fireEvent.click(screen.getByRole("button", { name: "Prepare broadcast" }));
    expect(screen.getByRole("dialog", { name: "Broadcast preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText(/Confirm & Send дарсны дараа/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm & Send" }));

    await waitFor(() => expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByText(/Broadcast илгээгдлээ/)).toBeInTheDocument();
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

  it("accepts custom Telegram IDs separated by spaces, commas, or new lines", () => {
    render(<AdminBroadcasts />);

    fireEvent.change(screen.getByLabelText("Audience"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("Custom Telegram IDs"), { target: { value: "123, 456\n789" } });
    fireEvent.click(screen.getByRole("button", { name: "Prepare broadcast" }));

    expect(screen.getByText("Custom audience · 3 Telegram IDs")).toBeInTheDocument();
  });

  it("inserts formatting tokens at the textarea selection and renders markdown in the preview", () => {
    render(<AdminBroadcasts />);

    const messageInput = screen.getByLabelText("Message body") as HTMLTextAreaElement;
    fireEvent.change(messageInput, { target: { value: "Сайн байна уу" } });
    messageInput.setSelectionRange(5, 5);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));

    expect(messageInput).toHaveValue("Сайн **текст**байна уу");

    fireEvent.change(messageInput, { target: { value: "**текст** [сайт](https://example.com)" } });
    expect(screen.getByText("Preview")).toBeInTheDocument();
    expect(screen.getByText("текст").tagName).toBe("STRONG");
    expect(screen.getByRole("link", { name: "сайт" })).toHaveAttribute("href", "https://example.com");
    expect(screen.queryByText("Live preview")).not.toBeInTheDocument();
    expect(screen.queryByText("1:1 message view")).not.toBeInTheDocument();
    expect(screen.queryByText("live", { exact: true })).not.toBeInTheDocument();
  });

  it("previews and sends an attached photo", async () => {
    render(<AdminBroadcasts />);

    const photo = new File(["image"], "notice.jpg", { type: "image/jpeg" });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [photo] } });
    expect(screen.getByAltText("Broadcast attachment preview")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Prepare broadcast" }));
    expect(screen.getByText("1 image")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm & Send" }));

    await waitFor(() => expect(sendAdminBroadcast).toHaveBeenCalledWith(expect.objectContaining({ media: photo })));
  });
});
