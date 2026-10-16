(() => {
  const $ = (selector) => document.querySelector(selector);
  const ideaField = $("#idea");
  const generateButton = $("#generate");
  const settingsPanel = $("#settings-panel");
  const modelField = $("#model-name");
  const fileInput = $("#attachments");
  const uploadArea = $("#upload-area");
  const attachmentList = $("#attachment-list");
  const uploadNote = $("#upload-note");
  const DB_NAME = "promptnest-local-v2";
  const DB_VERSION = 1;
  const CHAT_STORE = "chats";
  const CACHE_STORE = "response-cache";
  const MAX_FILES = 5;
  const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
  const MAX_SAVED_ATTACHMENT_BYTES = 50 * 1024 * 1024;
  const MAX_HISTORY = 30;
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  const MODEL_SET = "gemini-3.5-flash-lite|gemini-3.1-flash-lite";
  let dbPromise;
  let selectedType = "image";
  let selectedFiles = [];
  let latestPrompt = "";
  let lastSubmission = null;
  let lastObjectUrls = [];

  const typeLabels = { image: "Image", video: "Video", code: "Code", story: "Story", anything: "Anything" };
  const allowedImages = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  const allowedVideos = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/mpeg", "video/x-flv", "video/3gpp"]);

  function setStatus(message, saved = false) {
    const status = $("#key-status");
    status.textContent = message;
    status.classList.toggle("saved", saved);
    $(".key-dot").classList.toggle("ready", saved);
  }

  function setNotice(message, kind = "info") {
    const note = $("#storage-notice");
    if (!note) return;
    note.textContent = message;
    note.hidden = !message;
    note.classList.toggle("warning", kind === "warning");
  }

  function openDB() {
    if (!("indexedDB" in window)) return Promise.reject(new Error("IndexedDB is unavailable in this browser."));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(CHAT_STORE)) db.createObjectStore(CHAT_STORE, { keyPath: "id" });
        if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open local history storage."));
      request.onblocked = () => reject(new Error("Close other tabs using this app, then reload to open local storage."));
    }).catch((error) => { dbPromise = null; throw error; });
    return dbPromise;
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Local storage request failed."));
    });
  }

  async function getAllChats() {
    const db = await openDB();
    const tx = db.transaction(CHAT_STORE, "readonly");
    return requestResult(tx.objectStore(CHAT_STORE).getAll());
  }

  async function readCached(key) {
    const db = await openDB();
    const tx = db.transaction(CACHE_STORE, "readonly");
    const record = await requestResult(tx.objectStore(CACHE_STORE).get(key));
    if (!record) return null;
    if (record.expiresAt <= Date.now()) {
      const cleanup = db.transaction(CACHE_STORE, "readwrite");
      cleanup.objectStore(CACHE_STORE).delete(key);
      return null;
    }
    return record.prompt;
  }

  async function saveCached(key, prompt) {
    const db = await openDB();
    const tx = db.transaction(CACHE_STORE, "readwrite");
    const store = tx.objectStore(CACHE_STORE);
    const getAll = store.getAll();
    getAll.onsuccess = () => {
      const now = Date.now();
      const records = getAll.result || [];
      records.filter((item) => item.expiresAt <= now).forEach((item) => store.delete(item.key));
      records.filter((item) => item.key !== key && item.expiresAt > now).sort((a, b) => b.createdAt - a.createdAt).slice(99).forEach((item) => store.delete(item.key));
      store.put({ key, prompt, createdAt: now, expiresAt: now + CACHE_TTL });
    };
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
  }

  async function saveChat(record) {
    const db = await openDB();
    const chats = await getAllChats();
    const usedBytes = chats.reduce((sum, chat) => sum + (chat.attachments || []).reduce((sub, item) => sub + (item.blob?.size || 0), 0), 0);
    const attachmentBytes = (record.attachments || []).reduce((sum, item) => sum + (item.blob?.size || 0), 0);
    let storedAttachments = record.attachments || [];
    let mediaSaved = true;
    if (usedBytes + attachmentBytes > MAX_SAVED_ATTACHMENT_BYTES) {
      storedAttachments = storedAttachments.map(({ blob, ...metadata }) => metadata);
      mediaSaved = false;
    }
    const toStore = { ...record, attachments: storedAttachments, mediaSaved };
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(CHAT_STORE, "readwrite");
        const store = tx.objectStore(CHAT_STORE);
        const getAll = store.getAll();
        getAll.onsuccess = () => {
          const existing = getAll.result || [];
          existing.sort((a, b) => b.createdAt - a.createdAt);
          for (const old of existing.slice(MAX_HISTORY - 1)) store.delete(old.id);
          store.put(toStore);
        };
        getAll.onerror = () => tx.abort();
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error("Could not save this chat."));
        tx.onabort = () => reject(tx.error || new Error("Could not save this chat."));
      });
      return mediaSaved;
    } catch (error) {
      if (storedAttachments.some((item) => item.blob)) {
        const textOnly = { ...record, attachments: (record.attachments || []).map(({ blob, ...metadata }) => metadata), mediaSaved: false };
        const tx = db.transaction(CHAT_STORE, "readwrite");
        tx.objectStore(CHAT_STORE).put(textOnly);
        await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
        return false;
      }
      throw error;
    }
  }

  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getFileKind(file) {
    const type = (file.type || "").toLowerCase();
    if (allowedImages.has(type) || /^image\//.test(type)) return "image";
    if (allowedVideos.has(type) || /^video\//.test(type)) return "video";
    const extension = (file.name.split(".").pop() || "").toLowerCase();
    if (["jpg", "jpeg", "png", "webp", "gif"].includes(extension)) return "image";
    if (["mp4", "m4v", "webm", "mov", "avi", "mpeg", "mpg", "flv", "3gp"].includes(extension)) return "video";
    return "unsupported";
  }

  function renderAttachments() {
    lastObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    lastObjectUrls = [];
    attachmentList.replaceChildren();
    selectedFiles.forEach((file, index) => {
      const chip = document.createElement("div");
      chip.className = "attachment-chip";
      const kind = getFileKind(file);
      if (kind === "image") {
        const image = document.createElement("img");
        const url = URL.createObjectURL(file);
        lastObjectUrls.push(url);
        image.src = url;
        image.alt = "";
        chip.append(image);
      } else {
        const icon = document.createElement("span");
        icon.className = "file-kind";
        icon.textContent = kind === "video" ? "▶" : "?";
        chip.append(icon);
      }
      const name = document.createElement("span");
      name.className = "file-name";
      name.textContent = file.name;
      name.title = file.name;
      const size = document.createElement("span");
      size.className = "file-size";
      size.textContent = formatBytes(file.size);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${file.name}`);
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        selectedFiles.splice(index, 1);
        renderAttachments();
        setUploadNote("Up to 5 files, including one video; 40 MB total.");
      });
      chip.append(name, size, remove);
      attachmentList.append(chip);
    });
  }

  function setUploadNote(message, error = false) {
    uploadNote.textContent = message;
    uploadNote.classList.toggle("error", error);
  }

  function addFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    const candidates = [...selectedFiles, ...incoming];
    if (candidates.some((file) => file.size === 0)) return setUploadNote("One of those files is empty. Choose a non-empty image or video.", true);
    if (candidates.length > MAX_FILES) return setUploadNote("Choose up to 5 files total.", true);
    if (candidates.some((file) => getFileKind(file) === "unsupported")) return setUploadNote("Use a supported image or video file (JPEG, PNG, WebP, GIF, MP4, WebM, MOV, AVI, MPEG, FLV, or 3GP).", true);
    if (candidates.filter((file) => getFileKind(file) === "video").length > 1) return setUploadNote("Attach one video at a time. You can include images with it.", true);
    if (candidates.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_BYTES) return setUploadNote("Attachments are over 40 MB total. Remove a file or choose smaller ones.", true);
    selectedFiles = candidates;
    setUploadNote(`${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"} ready · ${formatBytes(selectedFiles.reduce((sum, file) => sum + file.size, 0))} of 40 MB`);
    renderAttachments();
  }

  function renderHistory() {
    const section = $("#history-section");
    const list = $("#history-list");
    getAllChats().then((history) => {
      history.sort((a, b) => b.createdAt - a.createdAt);
      section.hidden = history.length === 0;
      list.replaceChildren();
      history.forEach((entry) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "history-item";
        const top = document.createElement("div");
        top.className = "history-item-top";
        const category = document.createElement("span");
        category.textContent = typeLabels[entry.type] || "Prompt";
        const date = document.createElement("time");
        date.className = "history-date";
        date.dateTime = new Date(entry.createdAt).toISOString();
        date.textContent = new Date(entry.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
        top.append(category, date);
        const idea = document.createElement("strong");
        idea.textContent = entry.idea || "Media-based prompt";
        const response = document.createElement("span");
        response.className = "history-response";
        response.textContent = entry.prompt;
        button.append(top, idea, response);
        if (entry.attachments?.length) {
          const files = document.createElement("span");
          files.className = "history-files";
          files.textContent = `${entry.attachments.length} attachment${entry.attachments.length === 1 ? "" : "s"}${entry.mediaSaved ? " · stored locally" : " · names only (local storage limit)"}`;
          button.append(files);
        }
        button.addEventListener("click", () => {
          ideaField.value = entry.idea || "";
          ideaField.dispatchEvent(new Event("input"));
          document.querySelectorAll(".type-option").forEach((item) => item.classList.toggle("active", item.dataset.type === entry.type));
          selectedType = typeLabels[entry.type] ? entry.type : "anything";
          selectedFiles = (entry.attachments || []).filter((item) => item.blob).map((item) => new File([item.blob], item.name, { type: item.type, lastModified: item.lastModified || Date.now() }));
          renderAttachments();
          if ((entry.attachments || []).length && selectedFiles.length === 0) setUploadNote("This chat’s files were not stored locally; reattach them to use them again.", true);
          showOutput(entry.prompt, entry.type, false, entry.idea, true);
          $("#result-section").scrollIntoView({ behavior: "smooth", block: "start" });
        });
        list.append(button);
      });
    }).catch(() => {
      section.hidden = false;
      list.replaceChildren();
      const note = document.createElement("p");
      note.className = "history-empty-note";
      note.textContent = "Local chat history is unavailable in this browser, but prompt generation still works.";
      list.append(note);
      setNotice("IndexedDB could not open. Prompts will work, but chats and cache may not persist.", "warning");
    });
  }

  function showOutput(prompt, type, save = false, idea = "", fromCache = false, attachments = [], model = "") {
    latestPrompt = prompt;
    $("#empty-state").hidden = true;
    $("#loading-state").hidden = true;
    $("#error-state").hidden = true;
    $("#output-state").hidden = false;
    $("#output-text").textContent = prompt;
    $("#result-badge").textContent = typeLabels[type] || "Prompt";
    $("#result-badge").hidden = false;
    const words = prompt.trim().split(/\s+/).filter(Boolean).length;
    $("#output-meta").textContent = `${words} words${fromCache ? " · saved result" : ""}${model ? ` · ${model}` : ""}`;
    if (save) persistChat(idea, prompt, type, attachments);
  }

  async function persistChat(idea, prompt, type, files) {
    const attachments = files.map((file) => ({ name: file.name, type: file.type, size: file.size, lastModified: file.lastModified, blob: file }));
    try {
      const mediaSaved = await saveChat({ id: crypto.randomUUID(), idea: idea.trim(), prompt, type, attachments, createdAt: Date.now() });
      setNotice(mediaSaved || !attachments.length ? "This chat is saved on this device." : "Chat text is saved; the uploaded files were too large to archive locally.");
      renderHistory();
    } catch {
      setNotice("Prompt generated, but local storage was full or unavailable; this chat could not be saved.", "warning");
      renderHistory();
    }
  }

  function showError(message, retryable = Boolean(lastSubmission)) {
    $("#empty-state").hidden = true;
    $("#loading-state").hidden = true;
    $("#output-state").hidden = true;
    $("#error-state").hidden = false;
    $("#result-badge").hidden = true;
    $("#error-message").textContent = message;
    $("#retry-button").hidden = !retryable;
  }

  async function sha256(file) {
    const data = await file.arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function requestFingerprint(payload) {
    try {
      const media = [];
      for (const file of payload.files) media.push({ hash: await sha256(file), name: file.name, type: file.type, size: file.size });
      const canonical = JSON.stringify({ v: 2, models: MODEL_SET, idea: payload.idea, type: payload.type, tone: payload.tone, detail: payload.detail, model: payload.model, media });
      return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical))), (byte) => byte.toString(16).padStart(2, "0")).join("");
    } catch { return ""; }
  }

  async function expandPrompt(payload = null) {
    const idea = ideaField.value.trim();
    const files = selectedFiles.slice();
    if (!idea && files.length === 0) {
      ideaField.focus();
      ideaField.setCustomValidity("Add a short idea or attach an image/video first.");
      ideaField.reportValidity();
      return;
    }
    ideaField.setCustomValidity("");
    const model = modelField.value.trim();
    if (model && !/^[a-zA-Z0-9._-]{1,100}$/.test(model)) {
      showError("Enter a valid model name, or leave it blank to use the configured models.", false);
      toggleSettings(true);
      return;
    }
    const requestData = payload || { idea, files, type: selectedType, tone: $("#tone").value, detail: $("#detail").value, model };
    lastSubmission = requestData;
    generateButton.disabled = true;
    $("#retry-button").hidden = true;
    $(".button-text").textContent = requestData.files.length ? "Reading your files…" : "Expanding…";
    $("#empty-state").hidden = true;
    $("#output-state").hidden = true;
    $("#error-state").hidden = true;
    $("#loading-state").hidden = false;
    $("#result-badge").hidden = true;
    setNotice("");

    try {
      const fingerprint = await requestFingerprint(requestData);
      if (fingerprint) {
        const cached = await readCached(fingerprint).catch(() => null);
        if (cached) {
          showOutput(cached, requestData.type, true, requestData.idea, true, requestData.files);
          return;
        }
      }

      const form = new FormData();
      form.append("idea", requestData.idea);
      form.append("type", requestData.type);
      form.append("tone", requestData.tone);
      form.append("detail", requestData.detail);
      form.append("model", requestData.model);
      requestData.files.forEach((file) => form.append("files", file, file.name));
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);
      let response;
      try { response = await fetch("/api/expand", { method: "POST", body: form, signal: controller.signal }); }
      finally { clearTimeout(timeout); }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof data?.error === "string" ? data.error : `Request failed (${response.status}).`;
        const error = new Error(message);
        error.status = response.status;
        error.retryAfter = data?.retryAfter;
        throw error;
      }
      const text = (typeof data?.prompt === "string" ? data.prompt : "").trim();
      if (!text) throw new Error("No prompt text was returned. Please try again.");
      if (fingerprint) await saveCached(fingerprint, text).catch(() => {});
      showOutput(text, requestData.type, true, requestData.idea, false, requestData.files);
    } catch (error) {
      let message = error?.message || "An unexpected error occurred. Please try again.";
      if (error?.name === "AbortError") message = "This request took too long. Try a smaller video or retry in a moment.";
      else if (error instanceof TypeError) message = "Could not reach the generation service. Check your connection and try again.";
      else if (error?.status === 413) message = "The upload is too large for this request. Use files smaller than the stated limit.";
      showError(message, Boolean(lastSubmission));
    } finally {
      generateButton.disabled = false;
      $(".button-text").textContent = "Expand my prompt";
    }
  }

  function toggleSettings(open) {
    settingsPanel.hidden = !open;
    $("#settings-toggle").setAttribute("aria-expanded", String(open));
    if (open) settingsPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  ideaField.addEventListener("input", () => {
    $("#char-count").textContent = `${ideaField.value.length.toLocaleString()} / 2,000`;
    ideaField.setCustomValidity("");
  });
  document.querySelectorAll(".type-option").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll(".type-option").forEach((item) => item.classList.toggle("active", item === button));
    selectedType = button.dataset.type;
  }));
  document.querySelectorAll(".example-chip").forEach((button) => button.addEventListener("click", () => {
    ideaField.value = button.dataset.example;
    ideaField.dispatchEvent(new Event("input"));
    ideaField.focus();
  }));
  fileInput.addEventListener("change", (event) => { addFiles(event.target.files); fileInput.value = ""; });
  uploadArea.addEventListener("dragover", (event) => { event.preventDefault(); uploadArea.classList.add("drag-over"); });
  uploadArea.addEventListener("dragleave", (event) => { if (!uploadArea.contains(event.relatedTarget)) uploadArea.classList.remove("drag-over"); });
  uploadArea.addEventListener("drop", (event) => { event.preventDefault(); uploadArea.classList.remove("drag-over"); addFiles(event.dataTransfer.files); });
  generateButton.addEventListener("click", () => expandPrompt());
  $("#retry-button").addEventListener("click", () => { if (lastSubmission) expandPrompt(lastSubmission); });
  ideaField.addEventListener("keydown", (event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") expandPrompt(); });
  $("#settings-toggle").addEventListener("click", () => toggleSettings(settingsPanel.hidden));
  $("#footer-settings").addEventListener("click", () => toggleSettings(true));
  $("#settings-close").addEventListener("click", () => toggleSettings(false));

  $("#save-model").addEventListener("click", () => {
    const model = modelField.value.trim();
    if (model && !/^[a-zA-Z0-9._-]{1,100}$/.test(model)) {
      setStatus("Model name is not valid");
      modelField.focus();
      return;
    }
    try {
      if (model) sessionStorage.setItem("promptnest.model", model);
      else sessionStorage.removeItem("promptnest.model");
      setStatus("Model preference saved for this tab", true);
    } catch { setStatus("Could not save model preference"); }
  });

  $("#copy-button").addEventListener("click", async () => {
    if (!latestPrompt) return;
    try {
      await navigator.clipboard.writeText(latestPrompt);
      $("#copy-label").textContent = "Copied";
      window.setTimeout(() => { $("#copy-label").textContent = "Copy prompt"; }, 1500);
    } catch {
      const range = document.createRange();
      range.selectNodeContents($("#output-text"));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      $("#copy-label").textContent = "Select and copy";
    }
  });

  $("#clear-history").addEventListener("click", async () => {
    if (!window.confirm("Clear all saved chats and cached results from this device?")) return;
    try {
      const db = await openDB();
      const tx = db.transaction([CHAT_STORE, CACHE_STORE], "readwrite");
      tx.objectStore(CHAT_STORE).clear();
      tx.objectStore(CACHE_STORE).clear();
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
      setNotice("Saved chats and cached results cleared from this device.");
      renderHistory();
    } catch { setNotice("Could not clear local storage. Check browser storage permissions.", "warning"); }
  });

  $("#theme-toggle").addEventListener("click", () => {
    document.body.classList.toggle("dark-theme");
    const dark = document.body.classList.contains("dark-theme");
    $("#theme-toggle").setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  });
  modelField.addEventListener("change", () => {
    try { sessionStorage.setItem("promptnest.model", modelField.value.trim()); } catch { /* Optional preference. */ }
  });

  setStatus("API key managed by deployment", false);
  try {
    const savedModel = sessionStorage.getItem("promptnest.model");
    if (savedModel) modelField.value = savedModel;
  } catch { /* Keep the deployment default. */ }
  renderHistory();
})();
