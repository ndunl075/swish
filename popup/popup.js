const defaults = { enabled: true, sound: true };
const countEl = document.getElementById('count');

chrome.storage.sync.get(defaults, (settings) => {
  for (const key of Object.keys(defaults)) {
    const box = document.getElementById(key);
    box.checked = settings[key];
    box.addEventListener('change', () => chrome.storage.sync.set({ [key]: box.checked }));
  }
});

chrome.storage.local.get({ swishCount: 0 }, ({ swishCount }) => {
  countEl.textContent = swishCount;
});

document.getElementById('reset').addEventListener('click', () => {
  chrome.storage.local.set({ swishCount: 0 });
  countEl.textContent = 0;
});
