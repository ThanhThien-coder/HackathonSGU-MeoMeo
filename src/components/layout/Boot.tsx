"use client";

import { useEffect } from "react";
import { enableFixtureModeFromUrl, FIXTURE_SESSION_ID, useWorkbenchStore } from "@/store/workbench";

const resumeTried = new Set<string>();
let startup: Promise<void> | null = null;

const urlParam = (name: string) => new URLSearchParams(window.location.search).get(name);

/**
 * Khởi động đúng 1 lần cho cả app (docs/spec/30_UI.md Mục 7.2): fixture / Offline ⇒ dừng,
 * ngược lại `loadMe()` đúng 1 lần rồi `loadSessions()`. Chủ đề đã được `theme-script.ts` nạp trước khi vẽ.
 * Phím `Ctrl+Shift+D` gắn ở PH-12.
 */
function startOnce(): Promise<void> {
  startup ??= (async () => {
    const store = useWorkbenchStore.getState();
    // Mở lại `/learn?session=fixture-shop-api` (tải lại trang) vẫn là fixture.
    const fixture = enableFixtureModeFromUrl() || urlParam("session") === FIXTURE_SESSION_ID;
    if (fixture) {
      useWorkbenchStore.setState((s) => ({ ui: { ...s.ui, fixture: true } }));
      return;
    }
    if (urlParam("offline") === "1") {
      store.setOfflineMode(true);
      return;
    }
    const me = await store.loadMe();
    if (me.ok) await store.loadSessions();
  })();
  return startup;
}

/**
 * `/learn?session={id}` (hoặc `/learn?fixture=1`) khi store chưa có phiên ⇒
 * `POST /api/ingest { session_id }`, mỗi id thử 1 lần.
 */
async function openSessionFromUrl(): Promise<void> {
  if (!window.location.pathname.startsWith("/learn")) return;
  const first = useWorkbenchStore.getState();
  const id = urlParam("session") ?? (first.ui.fixture ? FIXTURE_SESSION_ID : null);
  if (!id || resumeTried.has(id)) return;
  resumeTried.add(id); // đánh dấu ngay để StrictMode không gửi 2 lần

  const { ui, session_id, is_offline_mode, ingest } = useWorkbenchStore.getState();
  // Đã có phiên, Offline, hoặc chưa đăng nhập (`LearnShell` hiện màn hình đăng nhập) ⇒ không gửi request.
  if (session_id === id || is_offline_mode || (!ui.fixture && ui.auth !== "SIGNED_IN")) {
    resumeTried.delete(id);
    return;
  }

  const res = await ingest({ session_id: id });
  if (!res.ok && res.code === "ERR_SESSION_NOT_FOUND") {
    try {
      window.localStorage.removeItem("sf.last_session");
    } catch {
      // localStorage bị chặn: bỏ qua.
    }
  }
}

export function Boot() {
  useEffect(() => {
    void startOnce().then(openSessionFromUrl);
  }, []);
  return null;
}
