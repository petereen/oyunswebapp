import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminUserSearch } from "./AdminUserSearch";
import { fetchUserMessageTemplates, searchUsers, sendUserMessage } from "../api";

vi.mock("../api", () => ({
  searchUsers: vi.fn(),
  fetchUserMessageTemplates: vi.fn(),
  sendUserMessage: vi.fn(),
}));

const PREVIEW =
  "🙏 Уучлаарай\n\nАдмин тантай холбогдож чадаагүй тул та дараах хаягаар бидэнтэй холбогдоно уу.\n\n💬 OYUNS Finance\n👉 @oyuns_finance";

const user = {
  id: 111,
  first_name: "Бат",
  last_name: "Эрдэнэ",
  username: "bat_e",
  phone_mnt: "99112233",
  phone_intl: "+97699112233",
  verified: true,
  total_transactions: 3,
};

describe("AdminUserSearch", () => {
  beforeEach(() => {
    vi.mocked(searchUsers).mockResolvedValue({ users: [user], total: 1 });
    vi.mocked(fetchUserMessageTemplates).mockResolvedValue([
      { id: "contact_support", label: "Админ холбогдож чадаагүй", preview: PREVIEW, button_text: "💬 OYUNS Finance руу бичих" },
    ]);
    vi.mocked(sendUserMessage).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("debounces typing into a single search request", async () => {
    render(<AdminUserSearch />);
    await waitFor(() => expect(searchUsers).toHaveBeenCalledWith("", expect.anything()));

    vi.useFakeTimers();
    const input = screen.getByLabelText("Хэрэглэгч хайх");
    fireEvent.change(input, { target: { value: "ба" } });
    fireEvent.change(input, { target: { value: "бат эрдэнэ" } });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    const queries = vi.mocked(searchUsers).mock.calls.map((call) => call[0]);
    expect(queries).toEqual(["", "бат эрдэнэ"]);
  });

  it("shows a de-duplicated contact list and an error message when search fails", async () => {
    render(<AdminUserSearch />);
    expect(await screen.findByText("Эрдэнэ Бат")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "@bat_e" })).toHaveAttribute("href", "https://t.me/bat_e");
    expect(screen.getByRole("button", { name: "99112233" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+97699112233" })).toBeInTheDocument();

    vi.mocked(searchUsers).mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole("button", { name: "Хайх" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Хайлт амжилтгүй боллоо");
  });

  it("cancel closes the message dialog without sending", async () => {
    render(<AdminUserSearch />);
    fireEvent.click(await screen.findByRole("button", { name: /Мессеж/ }));

    const dialog = await screen.findByRole("dialog", { name: "Мессеж илгээх" });
    expect(dialog).toHaveTextContent("Эрдэнэ Бат");
    expect(screen.getByTestId("message-preview")).toHaveTextContent("@oyuns_finance");

    fireEvent.click(screen.getByRole("button", { name: "Цуцлах" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("send posts the template for the selected user and reports success", async () => {
    render(<AdminUserSearch />);
    fireEvent.click(await screen.findByRole("button", { name: /Мессеж/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Илгээх" }));

    await waitFor(() => expect(sendUserMessage).toHaveBeenCalledWith(111, "contact_support"));
    expect(await screen.findByRole("status")).toHaveTextContent("амжилттай илгээгдлээ");
  });

  it("keeps the dialog open and shows the server error when delivery fails", async () => {
    vi.mocked(sendUserMessage).mockRejectedValueOnce(new Error("Хэрэглэгч ботыг блоклосон байна"));
    render(<AdminUserSearch />);
    fireEvent.click(await screen.findByRole("button", { name: /Мессеж/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Илгээх" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Хэрэглэгч ботыг блоклосон байна");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Илгээх" })).toBeEnabled();
  });
});
