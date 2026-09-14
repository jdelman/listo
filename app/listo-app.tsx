"use client";
import Link from "next/link";

import { FormEvent, Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { classify, hostname, mediaPlatform, youtubeId } from "@/lib/capture";
import { exportList } from "@/lib/export";
import { Screen, screenFromUrl, urlForScreen } from "@/lib/routes";
import { useListoStore } from "@/lib/store";
import { ITEM_LABELS, MEASUREMENT_PRESETS, Item, ItemType, List, Measurement, ProcessingJob, splitTags, uid } from "@/lib/types";

import { usePageTitle } from "@/app/components/use-page-title";
import { TagInput } from "@/app/components/tag-input";

const tagOptions = (store: ReturnType<typeof useListoStore>) => [...store.db.lists, ...store.db.items].flatMap((entry) => entry.tags);

type Navigate = (screen: Screen, replace?: boolean) => void;

export default function Home({ username }: { username: string }) {
  return <Suspense fallback={<main className="shell"><p>Opening Listo…</p></main>}><ListoApp username={username} /></Suspense>;
}

function ListoApp({ username }: { username: string }) {
  const store = useListoStore(username);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const screen = screenFromUrl(pathname, new URLSearchParams(searchParams.toString()));
  const [notice, setNotice] = useState("");
  usePageTitle(screen, store.db.lists, store.db.items, store.ready);

  const navigate: Navigate = (next, replace = false) => {
    const url = urlForScreen(next);
    if (replace) router.replace(url, { scroll: false });
    else router.push(url);
  };
  const openList = (id: string) => navigate({ name: "list", id });
  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(""), 2500); };

  if (!store.ready) return <main className="shell"><p>Opening Listo…</p></main>;

  return (
    <div className="shell">
      <header className="masthead">
        <button className="brand" onClick={() => navigate({ name: "lists" })}>Listo</button>
        <nav aria-label="Main navigation">
          <button aria-current={screen.name === "lists" ? "page" : undefined} onClick={() => navigate({ name: "lists" })}>Lists</button>
          <button aria-current={screen.name === "list" && screen.id === "inbox" ? "page" : undefined} onClick={() => openList("inbox")}>Inbox</button>
          <button aria-current={screen.name === "search" ? "page" : undefined} onClick={() => navigate({ name: "search" })}>Search</button>
          <button className="primary" aria-current={screen.name === "quick" ? "page" : undefined} onClick={() => navigate({ name: "quick" })}>Quick Add</button>
          <Link prefetch={false} href="/profile">Profile</Link>
          <form action="/logout" method="post"><button>Log out</button></form>
        </nav>
      </header>
      {notice && <p className="notice" role="status">{notice}</p>}
      {store.hasLegacy && <div className="notice"><p>Older lists are saved in this browser.</p><button onClick={() => void store.importLegacy()}>Import my older lists</button></div>}
      {store.error && <p className="error-banner" role="alert">{store.error}</p>}
      <main>
        {screen.name === "lists" && <ListsScreen store={store} screen={screen} navigate={navigate} openList={openList} />}
        {screen.name === "list" && <ListScreen store={store} screen={screen} navigate={navigate} flash={flash} />}
        {screen.name === "quick" && <QuickAdd store={store} screen={screen} navigate={navigate} afterSave={(listId) => { flash("Saved."); openList(listId); }} />}
        {screen.name === "search" && <SearchScreen key={[screen.type, screen.listId, screen.tag, screen.offline].join("|")} store={store} screen={screen} navigate={navigate} />}
        {screen.name === "item" && <ItemScreen store={store} screen={screen} navigate={navigate} navigateUrl={(url) => router.push(url)} flash={flash} />}
      </main>
      <footer className="site-footer">Your lists are stored in your local SQLite database. Export anything you want to keep elsewhere.</footer>
    </div>
  );
}

function ListsScreen({ store, screen, navigate, openList }: { store: ReturnType<typeof useListoStore>; screen: Extract<Screen, { name: "lists" }>; navigate: Navigate; openList: (id: string) => void }) {
  const showForm = Boolean(screen.creating);
  const [tag, setTag] = useState(screen.tag ?? "");
  const allTags = [...new Set(store.db.lists.flatMap((list) => list.tags))].sort();
  const lists = tag ? store.db.lists.filter((list) => list.tags.includes(tag)) : store.db.lists;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const id = store.createList({ title: String(form.get("title")), description: String(form.get("description")), tags: splitTags(String(form.get("tags"))) });
    openList(id);
  }

  return <section>
    <div className="page-heading"><div><h1>Lists</h1><p>Ordered collections of anything.</p></div><button className="primary" onClick={() => navigate({ ...screen, creating: !showForm })}>New list</button></div>
    {showForm && <form className="panel form-grid" onSubmit={submit}>
      <label>Title<input name="title" required autoFocus /></label>
      <label>Description<input name="description" /></label>
      <TagInput options={tagOptions(store)} />
      <div className="actions"><button className="primary" type="submit">Create list</button><button type="button" onClick={() => navigate({ ...screen, creating: false }, true)}>Cancel</button></div>
    </form>}
    {allTags.length > 0 && <label className="inline-filter">Filter by tag <select value={tag} onChange={(event) => { setTag(event.target.value); navigate({ ...screen, tag: event.target.value || undefined }, true); }}><option value="">All tags</option>{allTags.map((value) => <option key={value}>{value}</option>)}</select></label>}
    <div className="list-grid">
      {lists.map((list) => {
        const count = store.db.listItems.filter((entry) => entry.listId === list.id).length;
        return <button className="list-tile" key={list.id} onClick={() => openList(list.id)}>
          {list.metadata?.thumbnailUrl && <UploadedImage src={list.metadata.thumbnailUrl} alt={list.title} />}<strong>{list.title}</strong><span>{list.description || "No description"}</span><span>{count} {count === 1 ? "item" : "items"} · Updated {formatDate(list.updatedAt)}</span>
          <TagRow tags={list.tags} />
        </button>;
      })}
    </div>
  </section>;
}

function ListScreen({ store, screen, navigate, flash }: { store: ReturnType<typeof useListoStore>; screen: Extract<Screen, { name: "list" }>; navigate: Navigate; flash: (message: string) => void }) {
  const listId = screen.id;
  const list = store.db.lists.find((candidate) => candidate.id === listId);
  const editing = Boolean(screen.editing);
  const [filter, setFilter] = useState(screen.query ?? "");
  if (!list) return <p>That list no longer exists.</p>;
  const activeList = list;
  const placements = store.db.listItems.filter((entry) => entry.listId === listId).sort((a, b) => a.position - b.position);
  const items = placements.map((entry) => store.db.items.find((item) => item.id === entry.itemId)).filter((item): item is Item => Boolean(item));
  const visible = filter ? items.filter((item) => searchable(item).includes(filter.toLowerCase())) : items;

  function saveList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    store.updateList(activeList.id, { title: String(form.get("title")), description: String(form.get("description")), tags: splitTags(String(form.get("tags"))), defaultView: String(form.get("view")) as List["defaultView"] });
    navigate({ ...screen, editing: false }, true); flash("List updated.");
  }

  return <section>
    <button className="back" onClick={() => navigate({ name: "lists" })}>← All lists</button>
    {editing ? <form className="panel form-grid" onSubmit={saveList}>
      <label>Title<input name="title" defaultValue={list.title} required /></label><label>Description<input name="description" defaultValue={list.description} /></label>
      <TagInput key={list.id} options={tagOptions(store)} defaultValue={list.tags} /><label>View<select name="view" defaultValue={list.defaultView}>{["list", "compact", "gallery", "playlist", "document", "table"].map((mode) => <option key={mode}>{mode}</option>)}</select></label>
      <div className="actions"><button className="primary">Save</button><button type="button" onClick={() => navigate({ ...screen, editing: false }, true)}>Cancel</button></div>
    </form> : <div className="page-heading"><div><h1>{list.title}</h1>{list.metadata?.thumbnailUrl && <UploadedImage src={list.metadata.thumbnailUrl} alt={list.title} />}<p>{list.description}</p><TagRow tags={list.tags} /></div><div className="actions"><button onClick={() => navigate({ ...screen, editing: true })}>Edit list</button><button onClick={() => exportList(list, items)}>Export HTML</button>{list.id !== "inbox" && <button className="danger" onClick={() => { if (confirm("Delete this list? Its items will remain in other lists.")) { store.deleteList(list.id); navigate({ name: "lists" }); } }}>Delete list</button>}</div></div>}
    <div className="toolbar"><button className="primary" onClick={() => navigate({ name: "quick", destinationListId: list.id })}>Add an item</button><label>Search this list<input value={filter} onChange={(event) => { setFilter(event.target.value); navigate({ ...screen, query: event.target.value || undefined }, true); }} /></label><span>{items.length} items · {list.defaultView} view</span></div>
    {visible.length === 0 ? <div className="empty"><p>{items.length ? "Nothing matches that search." : "This list is empty."}</p><button onClick={() => navigate({ name: "quick", destinationListId: list.id })}>Add the first item</button></div> : <div className={`items view-${list.defaultView}`}>
      {visible.map((item, index) => <ItemCard key={item.id} item={item} job={latestJob(store.db.jobs, item.id)} draggable={!filter} onDragStart={(event) => event.dataTransfer.setData("text/plain", item.id)} onDrop={(event) => { event.preventDefault(); store.reorderItem(list.id, event.dataTransfer.getData("text/plain"), item.id); }} onOpen={() => navigate({ name: "item", id: item.id, returnTo: urlForScreen(screen) })} onEdit={() => navigate({ name: "item", id: item.id, editing: true, returnTo: urlForScreen(screen) })} controls={<><button disabled={Boolean(filter) || index === 0} onClick={() => store.moveItem(list.id, item.id, -1)} aria-label={`Move ${item.title} up`}>↑</button><button disabled={Boolean(filter) || index === visible.length - 1} onClick={() => store.moveItem(list.id, item.id, 1)} aria-label={`Move ${item.title} down`}>↓</button><button onClick={() => store.removeFromList(list.id, item.id)}>Remove</button></>} />)}
    </div>}
  </section>;
}

function QuickAdd({ store, screen, navigate, afterSave }: { store: ReturnType<typeof useListoStore>; screen: Extract<Screen, { name: "quick" }>; navigate: Navigate; afterSave: (listId: string) => void }) {
  const kind = screen.kind ?? "quick";
  const [input, setInput] = useState("");
  const [override, setOverride] = useState<ItemType | "auto">("auto");
  const [destination, setDestination] = useState(screen.destinationListId ?? "inbox");
  const [file, setFile] = useState<File | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([{ id: uid(), name: "chest", value: "", unit: "in" }]);
  const detected = override === "auto" ? classify(input, file) : override;

  async function saveQuick(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let dataUrl: string | undefined;
    if (file) dataUrl = await readFile(file);
    const type = detected;
    const url = /^https?:\/\//i.test(input.trim()) ? input.trim() : undefined;
    const platform = type === "media" ? mediaPlatform(input) : undefined;
    const platformId = platform === "youtube" ? youtubeId(input) : undefined;
    const title = file?.name || (type === "note" ? input.trim().slice(0, 60) || "Untitled note" : url ? hostname(url) : input.trim()) || `Untitled ${ITEM_LABELS[type]}`;
    store.createItem({ type, title, description: "", tags: [], sourceUrl: url, availability: { external: Boolean(url), localReference: false, imported: Boolean(file) }, metadata: { markdown: type === "note" ? input : undefined, url, platform, platformId, fileName: file?.name, mimeType: file?.type, dataUrl } }, [destination]);
    afterSave(destination);
  }

  function saveClothing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get("name"));
    const photo = form.get("photo") as File; const valid = measurements.filter((measurement) => measurement.name.trim() && String(measurement.value).trim());
    const finish = (dataUrl?: string) => { store.createItem({ type: "clothing", title: name, description: String(form.get("description")), tags: splitTags(String(form.get("tags"))), availability: { external: false, localReference: false, imported: Boolean(dataUrl) }, metadata: { name, size: String(form.get("size")), measurements: valid, dataUrl, fileName: photo?.name } }, [destination]); afterSave(destination); };
    if (photo?.size) readFile(photo).then(finish); else finish();
  }

  function saveMovie(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const title = String(form.get("title"));
    store.createItem({ type: "movie", title, description: String(form.get("description")), tags: splitTags(String(form.get("tags"))), sourceUrl: String(form.get("tmdbId")) ? `https://www.themoviedb.org/movie/${form.get("tmdbId")}` : undefined, availability: { external: Boolean(form.get("tmdbId")), localReference: false, imported: false }, metadata: { year: Number(form.get("year")) || undefined, tmdbId: Number(form.get("tmdbId")) || undefined } }, [destination]); afterSave(destination);
  }

  return <section className="narrow"><div className="page-heading"><div><h1>Quick Add</h1><p>Save first. Organize when you want to.</p></div></div>
    <div className="tabs"><button aria-current={kind === "quick" ? "page" : undefined} onClick={() => navigate({ ...screen, kind: "quick" })}>Text, URL, or file</button><button aria-current={kind === "clothing" ? "page" : undefined} onClick={() => navigate({ ...screen, kind: "clothing" })}>Clothing</button><button aria-current={kind === "movie" ? "page" : undefined} onClick={() => navigate({ ...screen, kind: "movie" })}>Movie</button></div>
    {kind === "quick" && <form className="panel form-grid" onSubmit={saveQuick}>
      <label className="full">Paste a URL, type a note, or name something<textarea autoFocus onFocus={(event) => event.currentTarget.select()} rows={7} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Paste URL, type a note, or drop a file…" /></label>
      <label>File<input type="file" accept="image/*,.pdf,application/pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
      <label>Type<select value={override} onChange={(event) => setOverride(event.target.value as ItemType | "auto")}><option value="auto">Auto-detect</option>{Object.entries(ITEM_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <p className="full">Detected as: <strong>{ITEM_LABELS[detected]}</strong></p><button className="primary" type="submit" disabled={!input.trim() && !file}>Save item</button>
    </form>}
    {kind === "clothing" && <form className="panel form-grid" onSubmit={saveClothing}>
      <label>Name<input name="name" required /></label><label>Size <small>(freeform)</small><input name="size" placeholder="40R" /></label><label>Photograph<input name="photo" type="file" accept="image/*" /></label><TagInput options={tagOptions(store)} /><label className="full">Notes<textarea name="description" rows={3} /></label>
      <fieldset className="full"><legend>Measurements</legend>{measurements.map((measurement, index) => <div className="measurement" key={measurement.id}><label>Name<input list="measurement-presets" value={measurement.name} onChange={(event) => setMeasurements((all) => all.map((value, i) => i === index ? { ...value, name: event.target.value } : value))} /></label><label>Value<input value={measurement.value} onChange={(event) => setMeasurements((all) => all.map((value, i) => i === index ? { ...value, value: event.target.value } : value))} /></label><label>Unit<select value={measurement.unit ?? ""} onChange={(event) => setMeasurements((all) => all.map((value, i) => i === index ? { ...value, unit: (event.target.value || undefined) as Measurement["unit"] } : value))}><option value="">None</option><option value="in">in</option><option value="cm">cm</option></select></label><button type="button" onClick={() => setMeasurements((all) => all.filter((_, i) => i !== index))}>Remove</button></div>)}<datalist id="measurement-presets">{MEASUREMENT_PRESETS.map((name) => <option key={name}>{name}</option>)}</datalist><button type="button" onClick={() => setMeasurements((all) => [...all, { id: uid(), name: "", value: "", unit: "in" }])}>Add measurement</button></fieldset>
      <button className="primary" type="submit">Save clothing</button>
    </form>}
    {kind === "movie" && <form className="panel form-grid" onSubmit={saveMovie}><label>Title<input name="title" required /></label><label>Year<input name="year" inputMode="numeric" /></label><label>TMDB ID <small>(optional)</small><input name="tmdbId" inputMode="numeric" /></label><TagInput options={tagOptions(store)} /><label className="full">Notes<textarea name="description" rows={3} /></label><p className="full"><a href="https://www.themoviedb.org/search/movie" target="_blank" rel="noreferrer">Search TMDB for the ID ↗</a></p><button className="primary">Save movie</button></form>}
    <label className="destination">Save to<select value={destination} onChange={(event) => { setDestination(event.target.value); navigate({ ...screen, destinationListId: event.target.value }, true); }}>{store.db.lists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}</select></label>
  </section>;
}

function SearchScreen({ store, screen, navigate }: { store: ReturnType<typeof useListoStore>; screen: Extract<Screen, { name: "search" }>; navigate: Navigate }) {
  const [query, setQuery] = useState(screen.query ?? ""); const [type, setType] = useState(screen.type ?? ""); const [listId, setListId] = useState(screen.listId ?? ""); const [tag, setTag] = useState(screen.tag ?? ""); const [offline, setOffline] = useState(Boolean(screen.offline));
  const update = (changes: Partial<Omit<typeof screen, "name">>, replace = false) => navigate({ ...screen, ...changes }, replace);
  const results = useMemo(() => store.db.items.filter((item) => {
    const inList = !listId || store.db.listItems.some((entry) => entry.listId === listId && entry.itemId === item.id);
    return (!query || searchable(item).includes(query.toLowerCase())) && (!type || item.type === type) && (!tag || item.tags.includes(tag)) && inList && (!offline || item.availability.imported);
  }), [store.db, query, type, listId, tag, offline]);
  const tags = [...new Set(store.db.items.flatMap((item) => item.tags))].sort();
  return <section><div className="page-heading"><div><h1>Search</h1><p>Search titles, notes, metadata, tags, sizes, and measurements.</p></div></div><div className="search-controls"><label className="wide">Query<input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); update({ query: event.target.value || undefined }, true); }} placeholder="Try 22.5, shoulder, or herringbone" /></label><label>Type<select value={type} onChange={(event) => { setType(event.target.value); update({ type: event.target.value || undefined }); }}><option value="">All types</option>{Object.entries(ITEM_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>List<select value={listId} onChange={(event) => { setListId(event.target.value); update({ listId: event.target.value || undefined }); }}><option value="">All lists</option>{store.db.lists.map((list) => <option value={list.id} key={list.id}>{list.title}</option>)}</select></label><label>Tag<select value={tag} onChange={(event) => { setTag(event.target.value); update({ tag: event.target.value || undefined }); }}><option value="">All tags</option>{tags.map((value) => <option key={value}>{value}</option>)}</select></label><label className="checkbox"><input type="checkbox" checked={offline} onChange={(event) => { setOffline(event.target.checked); update({ offline: event.target.checked }); }} /> Imported/offline only</label></div><p>{results.length} result{results.length === 1 ? "" : "s"}</p><div className="items">{results.map((item) => <ItemCard key={item.id} item={item} job={latestJob(store.db.jobs, item.id)} onOpen={() => navigate({ name: "item", id: item.id, returnTo: urlForScreen({ ...screen, query: query || undefined, type: type || undefined, listId: listId || undefined, tag: tag || undefined, offline }) })} onEdit={() => navigate({ name: "item", id: item.id, editing: true, returnTo: urlForScreen({ ...screen, query: query || undefined, type: type || undefined, listId: listId || undefined, tag: tag || undefined, offline }) })} />)}</div></section>;
}

function ItemScreen({ store, screen, navigate, navigateUrl, flash }: { store: ReturnType<typeof useListoStore>; screen: Extract<Screen, { name: "item" }>; navigate: Navigate; navigateUrl: (url: string) => void; flash: (message: string) => void }) {
  const item = store.db.items.find((candidate) => candidate.id === screen.id); const editing = Boolean(screen.editing);
  if (!item) return <p>That item no longer exists.</p>;
  const activeItem = item;
  const selected = store.db.listItems.filter((entry) => entry.itemId === item.id).map((entry) => entry.listId);
  function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); store.updateItem(activeItem.id, { title: String(form.get("title")), description: String(form.get("description")), tags: splitTags(String(form.get("tags"))), metadata: { ...activeItem.metadata, markdown: activeItem.type === "note" ? String(form.get("markdown")) : activeItem.metadata.markdown, size: activeItem.type === "clothing" ? String(form.get("size")) : activeItem.metadata.size } }); store.setItemLists(activeItem.id, form.getAll("lists").map(String)); navigate({ ...screen, editing: false }, true); flash("Item updated."); }
  return <section className="narrow"><button className="back" onClick={() => navigateUrl(screen.returnTo || "/lists")}>← Back</button><div className="page-heading"><div><small>{ITEM_LABELS[item.type]}</small><h1>{item.title}</h1></div><div className="actions"><button onClick={() => navigate({ ...screen, editing: !editing })}>{editing ? "Cancel editing" : "Edit"}</button><button className="danger" onClick={() => { if (confirm("Delete this item everywhere?")) { store.deleteItem(item.id); navigate({ name: "lists" }); } }}>Delete everywhere</button></div></div>
    {editing ? <form className="panel form-grid" onSubmit={save}><label>Title<input name="title" defaultValue={item.title} required /></label><TagInput key={item.id} options={tagOptions(store)} defaultValue={item.tags} />{item.type === "clothing" && <label>Size<input name="size" defaultValue={item.metadata.size} /></label>}<label className="full">Description<textarea name="description" defaultValue={item.description} rows={3} /></label>{item.type === "note" && <label className="full">Markdown<textarea name="markdown" defaultValue={item.metadata.markdown} rows={10} /></label>}<fieldset className="full"><legend>Appears in</legend>{store.db.lists.map((list) => <label className="checkbox" key={list.id}><input type="checkbox" name="lists" value={list.id} defaultChecked={selected.includes(list.id)} /> {list.title}</label>)}</fieldset><div className="actions"><button className="primary" type="submit">Save changes</button><button type="button" onClick={() => navigate({ ...screen, editing: false }, true)}>Cancel</button></div></form> : <ItemCard item={item} job={latestJob(store.db.jobs, item.id)} onOpen={() => undefined} expanded />}
    <section><h2>Lists containing this item</h2><div className="actions">{store.db.lists.filter((list) => selected.includes(list.id)).map((list) => <button key={list.id} onClick={() => navigate({ name: "list", id: list.id })}>{list.title}</button>)}</div></section>
  </section>;
}

function ItemCard({ item, job, onOpen, onEdit, controls, draggable, onDragStart, onDrop, expanded = false }: { item: Item; job?: ProcessingJob; onOpen: () => void; onEdit?: () => void; controls?: React.ReactNode; draggable?: boolean; onDragStart?: React.DragEventHandler; onDrop?: React.DragEventHandler; expanded?: boolean }) {
  return <article className="item-card" draggable={draggable} onDragStart={onDragStart} onDragOver={(event) => draggable && event.preventDefault()} onDrop={onDrop}>
    <div className="item-top"><div><small>{ITEM_LABELS[item.type]} · {availability(item)}</small><h2>{expanded ? item.title : <button className="title-button" onClick={onOpen}>{item.title}</button>}</h2></div>{(onEdit || controls) && <div className="actions">{onEdit && <button onClick={onEdit} aria-label={`Edit ${item.title}`}>Edit</button>}{controls}</div>}</div>
    {job && job.status !== "completed" && <p className={`job-status job-${job.status}`}>{job.status === "queued" ? "Waiting for processing…" : job.status === "running" ? "Processing…" : `Processing failed${job.lastError ? `: ${job.lastError}` : "."}`}</p>}
    {item.metadata.thumbnailUrl && <UploadedImage src={item.metadata.thumbnailUrl} alt={item.title} />}{item.description && <p>{item.description}</p>}<ItemContent item={item} />{item.metadata.importedListId && <p><a href={`/lists/${encodeURIComponent(item.metadata.importedListId)}`}>Open imported playlist →</a></p>}{item.metadata.derived && <aside className="derived"><strong>Processed summary</strong><p>{item.metadata.derived.summary}</p><small>{Object.entries(item.metadata.derived.attributes).map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}`).join(" · ")}</small></aside>}<TagRow tags={item.tags} />
  </article>;
}

function UploadedImage({ src, alt }: { src: string; alt: string }) {
  // Uploaded data URLs have no known dimensions and cannot benefit from Next.js image optimization.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="preview" src={src} alt={alt} />;
}

function ItemContent({ item }: { item: Item }) {
  if (item.type === "note") return <Markdown text={item.metadata.markdown ?? ""} />;
  if (item.type === "image" && item.metadata.dataUrl) return <UploadedImage src={item.metadata.dataUrl} alt={item.title} />;
  if (item.type === "pdf") return <p>{item.metadata.dataUrl ? <a href={item.metadata.dataUrl} target="_blank">Open {item.metadata.fileName || "PDF"}</a> : item.sourceUrl ? <a href={item.sourceUrl}>Open PDF</a> : "PDF unavailable"}</p>;
  if (item.type === "media" && item.metadata.platform === "youtube" && item.metadata.platformId) return <div className="video"><iframe src={`https://www.youtube-nocookie.com/embed/${item.metadata.platformId}`} title={item.title} allowFullScreen /></div>;
  if (item.type === "url" || item.type === "media") return item.sourceUrl ? <p><a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceUrl} ↗</a></p> : null;
  if (item.type === "movie") return <p>{item.metadata.year || "Year unknown"}{item.metadata.tmdbId && <> · <a href={`https://www.themoviedb.org/movie/${item.metadata.tmdbId}`} target="_blank" rel="noreferrer">TMDB {item.metadata.tmdbId} ↗</a></>}</p>;
  if (item.type === "clothing") return <>{(item.sourceUrl || item.metadata.url) && <p><a href={item.sourceUrl || item.metadata.url} target="_blank" rel="noreferrer">{item.sourceUrl || item.metadata.url} ↗</a></p>}<div className="clothing">{item.metadata.dataUrl && <UploadedImage src={item.metadata.dataUrl} alt={item.title} />}<div><p><strong>Size:</strong> {item.metadata.size || "—"}</p><dl>{(item.metadata.measurements ?? []).map((measurement) => <div key={measurement.id}><dt>{measurement.name}</dt><dd>{measurement.value}{measurement.unit ? ` ${measurement.unit}` : ""}</dd></div>)}</dl></div></div></>;
  return null;
}

function Markdown({ text }: { text: string }) { return <div className="markdown">{text.split("\n").map((line, index) => line.startsWith("### ") ? <h4 key={index}>{line.slice(4)}</h4> : line.startsWith("## ") ? <h3 key={index}>{line.slice(3)}</h3> : line.startsWith("# ") ? <h2 key={index}>{line.slice(2)}</h2> : line.startsWith("- ") ? <div key={index}>• {line.slice(2)}</div> : <p key={index}>{linkify(line)}</p>)}</div>; }
function linkify(text: string) { const match = text.match(/^(.*)\[([^\]]+)\]\((https?:\/\/[^)]+)\)(.*)$/); return match ? <>{match[1]}<a href={match[3]}>{match[2]}</a>{match[4]}</> : text; }
function TagRow({ tags }: { tags: string[] }) { return tags.length ? <div className="tags">{tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null; }
function availability(item: Item) { const { external, imported, localReference } = item.availability; if (imported && external) return "Linked + Imported"; if (imported) return "Imported"; if (external) return "Linked"; if (localReference) return "Local"; return "Stored"; }
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)); }
function readFile(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }); }
function searchable(item: Item) { return [item.title, item.description, item.tags.join(" "), item.sourceUrl, item.metadata.markdown, item.metadata.url, item.metadata.platform, item.metadata.year, item.metadata.tmdbId, item.metadata.name, item.metadata.size, item.metadata.fileName, item.metadata.derived?.summary, ...Object.entries(item.metadata.derived?.attributes ?? {}).flatMap(([name, value]) => [name, Array.isArray(value) ? value.join(" ") : value]), ...(item.metadata.measurements ?? []).flatMap((measurement) => [measurement.name, measurement.value, measurement.unit])].join(" ").toLowerCase(); }
function latestJob(jobs: ProcessingJob[], itemId: string) { return jobs.filter((job) => job.itemId === itemId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]; }
