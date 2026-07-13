"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { Download } from "lucide-react";

interface NoteImage {
  index: number;
  type: "cover" | "illustration";
  prompt: string;
  url: string | null;
  status: string;
}

interface NoteData {
  taskId: string;
  status: string;
  title: string;
  content: string[];
  tags: string[];
  images: NoteImage[];
}

export default function NotePreviewPage() {
  const params = useParams();
  const taskId = params.taskId as string;
  const [note, setNote] = useState<NoteData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/note/${taskId}/status`)
      .then((r) => r.json())
      .then((data) => {
        setNote(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [taskId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-gray-400">加载中...</div>
      </div>
    );
  }

  if (!note) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-gray-400">笔记不存在或已过期</div>
      </div>
    );
  }

  const cover = note.images?.[0];
  const illustrations = note.images?.filter((img) => img.type === "illustration") || [];

  return (
    <div className="min-h-screen bg-white" style={{ height: "100dvh", overflow: "auto" }}>
      <div className="max-w-[600px] mx-auto">
        {cover?.url ? (
          <img src={cover.url} alt={note.title} className="w-full" style={{ aspectRatio: "3/4", objectFit: "cover" }} />
        ) : (
          <div className="w-full bg-gray-100 flex items-center justify-center text-gray-400" style={{ aspectRatio: "3/4" }}>
            封面生成中...
          </div>
        )}

        <div className="px-5 pt-4 pb-5">
          <h1 className="text-xl font-bold text-gray-900 leading-snug">{note.title}</h1>

          <div className="flex flex-wrap gap-2 mt-3">
            {note.tags?.map((tag) => (
              <span key={tag} className="text-sm text-[#ff2442]">{tag}</span>
            ))}
          </div>

          <div className="mt-4 text-[15px] leading-relaxed text-gray-800 space-y-3">
            {note.content?.map((seg, i) => {
              const match = seg.match(/^\[插图-(\d+)\]$/);
              if (match) {
                const img = illustrations[parseInt(match[1], 10) - 1];
                if (img?.url) {
                  return <img key={i} src={img.url} alt="插画" className="w-full rounded-lg my-4" />;
                }
                return (
                  <div key={i} className="h-48 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 text-sm my-4">
                    插画生成中...
                  </div>
                );
              }
              return (
              <div key={i} className="prose prose-sm max-w-none [&_h3]:text-lg [&_h3]:font-bold [&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:border-l-4 [&_h3]:border-red-400 [&_h3]:pl-3 [&_h3]:text-red-600 [&_blockquote]:border-l-4 [&_blockquote]:border-orange-300 [&_blockquote]:bg-orange-50 [&_blockquote]:pl-4 [&_blockquote]:py-2 [&_blockquote]:my-2 [&_blockquote]:rounded-r [&_blockquote]:text-orange-800 [&_blockquote]:not-italic [&_strong]:text-gray-900 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                  {seg}
                </ReactMarkdown>
              </div>
            );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}