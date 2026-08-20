const DEFAULT_LEXILO = "http://localhost:3000";
const field = document.getElementById("url");
const saved = document.getElementById("saved");

chrome.storage.sync.get({ lexiloUrl: DEFAULT_LEXILO }).then(({ lexiloUrl }) => {
  field.value = lexiloUrl;
});

document.getElementById("save").addEventListener("click", async () => {
  // Bỏ dấu gạch chéo cuối để lúc ghép địa chỉ không thành hai gạch liền nhau.
  const value = field.value.trim().replace(/\/$/, "") || DEFAULT_LEXILO;
  await chrome.storage.sync.set({ lexiloUrl: value });
  field.value = value;
  saved.hidden = false;
  setTimeout(() => { saved.hidden = true; }, 1600);
});
