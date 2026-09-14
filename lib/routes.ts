export type QuickAddKind = "quick" | "clothing" | "movie";

export type Screen =
  | { name: "lists"; tag?: string; creating?: boolean }
  | { name: "search"; query?: string; type?: string; listId?: string; tag?: string; offline?: boolean }
  | { name: "quick"; destinationListId?: string; kind?: QuickAddKind }
  | { name: "list"; id: string; query?: string; editing?: boolean }
  | { name: "item"; id: string; returnTo?: string; editing?: boolean };

function segment(value: string) {
  return encodeURIComponent(value);
}

function decoded(value: string | undefined) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function optional(params: URLSearchParams, name: string) {
  return params.get(name) || undefined;
}

function append(params: URLSearchParams, name: string, value: string | boolean | undefined) {
  if (typeof value === "string" && value) params.set(name, value);
  if (value === true) params.set(name, "1");
}

export function screenFromUrl(pathname: string, params = new URLSearchParams()): Screen {
  const parts = pathname.split("/").filter(Boolean);

  if (parts[0] === "inbox" && parts.length === 1) {
    return { name: "list", id: "inbox", query: optional(params, "q"), editing: params.get("edit") === "1" };
  }

  if (parts[0] === "lists" && parts[1]) {
    return { name: "list", id: decoded(parts[1]), query: optional(params, "q"), editing: params.get("edit") === "1" };
  }

  if ((parts.length === 0) || (parts[0] === "lists" && parts.length === 1)) {
    return { name: "lists", tag: optional(params, "tag"), creating: params.get("new") === "1" };
  }

  if (parts[0] === "search" && parts.length === 1) {
    return {
      name: "search",
      query: optional(params, "q"),
      type: optional(params, "type"),
      listId: optional(params, "list"),
      tag: optional(params, "tag"),
      offline: params.get("offline") === "1",
    };
  }

  if (parts[0] === "add" && parts.length === 1) {
    const mode = optional(params, "mode");
    return {
      name: "quick",
      destinationListId: optional(params, "list"),
      kind: mode === "clothing" || mode === "movie" ? mode : "quick",
    };
  }

  if (parts[0] === "items" && parts[1]) {
    return {
      name: "item",
      id: decoded(parts[1]),
      returnTo: optional(params, "from"),
      editing: params.get("edit") === "1",
    };
  }

  return { name: "lists" };
}

export function urlForScreen(screen: Screen) {
  const params = new URLSearchParams();
  let pathname: string;

  switch (screen.name) {
    case "lists":
      pathname = "/lists";
      append(params, "tag", screen.tag);
      append(params, "new", screen.creating);
      break;
    case "search":
      pathname = "/search";
      append(params, "q", screen.query);
      append(params, "type", screen.type);
      append(params, "list", screen.listId);
      append(params, "tag", screen.tag);
      append(params, "offline", screen.offline);
      break;
    case "quick":
      pathname = "/add";
      if (screen.kind && screen.kind !== "quick") append(params, "mode", screen.kind);
      append(params, "list", screen.destinationListId);
      break;
    case "list":
      pathname = screen.id === "inbox" ? "/inbox" : `/lists/${segment(screen.id)}`;
      append(params, "q", screen.query);
      append(params, "edit", screen.editing);
      break;
    case "item":
      pathname = `/items/${segment(screen.id)}`;
      append(params, "from", screen.returnTo);
      append(params, "edit", screen.editing);
      break;
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
