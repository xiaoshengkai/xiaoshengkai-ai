// ============================================================
// 开盛每日提醒 — Chrome 扩展后台
// 功能：Chrome alarms + notifications 双时段提醒
// 数据：chrome.storage.local 记录每日完成状态
// ============================================================

const processedKeys = new Set();

// ============================================================
// 1. 注册后台定时器
// ============================================================
// 每分钟检查一次（实际逻辑按时间窗触发）
chrome.alarms.create("tick", {
  periodInMinutes: 1
});

// 启动后立即检查一次
chrome.alarms.create("tick-now", {
  delayInMinutes: 0.1
});

// ============================================================
// 2. 检查时间 → 弹通知
// ============================================================
function checkAndNotify() {
  const now = new Date();
  const hour = now.getHours();
  const min = now.getMinutes();
  const today = `${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}`;

  // ---- 10:00 学习提醒 ----
  if (hour === 10 && min < 3) {
    const key = `learn-${today}`;
    if (!processedKeys.has(key)) {
      processedKeys.add(key);
      chrome.notifications.create(`learn-${today}`, {
        type: "basic",
        iconUrl: "icon.png",
        title: "👻 开盛！10 点了！",
        message: "摸鱼时间结束！现在、立刻、马上开始学习！\n📘 今日课程：从金融地图 v3.1 继续推进\n你不动，我就一直盯着你 👁",
        priority: 2,
        buttons: [
          { title: "✅ 开始学！" },
          { title: "⏳ 5 分钟后提醒" }
        ]});
    }
  }

  // ---- 17:30 复盘提醒 ----
  if (hour === 17 && min >= 30 && min < 33) {
    const key = `check-${today}`;
    if (!processedKeys.has(key)) {
      processedKeys.add(key);

      // 查今天的学习状态
      chrome.storage.local.get([`status-${today}`], (result) => {
        const status = result[`status-${today}`] || { learned: false, checked: false };
        const msg = status.learned
          ? "今天学了！来确认一下完成度吧~"
          : "今天还没开始学？别拖了！！";

        chrome.notifications.create(`check-${today}`, {
          type: "basic",
          iconUrl: "icon.png",
          title: "👻 开盛！5 点半了！",
          message: msg + "\n今日课程：金融地图 v3.1\n点✅告诉我你做完了！",
          priority: 2,
          buttons: [
            { title: "✅ 做完了！" },
            { title: "⏳ 还没，再等等" }
          ]});
      });
    }
  }
}

// ============================================================
// 3. alarm 触发
// ============================================================
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "tick" || alarm.name === "tick-now") {
    checkAndNotify();
  }
});

// ============================================================
// 4. 通知按钮点击
// ============================================================
chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  const today = new Date();
  const dateKey = `${today.getFullYear()}-${today.getMonth()+1}-${today.getDate()}`;

  chrome.storage.local.get([`status-${dateKey}`], (result) => {
    const status = result[`status-${dateKey}`] || { learned: false, checked: false };

    if (notificationId.startsWith("learn-") || notificationId.startsWith("manual-")) {
      // 10:00 或手动触发的学习提醒按钮
      if (buttonIndex === 0) {
        // ✅ 开始学
        status.learned = true;
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icon.png",
          title: "💪 冲！",
          message: "认真学！学完记得 17:30 来汇报！",
          priority: 1
        });
      } else {
        // ⏳ 5 分钟后
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icon.png",
          title: "👻 我就再等你 5 分钟",
          message: "5 分钟后我再提醒你！跑不掉的！",
          priority: 1
        });
        setTimeout(() => {
          chrome.notifications.create(`learn-${dateKey}-retry`, {
            type: "basic",
            iconUrl: "icon.png",
            title: "👻 5 分钟到了！",
            message: "别找借口了，现在开始学！",
            priority: 2});
        }, 5 * 60 * 1000);
      }
    } else if (notificationId.startsWith("check-")) {
      // 17:30 复盘提醒的按钮
      if (buttonIndex === 0) {
        // ✅ 做完了
        status.checked = true;
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icon.png",
          title: "🎉 好样的！",
          message: "今天的金融学习任务完成！明天 10:00 继续~",
          priority: 1
        });
      } else {
        // 还没
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icon.png",
          title: "👻 别拖了！",
          message: "今天的事今天毕，快去学！",
          priority: 1
        });
      }
    }

    // 存回 storage
    chrome.storage.local.set({ [`status-${dateKey}`]: status });
  });

  chrome.notifications.clear(notificationId);
});

console.log("[👻 开盛提醒] 扩展已加载");

// ============================================================
// 5. 监听 schedule 页面的"立即执行"消息 → 弹通知
// ============================================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.action === "run-done") {
    const now = new Date();
    const id = `manual-${msg.task}-${Date.now()}`;
    console.log("[👻 bg] 收到消息，准备弹通知:", id);

    if (msg.task === "daily-reminder-am") {
      chrome.notifications.create(id, {
        type: "basic",
        iconUrl: "icon.png",
        title: "👻 开盛！学习时间到！",
        message: "摸鱼时间结束！现在、立刻、马上开始学习！\n📘 今日课程：从金融地图 v3.1 继续推进\n你不动，我就一直盯着你 👁",
        buttons: [
          { title: "✅ 开始学！" },
          { title: "⏳ 5 分钟后提醒" }
        ]
      }, (notificationId) => {
        const err = chrome.runtime.lastError;
        console.log("[👻 bg] 通知结果:", notificationId, err?.message || "OK");
        sendResponse({ ok: true, id: notificationId, error: err?.message || null });
      });

      return true;
    }
  }
});
