const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1";

function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function downloadSubtitles(taskId) {
  const apiKey = process.env.MINIMAX_API_KEY;
  const res = await fetch(`${MINIMAX_BASE_URL}/query/t2a_async_query_v2?task_id=${taskId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const result = await res.json();
  const fileId = result.file_id;
  if (!fileId) return [];

  const fileRes = await fetch(`${MINIMAX_BASE_URL}/files/retrieve?file_id=${fileId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const fileResult = await fileRes.json();
  const subtitleUrl = fileResult.file?.subtitle_url;
  if (!subtitleUrl) return [];

  const subtitleRes = await fetch(subtitleUrl);
  const text = await subtitleRes.text();
  return parseSubtitles(text);
}

export function parseSubtitles(text) {
  try {
    const json = JSON.parse(text);
    if (Array.isArray(json)) return json.map(s => ({ start: s.start || s.start_time, end: s.end || s.end_time, text: s.text || s.sentence }));
    if (json.sentences) return json.sentences.map(s => ({ start: s.start_time || s.start, end: s.end_time || s.end, text: s.text || s.sentence }));
  } catch {}

  const blocks = text.split(/\n\n+/).filter(b => b.trim());
  const subtitles = [];
  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 3) continue;
    const timeMatch = lines[1]?.match(/(\d+):(\d+):(\d+)[.,](\d+)\s*-->\s*(\d+):(\d+):(\d+)[.,](\d+)/);
    if (timeMatch) {
      const start = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]) + parseInt(timeMatch[4]) / 1000;
      const end = parseInt(timeMatch[5]) * 3600 + parseInt(timeMatch[6]) * 60 + parseInt(timeMatch[7]) + parseInt(timeMatch[8]) / 1000;
      subtitles.push({ start, end, text: lines.slice(2).join(" ") });
    }
  }
  return subtitles;
}

export function renderSubtitles(subtitles, totalDuration) {
  if (!subtitles || subtitles.length === 0) return "";
  return subtitles.map((s) => {
    const dur = ((s.end - s.start) || 2).toFixed(1);
    return `<div class="clip subtitle-layer" data-start="${s.start.toFixed(1)}" data-duration="${dur}">
  <span class="subtitle-text">${escHtml(s.text)}</span>
</div>`;
  }).join("\n");
}