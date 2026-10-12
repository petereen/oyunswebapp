import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OyunsPlusMembershipCard } from "./OyunsPlusMembershipCard";
import { LangProvider } from "../i18n/useLang";

function renderCard(onDetailsOpen = vi.fn()) {
  localStorage.setItem("oyuns_lang", "mn");
  render(<LangProvider><OyunsPlusMembershipCard cardHolder="Тэмүүлэн Очирбат" points={10000} onDetailsOpen={onDetailsOpen} /></LangProvider>);
  return document.querySelector('[data-slot="oyuns-plus-membership-card"]')!;
}

describe("OyunsPlusMembershipCard", () => {
  it("flips via the card surface and the face buttons", () => {
    const card = renderCard();
    expect(card).toHaveAttribute("data-flipped", "false");
    fireEvent.click(card);
    expect(card).toHaveAttribute("data-flipped", "true");
    fireEvent.click(screen.getByRole("button", { name: "Нүүр тал руу буцах", hidden: true }));
    expect(card).toHaveAttribute("data-flipped", "false");
    fireEvent.click(screen.getByRole("button", { name: "Картыг эргүүлэх" }));
    expect(card).toHaveAttribute("data-flipped", "true");
  });

  it("shows total points and opens details from the back without flipping", () => {
    const onDetailsOpen = vi.fn();
    const card = renderCard(onDetailsOpen);
    fireEvent.click(card);
    expect(screen.getByText("Нийт оноо")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Дэлгэрэнгүй" }));
    expect(onDetailsOpen).toHaveBeenCalledOnce();
    expect(card).toHaveAttribute("data-flipped", "true");
  });

  it("shows the card holder label on the front", () => {
    renderCard();
    expect(screen.getByText("Карт эзэмшигч")).toBeInTheDocument();
  });
});
