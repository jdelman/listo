"use client";

import { useEffect, useState } from "react";
import type { Database, Item, List, ListItem } from "./types";
import { now, uid } from "./types";

const STORAGE_KEY = "listo.database.v1";

function starterDatabase(): Database {
  const timestamp = now();
  const inbox: List = {
    id: "inbox", title: "Inbox", description: "Everything can land here first.", tags: [], defaultView: "list", createdAt: timestamp, updatedAt: timestamp,
  };
  return { lists: [inbox], items: [], listItems: [] };
}

export function useListoStore() {
  const [db, setDb] = useState<Database>(starterDatabase);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setDb(JSON.parse(saved));
    } finally { setReady(true); }
  }, []);

  useEffect(() => { if (ready) localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); }, [db, ready]);

  const update = (recipe: (current: Database) => Database) => setDb((current) => recipe(current));

  function createList(input: Pick<List, "title" | "description" | "tags">) {
    const timestamp = now();
    const list: List = { id: uid(), ...input, defaultView: "list", createdAt: timestamp, updatedAt: timestamp };
    update((current) => ({ ...current, lists: [...current.lists, list] }));
    return list.id;
  }

  function updateList(id: string, patch: Partial<List>) {
    update((current) => ({ ...current, lists: current.lists.map((list) => list.id === id ? { ...list, ...patch, id, updatedAt: now() } : list) }));
  }

  function deleteList(id: string) {
    if (id === "inbox") return;
    update((current) => ({ ...current, lists: current.lists.filter((list) => list.id !== id), listItems: current.listItems.filter((entry) => entry.listId !== id) }));
  }

  function createItem(item: Omit<Item, "id" | "createdAt" | "updatedAt">, listIds: string[] = ["inbox"]) {
    const id = uid();
    const timestamp = now();
    const full: Item = { ...item, id, createdAt: timestamp, updatedAt: timestamp };
    update((current) => {
      const additions: ListItem[] = listIds.map((listId) => ({ id: uid(), listId, itemId: id, position: current.listItems.filter((entry) => entry.listId === listId).length }));
      return { ...current, items: [...current.items, full], listItems: [...current.listItems, ...additions] };
    });
    return id;
  }

  function updateItem(id: string, patch: Partial<Item>) {
    update((current) => ({ ...current, items: current.items.map((item) => item.id === id ? { ...item, ...patch, id, updatedAt: now() } : item) }));
  }

  function deleteItem(id: string) {
    update((current) => ({ ...current, items: current.items.filter((item) => item.id !== id), listItems: current.listItems.filter((entry) => entry.itemId !== id) }));
  }

  function setItemLists(itemId: string, listIds: string[]) {
    update((current) => {
      const kept = current.listItems.filter((entry) => entry.itemId !== itemId);
      const added = listIds.map((listId) => ({ id: uid(), listId, itemId, position: kept.filter((entry) => entry.listId === listId).length }));
      return { ...current, listItems: [...kept, ...added] };
    });
  }

  function removeFromList(listId: string, itemId: string) {
    update((current) => ({ ...current, listItems: normalize(current.listItems.filter((entry) => !(entry.listId === listId && entry.itemId === itemId)), listId) }));
  }

  function moveItem(listId: string, itemId: string, direction: -1 | 1) {
    update((current) => {
      const ordered = current.listItems.filter((entry) => entry.listId === listId).sort((a, b) => a.position - b.position);
      const from = ordered.findIndex((entry) => entry.itemId === itemId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= ordered.length) return current;
      [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
      const other = current.listItems.filter((entry) => entry.listId !== listId);
      return { ...current, listItems: [...other, ...ordered.map((entry, position) => ({ ...entry, position }))] };
    });
  }

  function reorderItem(listId: string, draggedId: string, targetId: string) {
    update((current) => {
      const ordered = current.listItems.filter((entry) => entry.listId === listId).sort((a, b) => a.position - b.position);
      const from = ordered.findIndex((entry) => entry.itemId === draggedId);
      const to = ordered.findIndex((entry) => entry.itemId === targetId);
      if (from < 0 || to < 0 || from === to) return current;
      const [moved] = ordered.splice(from, 1); ordered.splice(to, 0, moved);
      return { ...current, listItems: [...current.listItems.filter((entry) => entry.listId !== listId), ...ordered.map((entry, position) => ({ ...entry, position }))] };
    });
  }

  return { db, ready, createList, updateList, deleteList, createItem, updateItem, deleteItem, setItemLists, removeFromList, moveItem, reorderItem };
}

function normalize(entries: ListItem[], listId: string) {
  const ordered = entries.filter((entry) => entry.listId === listId).sort((a, b) => a.position - b.position).map((entry, position) => ({ ...entry, position }));
  return [...entries.filter((entry) => entry.listId !== listId), ...ordered];
}
