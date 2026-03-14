const toggle = document.getElementById("enabledToggle");

async function load() {
  const { enabled } = await chrome.storage.sync.get({ enabled: true });
  toggle.checked = enabled;
}

toggle.addEventListener("change", async () => {
  await chrome.storage.sync.set({ enabled: toggle.checked });
});

load();
