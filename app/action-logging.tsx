"use client";

import { useEffect } from "react";

export function ActionLogging() {
  useEffect(() => {
    const send = (action: string, control?: string) => {
      void fetch("/api/events", {
        method: "POST", headers: { "content-type": "application/json" }, keepalive: true,
        body: JSON.stringify({ action, control, path: window.location.pathname }),
      }).catch(() => { /* Telemetry must not interrupt an interaction. */ });
    };
    const click = (event: MouseEvent) => {
      const control = event.target instanceof Element ? event.target.closest("button, a") : null;
      if (control) send("activate", (control.getAttribute("aria-label") || control.textContent || control.tagName).trim().slice(0, 120));
    };
    const change = (event: Event) => {
      const control = event.target;
      if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement) {
        if (control instanceof HTMLInputElement && control.type === "password") return;
        send("change", control.getAttribute("aria-label") || control.name || control.tagName.toLowerCase());
      }
    };
    const submit = () => send("submit");
    const drop = () => send("drop");
    const navigate = () => send("navigate");
    document.addEventListener("click", click, true);
    document.addEventListener("change", change, true);
    document.addEventListener("submit", submit, true);
    document.addEventListener("drop", drop, true);
    window.addEventListener("popstate", navigate);
    send("navigate");
    return () => {
      document.removeEventListener("click", click, true);
      document.removeEventListener("change", change, true);
      document.removeEventListener("submit", submit, true);
      document.removeEventListener("drop", drop, true);
      window.removeEventListener("popstate", navigate);
    };
  }, []);
  return null;
}
