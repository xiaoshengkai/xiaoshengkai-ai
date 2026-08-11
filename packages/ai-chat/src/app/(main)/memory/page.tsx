
"use client";

import { BASE } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface ChunkRow {
  id: string;
  content: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: number | null;
  charCount: number | null;
  source: string | null;
  deleted: boolean;
  deletedAt: number | null;
}

interface ChunkDetail extends ChunkRow {
  vectorPreview: number[];
  totalDimensions: number;
}

interface ListResult {
  chunks: ChunkRow[];
}

interface SearchResultItem {
  id: string;
  content: string;
  similarity: number;
  metadata: Record<string, string | number | boolean | null>;
}

interface SearchResult {
  query: string;
  topK: number;
  results: SearchResultItem[];
  embeddingDims: number;
}

const API_BASE = `${BASE}/api/admin/chroma`;
const CONTENT_PREVIEW_LEN = 80;

function relativeTime(epochMs: number | null): string {
  if (epochMs === null) return "—";
  return new Date(epochMs).toLocaleString("zh-CN");
}

function truncate(s: string, len: number = CONTENT_PREVIEW_LEN): string {
  if (s.length <= len) return s;
  return s.slice(0, len) + "…";
}

async function fetchApi<T>(
  url: string,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, init);
    const json = await res.json();
    if (json.ok) return { ok: true, data: json.data as T };
    return { ok: false, error: json.error ?? "未知错误" };
  } catch (e) {
    return { ok: false, error: `网络错误: ${(e as Error).message}` };
  }
}

export default function MemoryLibraryPage() {
  const [database, setDatabase] = useState("shared");
  const [collection, setCollection] = useState("base_knowledge");
  const [codeCollections, setCodeCollections] = useState<string[]>([]);
  const [chatCollections, setChatCollections] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [compacting, setCompacting] = useState(false);

  const [chunks, setChunks] = useState<ChunkRow[]>([]);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [detail, setDetail] = useState<ChunkDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    if (database !== "chat" && database !== "code") return;
    void (async () => {
      const res = await fetchApi<{ collections: string[] }>(
        `${API_BASE}?action=collections&database=${database}`,
      );
      if (res.ok) {
        if (database === "chat") setChatCollections(res.data.collections);
        else setCodeCollections(res.data.collections);
      }
    })();
  }, [database, collection]);

  const reloadList = useCallback(async () => {
    if (!collection) return;
    setListLoading(true);
    setListError(null);
    setSearchResult(null);

    const params = new URLSearchParams({
      action: "list",
      includeDeleted: String(includeDeleted),
      database,
      collection,
    });
    const res = await fetchApi<ListResult>(`${API_BASE}?${params}`);
    setListLoading(false);

    if (res.ok) {
      setChunks(res.data.chunks);
    } else {
      setListError(res.error);
    }
  }, [includeDeleted, database, collection]);

  useEffect(() => {
    void (async () => {
      await reloadList();
    })();
  }, [reloadList]);

  const doCompact = async () => {
    setCompacting(true);
    const res = await fetchApi<{ before: number; removed: number; after: number }>(`${API_BASE}?action=compact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ database, collection }),
    });
    setCompacting(false);
    if (res.ok) {
      setConfirmOpen(false);
      toast(`整理完成：删除 ${res.data.removed} 条，剩余 ${res.data.after} 条`);
      void reloadList();
    } else {
      toast.error(`整理失败：${res.error}`);
    }
  };

  const doDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setDeleting(true);
    const res = await fetchApi<{ deleted: number }>(`${API_BASE}?action=delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ database, collection, ids }),
    });
    setDeleting(false);
    if (res.ok) {
      setSelected(new Set());
      setSearchResult(null);
      void reloadList();
    } else {
      alert(`删除失败: ${res.error}`);
    }
    setDeleteDialogOpen(false);
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const current = chunks.map((c) => c.id);
    if (current.every((id) => selected.has(id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(current));
    }
  };

  const doSearch = async () => {
    const q = searchInput.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    setSearchResult(null);

    const res = await fetchApi<SearchResult>(`${API_BASE}?action=search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q, database, collection }),
    });
    setSearching(false);

    if (res.ok) {
      setSearchResult(res.data);
    } else {
      setSearchError(res.error);
    }
  };

  const openDetail = async (id: string) => {
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);

    const res = await fetchApi<ChunkDetail>(
      `${API_BASE}?action=show&id=${encodeURIComponent(id)}&database=${database}&collection=${collection}`,
    );
    setDetailLoading(false);

    if (res.ok) {
      setDetail(res.data);
    } else {
      setDetailError(res.error);
    }
  };

  const closeDetail = () => {
    setDetail(null);
    setDetailError(null);
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold font-[family-name:var(--font-pixel)]">
            记忆库
          </h1>
        </div>

        {/* 数据库/collection 选择器 */}
        <div className="mb-6 flex gap-4">
          <select
            value={database}
            onChange={(e) => {
              const db = e.target.value;
              setDatabase(db);
              setChunks([]);
              setSearchInput("");
              setSearchResult(null);
              setSelected(new Set());
              if (db === "shared") setCollection("base_knowledge");
              else if (db === "chat") setCollection(chatCollections[0] || "chat_knowledge");
              else setCollection("");
            }}
            className="px-3 py-1.5 text-sm border rounded bg-background font-[family-name:var(--font-pixel)]"
          >
            <option value="shared">shared (主库)</option>
            <option value="chat">chat (聊天库)</option>
            <option value="code">code (编码库)</option>
          </select>
          <select
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
            className="px-3 py-1.5 text-sm border rounded bg-background font-[family-name:var(--font-pixel)]"
          >
            {database === "code"
              ? (codeCollections.length > 0
                ? codeCollections.map((c) => <option key={c} value={c}>{c}</option>)
                : <option value="">暂无</option>)
              : database === "chat"
                ? (chatCollections.length > 0
                  ? chatCollections.map((c) => <option key={c} value={c}>{c}</option>)
                  : <option value="chat_knowledge">chat_knowledge</option>)
                : <option value="base_knowledge">base_knowledge</option>
            }
          </select>
        </div>

        {/* 搜索框 */}
        <div className="mb-6 p-4 bg-card rounded-lg shadow-sm border">
          <div className="flex gap-2">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void doSearch();
              }}
              placeholder="输入查询（调智谱 embedding-3 → cosine Top-10）"
              className="flex-1 px-3 py-2 border rounded bg-background text-sm font-[family-name:var(--font-pixel)] focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={searching}
            />
            <button
              onClick={() => { if (searchInput.trim()) { void doSearch(); } else { void reloadList(); } }}
              disabled={searching}
              className="px-5 py-2 text-sm text-white font-[family-name:var(--font-pixel)] cursor-pointer"
              style={{ background: "var(--primary)", border: "3px solid var(--primary)", boxShadow: "3px 0 0 0 var(--primary), 0 3px 0 0 var(--primary), 3px 3px 0 0 var(--primary)" }}
            >
              {searching ? "搜索中…" : "搜索"}
            </button>

            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <AlertDialogTrigger
                className="px-5 py-2 text-sm text-white font-[family-name:var(--font-pixel)]"
                style={{ background: "var(--pixel-red)", border: "3px solid var(--pixel-red)", boxShadow: "3px 0 0 0 var(--pixel-red-dark), 0 3px 0 0 var(--pixel-red-dark), 3px 3px 0 0 var(--pixel-red-dark)" }}
              >
                整理数据
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认整理数据</AlertDialogTitle>
                  <AlertDialogDescription>
                    整理 {database}/{collection}：删除重复内容，过滤低质量数据。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void doCompact()} disabled={compacting}>
                    {compacting ? "整理中…" : "确认整理"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
          {searchError && (
            <div className="mt-2 text-sm text-destructive">
              搜索失败：{searchError}
            </div>
          )}
          {searchResult && (
            <div className="mt-2 text-xs text-muted-foreground">
              {searchResult.results.length} 条结果 · 向量维度 {searchResult.embeddingDims}
            </div>
          )}
        </div>

        {/* 列表 */}
        <div className="bg-card rounded-lg shadow-sm border">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground font-[family-name:var(--font-pixel)]">
                {listLoading && chunks.length === 0 ? "加载中…" : searchResult ? `共 ${searchResult.results.length} 条结果` : `共 ${chunks.length} 条`}
              </span>
              {selected.size > 0 && (
                <>
                  <span className="text-xs text-destructive">已选 {selected.size} 条</span>
                  <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                    <AlertDialogTrigger
                      className="px-2 py-0.5 text-xs text-white font-[family-name:var(--font-pixel)] cursor-pointer"
                      style={{ background: "var(--pixel-red)", border: "3px solid var(--pixel-red)", boxShadow: "3px 0 0 0 var(--pixel-red-dark), 0 3px 0 0 var(--pixel-red-dark), 3px 3px 0 0 var(--pixel-red-dark)" }}
                    >
                      批量删除
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>确认批量删除</AlertDialogTitle>
                        <AlertDialogDescription>
                          将删除选中的 {selected.size} 条记录。此操作不可撤销。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void doDelete()} disabled={deleting}>
                          {deleting ? "删除中…" : "确认删除"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              )}
            </div>
            <div>
              {searchResult ? (
                <button
                  onClick={() => { setSearchResult(null); setSearchInput(""); void reloadList(); }}
                  className="pixel-btn-ghost px-2 py-0.5 text-xs"
                >
                  清除搜索
                </button>
              ) : (
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer font-[family-name:var(--font-pixel)]">
                  <input
                    type="checkbox"
                    checked={includeDeleted}
                    onChange={(e) => setIncludeDeleted(e.target.checked)}
                    className="rounded"
                  />
                  含软删
                </label>
              )}
            </div>
          </div>

          {listError && (
            <div className="p-4 text-destructive text-sm">
              列表加载失败：{listError}
            </div>
          )}

          <div className="grid grid-cols-[30px_1fr_6fr_2fr_1fr_1fr] px-4 py-2 bg-muted text-xs font-medium text-muted-foreground font-[family-name:var(--font-pixel)]">
            <input
              type="checkbox"
              checked={chunks.length > 0 && chunks.every((c) => selected.has(c.id))}
              onChange={toggleSelectAll}
              className="size-4"
            />
            <div>ID</div>
            <div>Content</div>
            <div>Source</div>
            <div>创建时间</div>
            <div className="text-right">长度</div>
          </div>

          <Virtuoso
            style={{ height: "60vh" }}
            data={(searchResult ? searchResult.results : chunks) as ChunkRow[]}
            itemContent={(_, item) => {
              if (searchResult) {
                const r = item as unknown as SearchResultItem;
                return (
                  <div
                    onClick={() => openDetail(r.id)}
                    className="grid grid-cols-[30px_1fr_6fr_2fr_1fr_1fr] px-4 py-2 hover:bg-muted cursor-pointer text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggleSelect(r.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="size-4"
                    />
                    <div className="font-mono text-xs text-muted-foreground truncate">{r.id.slice(0, 12)}</div>
                    <div className="text-foreground truncate">{truncate(r.content)}</div>
                    <div className="text-xs text-muted-foreground">{(r.metadata.source as string) ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{typeof r.metadata.createdAt === "number" ? new Date(r.metadata.createdAt).toLocaleString("zh-CN") : "—"}</div>
                    <div className="text-right text-xs text-muted-foreground">{(r.content ?? "").length}</div>
                  </div>
                );
              }
              const c = item as ChunkRow;
              return (
                <RowItem
                  chunk={c}
                  onClick={() => openDetail(c.id)}
                  isSelected={selected.has(c.id)}
                  onToggle={() => toggleSelect(c.id)}
                />
              );
            }}
            components={{
              EmptyPlaceholder: () => (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  {searchResult ? "无匹配结果" : listLoading ? "加载中…" : "collection 为空"}
                </div>
              ),
            }}
          />

          {!searchResult && !listLoading && chunks.length === 0 && !listError && (
            <div className="p-8 text-center text-muted-foreground text-sm">
              collection 为空，或所有记录都被软删且未勾选含软删
            </div>
          )}
        </div>
      </div>

      {detail !== null || detailLoading || detailError !== null ? (
        <DetailDrawer
          detail={detail}
          loading={detailLoading}
          error={detailError}
          onClose={closeDetail}
        />
      ) : null}
    </div>
  );
}

function RowItem({
  chunk,
  onClick,
  isSelected,
  onToggle,
}: {
  chunk: ChunkRow;
  onClick: () => void;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const isDeleted = chunk.deleted;
  return (
    <div className={`grid grid-cols-[30px_1fr_6fr_2fr_1fr_1fr] px-4 py-2 hover:bg-muted text-sm ${isDeleted ? "opacity-50 line-through" : ""}`}>
      <input
        type="checkbox"
        checked={isSelected}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        className="size-4"
      />
      <div onClick={onClick} className="cursor-pointer font-mono text-xs text-muted-foreground truncate">
        {chunk.id.slice(0, 12)}
        {isDeleted && (
          <span className="ml-1 text-amber-600 dark:text-amber-400" title="软删中">
            🗑
          </span>
        )}
      </div>
      <div onClick={onClick} className="cursor-pointer text-foreground truncate">
        {truncate(chunk.content)}
      </div>
      <div onClick={onClick} className="cursor-pointer text-xs text-muted-foreground">
        {chunk.source ?? "—"}
      </div>
      <div onClick={onClick} className="cursor-pointer text-xs text-muted-foreground" title={chunk.createdAt ? new Date(chunk.createdAt).toISOString() : ""}>
        {relativeTime(chunk.createdAt)}
      </div>
      <div onClick={onClick} className="cursor-pointer text-right text-xs text-muted-foreground">
        {chunk.charCount ?? chunk.content.length}
      </div>
    </div>
  );
}

function DetailDrawer({
  detail,
  loading,
  error,
  onClose,
}: {
  detail: ChunkDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/30 z-40"
        aria-hidden="true"
      />
      <div className="fixed top-0 right-0 h-full w-full md:w-2/3 lg:w-1/2 bg-white dark:bg-gray-900 shadow-xl z-50 overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold font-[family-name:var(--font-pixel)]">
            Chunk 详情
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-2xl leading-none"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="p-6">
          {loading && (
            <div className="text-muted-foreground text-sm">加载中…</div>
          )}

          {error && (
            <div className="p-4 bg-destructive/10 text-destructive rounded">
              {error}
            </div>
          )}

          {detail && (
            <div className="space-y-6">
              <div>
                <Label>ID</Label>
                <div className="font-mono text-sm break-all">
                  {detail.id}
                  {detail.deleted && (
                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                      软删中
                    </span>
                  )}
                </div>
              </div>

              <div>
                <Label>Content ({detail.content.length} 字)</Label>
                <pre className="mt-1 p-4 bg-muted border rounded text-sm whitespace-pre-wrap break-words font-mono">
                  {detail.content}
                </pre>
              </div>

              <div>
                <Label>Metadata</Label>
                <table className="mt-1 w-full text-sm border rounded overflow-hidden">
                  <tbody className="divide-y">
                    {Object.entries(detail.metadata).map(([k, v]) => (
                      <tr key={k}>
                        <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground bg-muted w-1/3">
                          {k}
                        </td>
                        <td className="px-3 py-1.5 break-all">
                          {typeof v === "number" && k === "createdAt" ? (
                            <span title={new Date(v).toISOString()}>
                              {relativeTime(v)} ({v})
                            </span>
                          ) : typeof v === "number" && k === "deletedAt" ? (
                            <span title={new Date(v).toISOString()}>
                              {relativeTime(v)} ({v})
                            </span>
                          ) : (
                            String(v)
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div>
                <Label>
                  向量预览（前 {detail.vectorPreview.length} 维 / 总 {detail.totalDimensions} 维）
                </Label>
                <div className="mt-1 p-3 bg-muted border rounded font-mono text-xs break-all">
                  [{detail.vectorPreview.map((n) => n.toFixed(4)).join(", ")}
                  {detail.totalDimensions > detail.vectorPreview.length ? ", …" : ""}
                  ]
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
      {children}
    </div>
  );
}