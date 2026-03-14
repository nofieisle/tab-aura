const BADGE = "🟥 ";

// content script でドキュメントの title を直接書き換える
async function markTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (badge) => {
        if (!document.title.startsWith(badge)) {
          document.__tabAuraOriginalTitle = document.title;
          document.title = badge + document.title;
        }

        // タイトル変更の監視を開始し、SPA等でタイトルが変わってもバッジを維持する
        if (!document.__tabAuraTitleObserver) {
          document.__tabAuraTitleObserver = new MutationObserver(() => {
            if (document.__tabAuraMarked && !document.title.startsWith(badge)) {
              document.__tabAuraOriginalTitle = document.title;
              document.title = badge + document.title;
            }
          });
          const titleEl = document.querySelector("title");
          if (titleEl) {
            document.__tabAuraTitleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
          }
        }
        document.__tabAuraMarked = true;
      },
      args: [BADGE],
      world: "MAIN",
    });
  } catch {}
}

async function unmarkTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (badge) => {
        document.__tabAuraMarked = false;
        if (document.__tabAuraTitleObserver) {
          document.__tabAuraTitleObserver.disconnect();
          delete document.__tabAuraTitleObserver;
        }
        if (document.title.startsWith(badge)) {
          document.title = document.__tabAuraOriginalTitle ?? document.title.slice(badge.length);
        }
        delete document.__tabAuraOriginalTitle;
      },
      args: [BADGE],
      world: "MAIN",
    });
  } catch {}
}

async function isEnabled() {
  const { enabled } = await chrome.storage.sync.get({ enabled: true });
  return enabled;
}

// 現在のウィンドウのタブ数を取得する
async function getTabCount() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs.length;
}

// スクリプト注入が可能な通常のWebページかどうかを判定する
async function isScriptableTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.url && /^https?:\/\//.test(tab.url);
  } catch {
    return false;
  }
}

async function handleActivation(tabId) {
  const enabled = await isEnabled();
  const { prevTabId } = await chrome.storage.session.get("prevTabId");

  if (prevTabId && prevTabId !== tabId) {
    await unmarkTab(prevTabId);
  }

  // タブが1つしかない場合、または特殊ページにはバッジをつけない
  const tabCount = await getTabCount();
  const scriptable = await isScriptableTab(tabId);
  if (enabled && tabCount > 1 && scriptable) {
    await markTab(tabId);
  } else if (enabled && tabCount <= 1) {
    await unmarkTab(tabId);
  }

  await chrome.storage.session.set({ prevTabId: tabId });
}

chrome.tabs.onActivated.addListener(({ tabId }) => handleActivation(tabId));

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab || activeTab.id !== tabId) return;
  if (!await isScriptableTab(tabId)) return;
  const tabCount = await getTabCount();
  if (await isEnabled() && tabCount > 1) {
    await markTab(tabId);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { prevTabId } = await chrome.storage.session.get("prevTabId");
  if (prevTabId === tabId) await chrome.storage.session.remove("prevTabId");

  // タブが閉じられて1つだけになったら、残ったアクティブタブのバッジを消す
  const tabCount = await getTabCount();
  if (tabCount <= 1) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      await unmarkTab(activeTab.id);
    }
  }
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "sync") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const tabCount = await getTabCount();
  if (await isEnabled() && tabCount > 1 && await isScriptableTab(tab.id)) {
    await markTab(tab.id);
  } else {
    await unmarkTab(tab.id);
  }
});
