"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import type { StorageCommand } from "./backend/contracts";
import type { Database, Item, List, ListItem } from "./types";
import { now, uid } from "./types";

const LEGACY_STORAGE_KEY = "listo.database.v1";

const emptyDatabase = (): Database => ({ lists: [], items: [], listItems: [], jobs: [] });

export function useListoStore(username: string) {
  const generation = useRef(0);
  const [hasLegacy, setHasLegacy] = useState(false);
  const [db, setDb] = useState<Database>(emptyDatabase);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const epoch = generation.current;
    const response = await fetch("/api/state", { cache: "no-store" });
    if (epoch !== generation.current) return;
    if (response.status === 401) { setDb(emptyDatabase()); window.location.replace("/login"); return; }
    if (response.headers.get("x-listo-user") !== username) { generation.current++; setDb(emptyDatabase()); window.location.reload(); return; }
    if (!response.ok) throw new Error("Could not load the SQLite database");
    const database = await response.json() as Database;
    if (epoch === generation.current) setDb(normalizeDatabase(database));
  }, [username]);

  useEffect(() => {
    const lifecycle = generation;
    void (async () => {
      try {
        await refresh();
        setHasLegacy(username.toLowerCase() === "jdelman" && Boolean(localStorage.getItem(LEGACY_STORAGE_KEY)));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not open Listo");
      } finally { setReady(true); }
    })();
    const invalidate = () => { lifecycle.current++; setDb(emptyDatabase()); };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener("pageshow", restore);
    window.addEventListener("pagehide", invalidate);
    return () => { lifecycle.current++; window.removeEventListener("pagehide", invalidate); window.removeEventListener("pageshow", restore); };
  }, [refresh, username]);

  useEffect(() => {
    if (!ready || !db.jobs.some((job) => job.status === "queued" || job.status === "running")) return;
    const interval = window.setInterval(() => void refresh().catch(() => undefined), 1_500);
    return () => window.clearInterval(interval);
  }, [db.jobs, ready, refresh]);

  function persist(command: StorageCommand) {
    void sendCommand(command, username).then(() => refresh()).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "A database operation failed");
      void refresh();
    });
  }

  function createList(input: Pick<List, "title" | "description" | "tags">) {
    const timestamp = now();
    const list: List = { id: uid(), ...input, defaultView: "list", createdAt: timestamp, updatedAt: timestamp };
    setDb((current) => ({ ...current, lists: [...current.lists, list] }));
    persist({ type: "createList", list });
    return list.id;
  }

  function updateList(id: string, patch: Partial<List>) {
    const updatedAt = now();
    setDb((current) => ({ ...current, lists: current.lists.map((list) => list.id === id ? { ...list, ...patch, id, updatedAt } : list) }));
    persist({ type: "updateList", id, patch: { ...patch, updatedAt } });
  }

  function deleteList(id: string) {
    if (id === "inbox") return;
    setDb((current) => ({ ...current, lists: current.lists.filter((list) => list.id !== id), listItems: current.listItems.filter((entry) => entry.listId !== id) }));
    persist({ type: "deleteList", id });
  }

  function createItem(item: Omit<Item, "id" | "createdAt" | "updatedAt" | "revision">, listIds: string[] = ["inbox"]) {
    const id = uid();
    const timestamp = now();
    const full: Item = { ...item, id, revision: 1, createdAt: timestamp, updatedAt: timestamp };
    setDb((current) => {
      const additions: ListItem[] = listIds.map((listId) => ({ id: uid(), listId, itemId: id, position: current.listItems.filter((entry) => entry.listId === listId).length }));
      return { ...current, items: [...current.items, full], listItems: [...current.listItems, ...additions] };
    });
    persist({ type: "createItem", item: full, listIds });
    return id;
  }

  function updateItem(id: string, patch: Partial<Item>) {
    setDb((current) => ({ ...current, items: current.items.map((item) => item.id === id ? { ...item, ...patch, id, revision: item.revision + 1, updatedAt: now() } : item) }));
    persist({ type: "updateItem", id, patch });
  }

  function deleteItem(id: string) {
    setDb((current) => ({ ...current, items: current.items.filter((item) => item.id !== id), listItems: current.listItems.filter((entry) => entry.itemId !== id), jobs: current.jobs.filter((job) => job.itemId !== id) }));
    persist({ type: "deleteItem", id });
  }

  function setItemLists(itemId: string, listIds: string[]) {
    setDb((current) => {
      const kept = current.listItems.filter((entry) => entry.itemId !== itemId);
      const added = listIds.map((listId) => ({ id: uid(), listId, itemId, position: kept.filter((entry) => entry.listId === listId).length }));
      return { ...current, listItems: [...kept, ...added] };
    });
    persist({ type: "setItemLists", itemId, listIds });
  }

  function removeFromList(listId: string, itemId: string) {
    setDb((current) => ({ ...current, listItems: normalizePlacements(current.listItems.filter((entry) => !(entry.listId === listId && entry.itemId === itemId)), listId) }));
    persist({ type: "removeFromList", listId, itemId });
  }

  function moveItem(listId: string, itemId: string, direction: -1 | 1) {
    setDb((current) => {
      const ordered = current.listItems.filter((entry) => entry.listId === listId).sort((a, b) => a.position - b.position);
      const from = ordered.findIndex((entry) => entry.itemId === itemId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= ordered.length) return current;
      [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
      return { ...current, listItems: [...current.listItems.filter((entry) => entry.listId !== listId), ...ordered.map((entry, position) => ({ ...entry, position }))] };
    });
    persist({ type: "moveItem", listId, itemId, direction });
  }

  function reorderItem(listId: string, draggedId: string, targetId: string) {
    setDb((current) => {
      const ordered = current.listItems.filter((entry) => entry.listId === listId).sort((a, b) => a.position - b.position);
      const from = ordered.findIndex((entry) => entry.itemId === draggedId);
      const to = ordered.findIndex((entry) => entry.itemId === targetId);
      if (from < 0 || to < 0 || from === to) return current;
      const [moved] = ordered.splice(from, 1); ordered.splice(to, 0, moved);
      return { ...current, listItems: [...current.listItems.filter((entry) => entry.listId !== listId), ...ordered.map((entry, position) => ({ ...entry, position }))] };
    });
    persist({ type: "reorderItem", listId, draggedId, targetId });
  }

  async function importLegacy() {
    if (username.toLowerCase() !== "jdelman") return;
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) return;
      await sendCommand({ type: "importDatabase", database: normalizeDatabase(JSON.parse(raw)) }, username);
      await refresh();
      localStorage.removeItem(LEGACY_STORAGE_KEY); setHasLegacy(false);
    } catch { setError("Could not import older lists. Your browser copy is still saved."); }
  }

  return { db, ready, error, hasLegacy, importLegacy, createList, updateList, deleteList, createItem, updateItem, deleteItem, setItemLists, removeFromList, moveItem, reorderItem };
}

async function sendCommand(command: StorageCommand, username: string) {
  const response = await fetch("/api/commands", { method: "POST", headers: { "content-type": "application/json", "x-listo-user": username }, body: JSON.stringify(command) });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error || "Database operation failed");
  return result;
}

function normalizeDatabase(database: Partial<Database>): Database {
  return {
    lists: database.lists ?? [],
    items: (database.items ?? []).map((item) => ({ ...item, revision: item.revision || 1 })),
    listItems: database.listItems ?? [],
    jobs: database.jobs ?? [],
  };
}

function normalizePlacements(entries: ListItem[], listId: string) {
  const ordered = entries.filter((entry) => entry.listId === listId).sort((a, b) => a.position - b.position).map((entry, position) => ({ ...entry, position }));
  return [...entries.filter((entry) => entry.listId !== listId), ...ordered];
}
