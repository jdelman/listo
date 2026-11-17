"use client";
import Link from "next/link";

import { FormEvent, Suspense, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { classify, hostname, mediaPlatform, youtubeId } from "@/lib/capture";
import { exportList } from "@/lib/export";
import { uploadedItemImage } from "@/lib/item-image";
import { textLinks } from "@/lib/links";
import { Screen, screenFromUrl, urlForScreen } from "@/lib/routes";
import { spotifyMusicUrl } from "@/lib/spotify";
import { useListoStore } from "@/lib/store";
import { ITEM_LABELS, ITEM_TYPES, MEASUREMENT_PRESETS, Item, ItemMetadata, List, Measurement, ProcessingJob, splitTags, uid } from "@/lib/types";

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
        {screen.name === "quick" && <QuickAdd flash={flash} store={store} screen={screen} navigate={navigate} afterSave={(listId) => { flash("Saved."); openList(listId); }} />}
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
        return <div className="list-tile" key={list.id}>
          {list.metadata?.thumbnailUrl && <UploadedImage src={list.metadata.thumbnailUrl} alt={list.title} />}<strong><button className="title-button" onClick={() => openList(list.id)}>{list.title}</button></strong><span>{linkify(list.description || "No description")}</span><span>{count} {count === 1 ? "item" : "items"} · Updated {formatDate(list.updatedAt)}</span>
          <TagRow tags={list.tags} />
        </div>;
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
      <TagInput key={list.id} options={tagOptions(store)} defaultValue={list.tags} /><label>View<select name="view" defaultValue={list.defaultView}>{["list", "grid", "compact", "gallery", "playlist", "document", "table"].map((mode) => <option key={mode}>{mode}</option>)}</select></label>
      <div className="actions"><button className="primary">Save</button><button type="button" onClick={() => navigate({ ...screen, editing: false }, true)}>Cancel</button></div>
    </form> : <div className="page-heading"><div><h1>{list.title}</h1>{list.metadata?.thumbnailUrl && <UploadedImage src={list.metadata.thumbnailUrl} alt={list.title} />}<p>{linkify(list.description)}</p><TagRow tags={list.tags} /></div><div className="actions"><button onClick={() => navigate({ ...screen, editing: true })}>Edit list</button><button onClick={() => exportList(list, items)}>Export HTML</button>{list.id !== "inbox" && <button className="danger" onClick={() => { if (confirm("Delete this list? Its items will remain in other lists.")) { store.deleteList(list.id); navigate({ name: "lists" }); } }}>Delete list</button>}</div></div>}
    <div className="toolbar"><button className="primary" onClick={() => navigate({ name: "quick", destinationListId: list.id })}>Add an item</button><label>Search this list<input value={filter} onChange={(event) => { setFilter(event.target.value); navigate({ ...screen, query: event.target.value || undefined }, true); }} /></label><label>View<select value={list.defaultView} onChange={(event) => store.updateList(list.id, { defaultView: event.target.value as List["defaultView"] })}>{["list", "grid", "compact", "gallery", "playlist", "document", "table"].map((mode) => <option key={mode} value={mode}>{mode === "grid" ? "Grid" : mode}</option>)}</select></label><span>{items.length} items</span></div>
    {visible.length === 0 ? <div className="empty"><p>{items.length ? "Nothing matches that search." : "This list is empty."}</p><button onClick={() => navigate({ name: "quick", destinationListId: list.id })}>Add the first item</button></div> : <div className={`items view-${list.defaultView}`}>
      {visible.map((item, index) => {
        const onOpen = () => navigate({ name: "item", id: item.id, returnTo: urlForScreen(screen) });
        const dragProps = {
          draggable: !filter,
          onDragStart: (event: React.DragEvent) => event.dataTransfer.setData("text/plain", item.id),
          onDrop: (event: React.DragEvent) => {
            event.preventDefault();
            store.reorderItem(list.id, event.dataTransfer.getData("text/plain"), item.id);
          },
        };

        if (list.defaultView === "grid") {
          return <GridTile key={item.id} item={item} onOpen={onOpen} {...dragProps} />;
        }

        return <ItemCard key={item.id} item={item} job={latestJob(store.db.jobs, item.id)} onOpen={onOpen} {...dragProps} onEdit={() => navigate({ name: "item", id: item.id, editing: true, returnTo: urlForScreen(screen) })} controls={<><button disabled={Boolean(filter) || index === 0} onClick={() => store.moveItem(list.id, item.id, -1)} aria-label={`Move ${item.title} up`}>↑</button><button disabled={Boolean(filter) || index === visible.length - 1} onClick={() => store.moveItem(list.id, item.id, 1)} aria-label={`Move ${item.title} down`}>↓</button><button onClick={() => store.removeFromList(list.id, item.id)}>Remove</button></>} />;
      })}
    </div>}
  </section>;
}

function QuickAdd({ store, screen, navigate, afterSave, flash }: { store: ReturnType<typeof useListoStore>; screen: Extract<Screen, { name: "quick" }>; navigate: Navigate; afterSave: (listId: string) => void; flash: (message: string) => void }) {
  const kind = screen.kind ?? "quick";
  const [input, setInput] = useState("");
  const [destination, setDestination] = useState(screen.destinationListId ?? "inbox");
  const [file, setFile] = useState<File | null>(null);
  const [image, setImage] = useState<File | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([{ id: uid(), name: "chest", value: "", unit: "in" }]);
  const imageOnly = !file && !input.trim() && (kind === "quick" || kind === "image") ? image : null;
  const type = kind === "quick" ? classify(input, file ?? imageOnly) : kind;
  const usesGenericForm = kind !== "clothing" && kind !== "movie";
  const music = kind === "album" || kind === "track";

  async function saveQuick(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let dataUrl: string | undefined;
    let imageDataUrl: string | undefined;
    try {
      [dataUrl, imageDataUrl] = await Promise.all([file ? readFile(file) : undefined, readItemImage(form)]);
    } catch { flash("Could not read the selected file."); return; }
    const url = /^https?:\/\//i.test(input.trim()) ? input.trim() : undefined;
    const platform = type === "media" ? mediaPlatform(input) : undefined;
    const platformId = platform === "youtube" ? youtubeId(input) : undefined;
    const title = file?.name || imageOnly?.name || (type === "note" ? input.trim().slice(0, 60) || "Untitled note" : url ? hostname(url) : input.trim()) || `Untitled ${ITEM_LABELS[type]}`;
    store.createItem({ type, title, description: "", tags: [], sourceUrl: url, availability: { external: Boolean(url), localReference: false, imported: Boolean(file || imageOnly) }, metadata: { imageDataUrl, markdown: type === "note" ? input : undefined, url, platform, platformId, fileName: file?.name, mimeType: file?.type, dataUrl } }, [destination]);
    afterSave(destination);
  }

  async function saveClothing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const photo = form.get("image");
    const valid = measurements.filter((measurement) => measurement.name.trim() && String(measurement.value).trim());
    let imageDataUrl: string | undefined;
    try { imageDataUrl = await readItemImage(form); }
    catch { flash("Could not read the selected image."); return; }
    store.createItem({
      type: "clothing", title: String(form.get("name")), description: String(form.get("description")), tags: splitTags(String(form.get("tags"))),
      availability: { external: false, localReference: false, imported: Boolean(imageDataUrl) },
      metadata: { name: String(form.get("name")), size: String(form.get("size")), ...readClothingPrice(form), measurements: valid, imageDataUrl, fileName: imageDataUrl && photo instanceof File ? photo.name : undefined },
    }, [destination]);
    afterSave(destination);
  }

  async function saveMovie(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const tmdbId = Number(form.get("tmdbId")) || undefined;
    let imageDataUrl: string | undefined;
    try { imageDataUrl = await readItemImage(form); }
    catch { flash("Could not read the selected image."); return; }
    store.createItem({
      type: "movie", title: String(form.get("title")), description: String(form.get("description")), tags: splitTags(String(form.get("tags"))),
      sourceUrl: tmdbId ? `https://www.themoviedb.org/movie/${tmdbId}` : undefined,
      availability: { external: Boolean(tmdbId), localReference: false, imported: false },
      metadata: { year: Number(form.get("year")) || undefined, tmdbId, imageDataUrl },
    }, [destination]);
    afterSave(destination);
  }

  return <section className="narrow"><div className="page-heading"><div><h1>Quick Add</h1><p>Save first. Organize when you want to.</p></div></div>
    <label className="destination">Save to<select value={destination} onChange={(event) => { setDestination(event.target.value); navigate({ ...screen, destinationListId: event.target.value }, true); }}>{store.db.lists.map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}</select></label>
    <div className="tabs" role="group" aria-label="Item type">
      <button aria-current={kind === "quick" ? "page" : undefined} onClick={() => navigate({ ...screen, kind: "quick" })}>Auto-detect</button>
      {ITEM_TYPES.map((type) => <button key={type} aria-current={kind === type ? "page" : undefined} onClick={() => navigate({ ...screen, kind: type })}>{ITEM_LABELS[type]}</button>)}
    </div>
    <div hidden={!usesGenericForm}>
      <form className="panel form-grid" onSubmit={saveQuick}>
        <label className="full">{music ? "Spotify link or title and artist" : "Paste a URL, type a note, or name something"}
          <textarea autoFocus={usesGenericForm} onFocus={(event) => event.currentTarget.select()} rows={7} value={input} onChange={(event) => setInput(event.target.value)} />
        </label>
        <label>File<input type="file" accept="image/*,.pdf,application/pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
        <ImageField onChange={setImage} />
        {kind === "quick" && <p className="full">Detected as <strong>{ITEM_LABELS[type]}</strong></p>}
        <button className="primary" type="submit" disabled={!input.trim() && !file && !imageOnly}>Save item</button>
      </form>
    </div>
    {kind === "clothing" && <form className="panel form-grid" onSubmit={saveClothing}>
      <label>Name<input name="name" required /></label><label>Size <small>(freeform)</small><input name="size" placeholder="40R" /></label><ClothingPriceFields /><ImageField /><TagInput options={tagOptions(store)} /><label className="full">Notes<textarea name="description" rows={3} /></label>
      <fieldset className="full"><legend>Measurements</legend>{measurements.map((measurement, index) => <div className="measurement" key={measurement.id}><label>Name<input list="measurement-presets" value={measurement.name} onChange={(event) => setMeasurements((all) => all.map((value, i) => i === index ? { ...value, name: event.target.value } : value))} /></label><label>Value<input value={measurement.value} onChange={(event) => setMeasurements((all) => all.map((value, i) => i === index ? { ...value, value: event.target.value } : value))} /></label><label>Unit<select value={measurement.unit ?? ""} onChange={(event) => setMeasurements((all) => all.map((value, i) => i === index ? { ...value, unit: (event.target.value || undefined) as Measurement["unit"] } : value))}><option value="">None</option><option value="in">in</option><option value="cm">cm</option></select></label><button type="button" onClick={() => setMeasurements((all) => all.filter((_, i) => i !== index))}>Remove</button></div>)}<datalist id="measurement-presets">{MEASUREMENT_PRESETS.map((name) => <option key={name}>{name}</option>)}</datalist><button type="button" onClick={() => setMeasurements((all) => [...all, { id: uid(), name: "", value: "", unit: "in" }])}>Add measurement</button></fieldset>
      <button className="primary" type="submit">Save clothing</button>
    </form>}
    {kind === "movie" && <form className="panel form-grid" onSubmit={saveMovie}><label>Title<input name="title" required /></label><label>Year<input name="year" inputMode="numeric" /></label><label>TMDB ID <small>(optional)</small><input name="tmdbId" inputMode="numeric" /></label><ImageField /><TagInput options={tagOptions(store)} /><label className="full">Notes<textarea name="description" rows={3} /></label><p className="full"><a href="https://www.themoviedb.org/search/movie" target="_blank" rel="noreferrer">Search TMDB for the ID ↗</a></p><button className="primary">Save movie</button></form>}
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
  const [refreshing, setRefreshing] = useState(false);
  if (!item) return <p>That item no longer exists.</p>;
  const job = latestJob(store.db.jobs, item.id);
  const refreshPending = refreshing || (job?.inputRevision === item.revision && (job.status === "queued" || job.status === "running"));
  const activeItem = item;
  const currentImage = uploadedItemImage(item) || item.metadata.thumbnailUrl;
  const selected = store.db.listItems.filter((entry) => entry.itemId === item.id).map((entry) => entry.listId);
  async function refreshItem() {
    setRefreshing(true);
    try {
      await store.refreshItem(activeItem.id);
    } catch (error) {
      flash(error instanceof Error ? error.message : "Could not refresh item.");
    } finally {
      setRefreshing(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let imageDataUrl: string | undefined;
    try { imageDataUrl = await readItemImage(form); }
    catch { flash("Could not read the selected image."); return; }
    const metadata = { ...activeItem.metadata };
    if (imageDataUrl) metadata.imageDataUrl = imageDataUrl;
    else if (form.has("removeImage")) delete metadata.imageDataUrl;
    if (form.has("markdown")) metadata.markdown = String(form.get("markdown"));
    if (activeItem.type === "clothing") {
      metadata.size = String(form.get("size"));
      Object.assign(metadata, readClothingPrice(form));
    }
    const availability = { ...activeItem.availability };
    if (activeItem.type === "image" || activeItem.type === "clothing") {
      if (imageDataUrl) availability.imported = true;
      else if (form.has("removeImage") && !metadata.dataUrl) availability.imported = false;
    }
    store.updateItem(activeItem.id, {
      title: String(form.get("title")), description: String(form.get("description")), tags: splitTags(String(form.get("tags"))), metadata, availability,
    });
    store.setItemLists(activeItem.id, form.getAll("lists").map(String));
    navigate({ ...screen, editing: false }, true);
    flash("Item updated.");
  }
  return <section className="narrow"><button className="back" onClick={() => navigateUrl(screen.returnTo || "/lists")}>← Back</button><div className="page-heading"><div><small>{ITEM_LABELS[item.type]}</small><h1>{item.title}</h1></div><div className="actions">{!editing && <button type="button" disabled={refreshPending} onClick={refreshItem}>Refresh</button>}<button onClick={() => navigate({ ...screen, editing: !editing })}>{editing ? "Cancel editing" : "Edit"}</button><button className="danger" onClick={() => { if (confirm("Delete this item everywhere?")) { store.deleteItem(item.id); navigate({ name: "lists" }); } }}>Delete everywhere</button></div></div>
    {editing ? <form className="panel form-grid" onSubmit={save}><label>Title<input name="title" defaultValue={item.title} required /></label><TagInput key={item.id} options={tagOptions(store)} defaultValue={item.tags} />{item.type === "clothing" && <><label>Size<input name="size" defaultValue={item.metadata.size} /></label><ClothingPriceFields metadata={item.metadata} /></>}<ImageField />{currentImage && <UploadedImage src={currentImage} alt={item.title} />}{item.metadata.imageDataUrl && <label className="checkbox"><input type="checkbox" name="removeImage" /> Remove uploaded image</label>}<label className="full">Description<textarea name="description" defaultValue={item.description} rows={3} /></label>{(item.type === "note" || item.metadata.markdown !== undefined) && <label className="full">Markdown<textarea name="markdown" defaultValue={item.metadata.markdown} rows={10} /></label>}<fieldset className="full"><legend>Appears in</legend>{store.db.lists.map((list) => <label className="checkbox" key={list.id}><input type="checkbox" name="lists" value={list.id} defaultChecked={selected.includes(list.id)} /> {list.title}</label>)}</fieldset><div className="actions"><button className="primary" type="submit">Save changes</button><button type="button" onClick={() => navigate({ ...screen, editing: false }, true)}>Cancel</button></div></form> : <ItemCard item={item} job={job} onOpen={() => undefined} expanded />}
    <section><h2>Lists containing this item</h2><div className="actions">{store.db.lists.filter((list) => selected.includes(list.id)).map((list) => <button key={list.id} onClick={() => navigate({ name: "list", id: list.id })}>{list.title}</button>)}</div></section>
  </section>;
}

function GridTile({ item, onOpen, draggable, onDragStart, onDrop }: {
  item: Item;
  onOpen: () => void;
  draggable: boolean;
  onDragStart: React.DragEventHandler;
  onDrop: React.DragEventHandler;
}) {
  const thumbnail = uploadedItemImage(item) || item.metadata.thumbnailUrl;
  const [failedThumbnail, setFailedThumbnail] = useState<string>();
  const src = thumbnail && thumbnail !== failedThumbnail ? thumbnail : "/thumbnail-placeholder.svg";

  return <button
    className="grid-tile"
    type="button"
    title={item.title}
    onClick={onOpen}
    draggable={draggable}
    onDragStart={onDragStart}
    onDragOver={(event) => draggable && event.preventDefault()}
    onDrop={onDrop}
  >
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={src} alt="" draggable={false} loading="lazy" onError={() => setFailedThumbnail(thumbnail)} />
    <span>{item.title}</span>
  </button>;
}

function ItemCard({ item, job, onOpen, onEdit, controls, draggable, onDragStart, onDrop, expanded = false }: { item: Item; job?: ProcessingJob; onOpen: () => void; onEdit?: () => void; controls?: React.ReactNode; draggable?: boolean; onDragStart?: React.DragEventHandler; onDrop?: React.DragEventHandler; expanded?: boolean }) {
  const previewUrl = uploadedItemImage(item) || item.metadata.thumbnailUrl;
  const spotifyUrl = spotifyMusicUrl(item.metadata.spotifyUrl) || spotifyMusicUrl(item.sourceUrl);
  const music = item.type === "album" || item.type === "track";
  const spotifySearch = music && !spotifyUrl ? `https://open.spotify.com/search/${encodeURIComponent(item.title)}` : undefined;
  const appleMusicUrl = music ? serviceLink(item.metadata.appleMusicUrl, "https://music.apple.com") : undefined;
  const musicQuery = [item.title, item.metadata.artist].filter(Boolean).join(" ");
  const appleSearch = music && !appleMusicUrl && item.metadata.artist
    ? `https://music.apple.com/us/search?term=${encodeURIComponent(musicQuery)}` : undefined;
  const youtubeVideo = item.type === "track" ? serviceLink(item.metadata.youtubeUrl, "https://www.youtube.com") : undefined;
  const youtubeSearch = item.type === "track" && !youtubeVideo && item.metadata.artist
    ? `https://www.youtube.com/results?search_query=${encodeURIComponent(musicQuery)}` : undefined;
  return <article className="item-card" draggable={draggable} onDragStart={onDragStart} onDragOver={(event) => draggable && event.preventDefault()} onDrop={onDrop}>
    <div className="item-top"><div><small>{ITEM_LABELS[item.type]} · {availability(item)}</small><h2>{expanded ? item.title : <button className="title-button" onClick={onOpen}>{item.title}</button>}</h2></div>{(onEdit || controls) && <div className="actions">{onEdit && <button onClick={onEdit} aria-label={`Edit ${item.title}`}>Edit</button>}{controls}</div>}</div>
    {job && job.status !== "completed" && <p className={`job-status job-${job.status}`}>{job.status === "queued" ? "Waiting for processing…" : job.status === "running" ? "Processing…" : `Processing failed${job.lastError ? `: ${job.lastError}` : "."}`}</p>}
    {previewUrl && item.type !== "clothing" && <UploadedImage src={previewUrl} alt={item.title} />}{item.description && item.description !== item.metadata.markdown && <p>{linkify(item.description)}</p>}<ItemContent item={item} previewUrl={previewUrl} />
    {item.metadata.markdown && <Markdown text={item.metadata.markdown} />}
    {item.metadata.importedListId && <p><a href={`/lists/${encodeURIComponent(item.metadata.importedListId)}`}>Open imported playlist →</a></p>}{item.metadata.derived && <aside className="derived"><strong>Processed summary</strong><p>{linkify(item.metadata.derived.summary)}</p><small>{Object.entries(item.metadata.derived.attributes).map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}`).join(" · ")}</small></aside>}<TagRow tags={item.tags} />
    {music && item.metadata.year && <p>{item.metadata.year}</p>}
    {(spotifyUrl || spotifySearch || appleMusicUrl || appleSearch || youtubeVideo || youtubeSearch) && <div className="actions">
      {spotifyUrl && <a href={spotifyUrl} target="_blank" rel="noopener noreferrer">Open in Spotify ↗</a>}
      {spotifySearch && <a href={spotifySearch} target="_blank" rel="noopener noreferrer">Search on Spotify ↗</a>}
      {appleMusicUrl && <a href={appleMusicUrl} target="_blank" rel="noopener noreferrer">Open in Apple Music ↗</a>}
      {appleSearch && <a href={appleSearch} target="_blank" rel="noopener noreferrer">Search on Apple Music ↗</a>}
      {youtubeVideo && <a href={youtubeVideo} target="_blank" rel="noopener noreferrer">Watch on YouTube ↗</a>}
      {youtubeSearch && <a href={youtubeSearch} target="_blank" rel="noopener noreferrer">Search on YouTube ↗</a>}
    </div>}
  </article>;
}

function serviceLink(value: string | undefined, origin: string) {
  const url = value ? URL.parse(value) : null;
  return url?.origin === origin ? url.href : undefined;
}

function ImageField({ onChange }: { onChange?: (file: File | null) => void }) {
  return <label>Image <small>(optional)</small>
    <input name="image" type="file" accept="image/*" onChange={(event) => {
      const input = event.currentTarget;
      const file = input.files?.[0] ?? null;
      const error = file && !file.type.startsWith("image/") ? "Choose an image file." : "";
      input.setCustomValidity(error);
      if (error) input.reportValidity();
      onChange?.(error ? null : file);
    }} />
  </label>;
}

function readItemImage(form: FormData) {
  const image = form.get("image");
  return image instanceof File && image.size ? readFile(image) : undefined;
}

function UploadedImage({ src, alt }: { src: string; alt: string }) {
  // Uploaded data URLs have no known dimensions and cannot benefit from Next.js image optimization.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="preview" src={src} alt={alt} />;
}

function ClothingPriceFields({ metadata }: { metadata?: ItemMetadata }) {
  return <>
    <label>Price<input name="price" type="number" min="0" step="any" defaultValue={metadata?.price} /></label>
    <label>Currency<input name="currency" placeholder="USD" pattern="[A-Za-z]{3}" maxLength={3} defaultValue={metadata?.currency} /></label>
  </>;
}

function readClothingPrice(form: FormData): Pick<ItemMetadata, "price" | "currency"> {
  const amount = String(form.get("price") ?? "").trim();
  const price = Number(amount);
  const currency = String(form.get("currency") ?? "").trim().toUpperCase();
  if (!amount || !Number.isFinite(price) || price < 0) return { price: undefined, currency: undefined };
  return { price, currency: /^[A-Z]{3}$/.test(currency) ? currency : undefined };
}

function formatClothingPrice(price: number, currency?: string) {
  const options: Intl.NumberFormatOptions = currency && /^[A-Z]{3}$/i.test(currency)
    ? { style: "currency", currency, currencyDisplay: "code" }
    : { maximumFractionDigits: 20 };
  return new Intl.NumberFormat(undefined, options).format(price);
}

function ItemContent({ item, previewUrl }: { item: Item; previewUrl?: string }) {
  if (item.type === "pdf") return <p>{item.metadata.dataUrl ? <a href={item.metadata.dataUrl} target="_blank">Open {item.metadata.fileName || "PDF"}</a> : item.sourceUrl ? <a href={item.sourceUrl}>Open PDF</a> : "PDF unavailable"}</p>;
  if (item.type === "media" && item.metadata.platform === "youtube" && item.metadata.platformId) return <div className="video"><iframe src={`https://www.youtube-nocookie.com/embed/${item.metadata.platformId}`} title={item.title} allowFullScreen /></div>;
  if (item.type === "url" || item.type === "media" || item.type === "album" || item.type === "track") return item.sourceUrl && !spotifyMusicUrl(item.sourceUrl) ? <p><a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceUrl} ↗</a></p> : null;
  if (item.type === "movie") return <p>{item.metadata.year || "Year unknown"}{item.metadata.tmdbId && <> · <a href={`https://www.themoviedb.org/movie/${item.metadata.tmdbId}`} target="_blank" rel="noreferrer">TMDB {item.metadata.tmdbId} ↗</a></>}</p>;
  if (item.type === "clothing") return <>{(item.sourceUrl || item.metadata.url) && <p><a href={item.sourceUrl || item.metadata.url} target="_blank" rel="noreferrer">{item.sourceUrl || item.metadata.url} ↗</a></p>}<div className="clothing">{previewUrl && <UploadedImage src={previewUrl} alt={item.title} />}<div><p><strong>Size:</strong> {item.metadata.size || "—"}</p>{typeof item.metadata.price === "number" && <p><strong>Price:</strong> {formatClothingPrice(item.metadata.price, item.metadata.currency)}</p>}<dl>{(item.metadata.measurements ?? []).map((measurement) => <div key={measurement.id}><dt>{measurement.name}</dt><dd>{measurement.value}{measurement.unit ? ` ${measurement.unit}` : ""}</dd></div>)}</dl></div></div></>;
  return null;
}

function Markdown({ text }: { text: string }) { return <div className="markdown">{text.split("\n").map((line, index) => line.startsWith("### ") ? <h4 key={index}>{linkify(line.slice(4))}</h4> : line.startsWith("## ") ? <h3 key={index}>{linkify(line.slice(3))}</h3> : line.startsWith("# ") ? <h2 key={index}>{linkify(line.slice(2))}</h2> : line.startsWith("- ") ? <div key={index}>• {linkify(line.slice(2))}</div> : <p key={index}>{linkify(line)}</p>)}</div>; }
function linkify(text: string) {
  return textLinks(text).map((part, index) => part.href
    ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a>
    : part.text);
}
function TagRow({ tags }: { tags: string[] }) { return tags.length ? <div className="tags">{tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null; }
function availability(item: Item) { const { external, imported, localReference } = item.availability; if (imported && external) return "Linked + Imported"; if (imported) return "Imported"; if (external) return "Linked"; if (localReference) return "Local"; return "Stored"; }
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)); }
function readFile(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }); }
function searchable(item: Item) { return [item.title, item.description, item.tags.join(" "), item.sourceUrl, item.metadata.markdown, item.metadata.url, item.metadata.platform, item.metadata.year, item.metadata.tmdbId, item.metadata.name, item.metadata.size, item.metadata.price, item.metadata.currency, item.metadata.fileName, item.metadata.derived?.summary, ...Object.entries(item.metadata.derived?.attributes ?? {}).flatMap(([name, value]) => [name, Array.isArray(value) ? value.join(" ") : value]), ...(item.metadata.measurements ?? []).flatMap((measurement) => [measurement.name, measurement.value, measurement.unit])].join(" ").toLowerCase(); }
function latestJob(jobs: ProcessingJob[], itemId: string) { return jobs.filter((job) => job.itemId === itemId).sort((a, b) => b.inputRevision - a.inputRevision || b.createdAt.localeCompare(a.createdAt))[0]; }
