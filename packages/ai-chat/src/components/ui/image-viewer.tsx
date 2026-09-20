"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import Loading from "@/components/ui/loading";

interface ViewerCtx {
  register: (src: string) => number;
  open: (index: number) => void;
}

const Ctx = createContext<ViewerCtx>({ register: () => 0, open: () => {} });

export function useImageViewer() {
  return useContext(Ctx);
}

export function ImageViewerProvider({ children }: { children: ReactNode }) {
  const imagesRef = useRef<string[]>([]);
  const [index, setIndex] = useState(-1);
  const [imgState, setImgState] = useState<"loading" | "loaded" | "error">("loading");

  const register = useCallback((src: string) => {
    const idx = imagesRef.current.indexOf(src);
    if (idx >= 0) return idx;
    imagesRef.current.push(src);
    return imagesRef.current.length - 1;
  }, []);

  const open = useCallback((idx: number) => {
    setIndex(idx);
    setImgState("loading");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (index < 0) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index]);

  function close() {
    setIndex(-1);
  }

  function prev() {
    if (index > 0) {
      setIndex(index - 1);
      setImgState("loading");
    }
  }

  function next() {
    if (index < imagesRef.current.length - 1) {
      setIndex(index + 1);
      setImgState("loading");
    }
  }

  const total = imagesRef.current.length;
  const currentSrc = index >= 0 ? imagesRef.current[index] : null;

  return (
    <Ctx.Provider value={{ register, open }}>
      {children}

      {index >= 0 && currentSrc && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={close}
        >
          <button
            className="fixed top-4 right-4 brutal bg-card text-foreground px-3 py-1 font-bold cursor-pointer"
            onClick={close}
          >
            ✕
          </button>

          {total > 1 && (
            <>
              <button
                className="fixed left-4 top-1/2 -translate-y-1/2 brutal bg-card text-foreground px-3 py-2 text-xl cursor-pointer"
                onClick={e => { e.stopPropagation(); prev(); }}
              >
                ←
              </button>
              <button
                className="fixed right-4 top-1/2 -translate-y-1/2 brutal bg-card text-foreground px-3 py-2 text-xl cursor-pointer"
                onClick={e => { e.stopPropagation(); next(); }}
              >
                →
              </button>
              <div className="fixed bottom-6 left-1/2 -translate-x-1/2 text-white/60 text-sm font-mono">
                {index + 1} / {total}
              </div>
            </>
          )}

          {imgState === "loading" && (
            <div onClick={e => e.stopPropagation()}>
              <Loading text="图片加载中..." />
            </div>
          )}

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentSrc}
            alt=""
            className="max-w-[90vw] max-h-[90vh] object-contain border-2 shadow-sm"
            onClick={e => e.stopPropagation()}
            onLoad={() => setImgState("loaded")}
            onError={() => setImgState("error")}
            style={{ display: imgState === "loaded" ? "block" : "none" }}
          />

          {imgState === "error" && (
            <div onClick={e => e.stopPropagation()} className="brutal bg-card px-4 py-3 text-destructive font-mono">
              [图片加载失败]
            </div>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}