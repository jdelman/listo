"use client";

import { useEffect } from "react";

type Page = { name: "lists" | "search" | "quick" } | { name: "list" | "item"; id: string };
type NamedEntry = { id: string; title: string };

export function usePageTitle(screen: Page, lists: NamedEntry[], items: NamedEntry[], ready: boolean) {
  let name: string;
  switch (screen.name) {
    case "lists": name = "Home"; break;
    case "search": name = "Search"; break;
    case "quick": name = "Quick Add"; break;
    case "list": name = lists.find((list) => list.id === screen.id)?.title || (ready ? "List not found" : "Loading list…"); break;
    case "item": name = items.find((item) => item.id === screen.id)?.title || (ready ? "Item not found" : "Loading item…"); break;
  }

  useEffect(() => {
    document.title = `${name} — Listo`;
  }, [name]);
}
