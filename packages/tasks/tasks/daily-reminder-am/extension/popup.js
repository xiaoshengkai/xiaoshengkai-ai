// 加载今日状态
document.addEventListener("DOMContentLoaded", () => {
  const today = new Date();
  const dateKey = `${today.getFullYear()}-${today.getMonth()+1}-${today.getDate()}`;
  const storageKey = `tasks-${dateKey}`;

  chrome.storage.local.get([storageKey], (result) => {
    const data = result[storageKey] || { am: false, pm: false };
    
    document.getElementById("check-am").checked = data.am;
    document.getElementById("task-am").classList.toggle("done", data.am);
    
    document.getElementById("check-pm").checked = data.pm;
    document.getElementById("task-pm").classList.toggle("done", data.pm);

    // 最后汇报状态
    if (data.pm) {
      document.getElementById("lastReport").textContent = `✅ 今天已完成`;
    } else if (data.am) {
      document.getElementById("lastReport").textContent = `⏳ 已学习，待复盘`;
    } else {
      document.getElementById("lastReport").textContent = `❌ 今天还没开始`;
    }
  });

  // 勾选事件
  document.getElementById("check-am").addEventListener("change", (e) => {
    saveTask(storageKey, "am", e.target.checked);
  });

  document.getElementById("check-pm").addEventListener("change", (e) => {
    saveTask(storageKey, "pm", e.target.checked);
  });
});

function saveTask(storageKey, field, value) {
  chrome.storage.local.get([storageKey], (result) => {
    const data = result[storageKey] || { am: false, pm: false };
    data[field] = value;
    chrome.storage.local.set({ [storageKey]: data }, () => {
      // 刷新 UI
      document.getElementById(`task-${field}`).classList.toggle("done", value);
      
      if (field === "pm" && value) {
        document.getElementById("lastReport").textContent = "✅ 今天已完成";
      }
    });
  });
}
