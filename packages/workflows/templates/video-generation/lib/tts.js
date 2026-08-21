import { generateTTS as sharedGenerateTTS } from "@app/shared/llm/index.js";

export async function generateTTS(text, voiceId, workDir, enableTts) {
  console.log(`[tts] enableTts="${enableTts}"`);
  if (enableTts === "no") {
    console.log("[tts] skipped by engine");
    return { output: "TTS disabled" };
  }
  const startTime = Date.now();
  console.log(`[tts] 开始 (${text.length} 字)`);
  const { path } = await sharedGenerateTTS({ text, voiceId, outputPath: `${workDir}/narration.mp3` });
  console.log(`[tts] 完成 (${((Date.now() - startTime) / 1000).toFixed(1)}s elapsed)`);
  return path;
}
