"use client";

import { useId, useRef, useState } from "react";
import { splitTags } from "@/lib/types";

export function TagInput({ options, defaultValue = [] }: { options: string[]; defaultValue?: string[] }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [tags, setTags] = useState(defaultValue);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const available = [...new Set(options)].sort();
  const normalize = (value: string) => available.find((tag) => tag.toLowerCase() === value.toLowerCase()) ?? value;
  const merge = (values: string[]) => [...tags, ...values.map(normalize)].filter((tag, index, all) => all.findIndex((value) => value.toLowerCase() === tag.toLowerCase()) === index);
  const suggestions = available.filter((tag) => !tags.some((selected) => selected.toLowerCase() === tag.toLowerCase()) && tag.toLowerCase().includes(query.trim().toLowerCase()));
  const choices = [...suggestions];
  const newTag = query.trim();
  if (newTag && !available.some((tag) => tag.toLowerCase() === newTag.toLowerCase()) && !tags.some((tag) => tag.toLowerCase() === newTag.toLowerCase())) choices.push(newTag);
  const expanded = open && choices.length > 0;

  function add(value: string) {
    setTags(merge(splitTags(value)));
    setQuery("");
    setActive(-1);
  }

  return <div className="tag-field" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) { add(query); setOpen(false); }
  }}>
    <label htmlFor={id}>Tags</label>
    <input type="hidden" name="tags" value={merge(splitTags(query)).join(", ")} />
    <div className="tag-control">
      {tags.map((tag) => <span className="tag-chip" key={tag}>{tag}<button type="button" aria-label={`Remove tag ${tag}`} onClick={() => { setTags(tags.filter((value) => value !== tag)); input.current?.focus(); }}>×</button></span>)}
      <input id={id} ref={input} role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? `${id}-options` : undefined} aria-activedescendant={expanded && active >= 0 && active < choices.length ? `${id}-option-${active}` : undefined} aria-describedby={`${id}-help`} autoComplete="off" placeholder="Add a tag…" value={query}
        onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setActive(-1); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); setOpen(true);
            setActive(choices.length ? (active + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length : -1);
          } else if (event.key === "Enter" || event.key === ",") {
            event.preventDefault(); add(expanded && active >= 0 ? choices[active] ?? query : query);
          } else if (event.key === "Escape") { event.preventDefault(); setOpen(false); setActive(-1); }
          else if (event.key === "Backspace" && !query) setTags(tags.slice(0, -1));
        }} />
    </div>
    {expanded && <ul className="tag-options" id={`${id}-options`} role="listbox" aria-label="Tag suggestions">
      {choices.map((tag, index) => <li key={tag} id={`${id}-option-${index}`} role="option" aria-selected={active === index} onMouseDown={(event) => event.preventDefault()} onClick={() => { add(tag); input.current?.focus(); }}>
        {suggestions.includes(tag) ? tag : `Add “${tag}”`}
      </li>)}
    </ul>}
    <small id={`${id}-help`}>Choose a suggestion or type a new tag and press Enter.</small>
  </div>;
}
