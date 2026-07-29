// ============================================================
// content.js — 监听 schedule 页面的 postMessage，转发给扩展后台
// ============================================================
console.log("[👻 content] 已注入到页面，等待 REMINDER_RUN 消息...");

window.addEventListener("message", (e) => {
  if (e.data?.type === "REMINDER_RUN") {
    console.log("[👻 content] 收到消息:", e.data.task);
    try {
      chrome.runtime.sendMessage({ action: "run-done", task: e.data.task }, (response) => {
        console.log("[👻 content] 扩展后台响应:", response);
      });
    } catch (err) {
      console.error("[👻 content] 发送失败:", err);
    }
  }
});
