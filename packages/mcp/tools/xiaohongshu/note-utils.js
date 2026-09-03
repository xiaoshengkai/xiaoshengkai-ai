const CURIOSITY_MARKERS = /\d|亏|损失|风险|反常识|为什么|到底|真相|竟然|悬念|后果/;
const VAGUE_MARKERS = /讲透|解析|科普|攻略|揭秘|震惊|所有人都被骗/;

export function selectCandidate(candidates = []) {
  return candidates
    .filter((candidate) => candidate?.title && candidate?.promise)
    .map((candidate) => ({
      ...candidate,
      score: (CURIOSITY_MARKERS.test(candidate.title) ? 3 : 0)
        + (VAGUE_MARKERS.test(candidate.title) ? -3 : 0)
        + (candidate.promise.length >= 8 ? 1 : 0)
        + (candidate.coverText?.length >= 4 && candidate.coverText.length <= 10 ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score)[0] || null;
}

export function contentToMarkdown(content = [], images = []) {
  return content.map((segment) => {
    const match = /^\[IMG-(\d+)\]$/.exec(segment);
    if (!match) return segment;
    const image = images[Number(match[1])];
    return image?.url
      ? `![插图](./images/${image.type === "cover" ? "cover" : `illustration-${image.index}`}.jpg)`
      : "_[插图生成失败]_";
  }).join("\n\n");
}

export function updateImageState(state, index, patch) {
  const latest = structuredClone(state);
  latest.images[index] = { ...latest.images[index], ...patch };
  return latest;
}

export function summarizeImages(images = []) {
  const failedImages = images.filter((image) => image.status === "failed").map(({ index, error }) => ({ index, error }));
  return {
    readyCount: images.filter((image) => image.status === "done").length,
    failedCount: failedImages.length,
    totalCount: images.length,
    failedImages,
  };
}
