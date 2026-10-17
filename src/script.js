import { CAT_MEOW_AUDIO_SRC, CAT_MEOW_BASE64, CAT_MEOW_DATA_URI } from "./catSoundData.js";

(() => {
  const $ = (selector) => document.querySelector(selector);
  const ideaField = $("#idea");
  const generateButton = $("#generate");
  const fileInput = $("#attachments");
  const uploadArea = $("#upload-area");
  const attachmentList = $("#attachment-list");
  const uploadNote = $("#upload-note");
  const charCount = $("#char-count");
  const clearResultBtn = $("#clear-result-btn");
  const domAudioPlayer = $("#cat-audio-player");

  const DB_NAME = "meaw-prompt-local-v1";
  const DB_VERSION = 1;
  const CHAT_STORE = "chats";
  const MAX_FILES = 5;
  const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
  const MAX_HISTORY = 30;

  let dbPromise = null;
  let selectedFiles = [];
  let latestPrompt = "";
  let lastSubmission = null;
  let lastObjectUrls = [];
  let loadingInterval = null;

  const typeLabels = {
    anything: "Universal",
    image: "Image",
    code: "Code & Architecture",
    video: "Video",
    story: "Story",
  };

  const allowedImages = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  const allowedVideos = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo"]);

  // =========================================================================
  // Authentic Cat Meow Audio Engine (freesound_community-cat-meow-85175.mp3)
  // Cross-Platform & iOS Low-Latency Web Audio + HTML5 Audio Dual Pipeline
  // =========================================================================
  let sharedAudioCtx = null;
  let decodedCatAudioBuffer = null;
  let isDecodingAudio = false;
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  // Convert base64 string to ArrayBuffer for offline & bundle reliability
  function base64ToArrayBuffer(base64) {
    try {
      const binaryString = window.atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    } catch (e) {
      console.warn("Base64 decode failed:", e);
      return null;
    }
  }

  function getAudioContext() {
    if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx && sharedAudioCtx.state === "suspended") {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  }

  // Pre-load and decode authentic freesound MP3 audio buffer
  async function loadAndDecodeCatSound() {
    if (decodedCatAudioBuffer || isDecodingAudio) return decodedCatAudioBuffer;
    const ctx = getAudioContext();
    if (!ctx) return null;
    isDecodingAudio = true;

    try {
      let arrayBuffer = null;
      // 1. Try fetching the real MP3 static file
      try {
        const resp = await fetch(CAT_MEOW_AUDIO_SRC);
        if (resp.ok) {
          arrayBuffer = await resp.arrayBuffer();
        }
      } catch (err) {
        console.warn("Static MP3 fetch fallback to embedded data:", err);
      }

      // 2. Fallback to embedded base64 data if fetch failed
      if (!arrayBuffer && CAT_MEOW_BASE64) {
        arrayBuffer = base64ToArrayBuffer(CAT_MEOW_BASE64);
      }

      if (arrayBuffer) {
        decodedCatAudioBuffer = await new Promise((resolve, reject) => {
          ctx.decodeAudioData(arrayBuffer.slice(0), resolve, (decodeErr) => {
            // Safari older fallback
            try {
              ctx.decodeAudioData(arrayBuffer, resolve, reject);
            } catch (fallbackErr) {
              reject(decodeErr || fallbackErr);
            }
          });
        });
      }
    } catch (e) {
      console.warn("Failed to decode authentic cat meow:", e);
    } finally {
      isDecodingAudio = false;
    }
    return decodedCatAudioBuffer;
  }

  // Pre-unlock audio on user touch / click (vital for iOS Safari)
  function unlockAudio() {
    const ctx = getAudioContext();
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    if (!decodedCatAudioBuffer && !isDecodingAudio) {
      loadAndDecodeCatSound();
    }
    if (domAudioPlayer) {
      if (!domAudioPlayer.src || !domAudioPlayer.src.includes(".mp3")) {
        domAudioPlayer.src = CAT_MEOW_AUDIO_SRC;
      }
      domAudioPlayer.load();
    }
  }

  ["touchstart", "touchend", "pointerdown", "click"].forEach((evt) => {
    window.addEventListener(evt, unlockAudio, { passive: true, once: false });
  });

  // Attempt background decoding as early as possible
  setTimeout(() => {
    loadAndDecodeCatSound().catch(() => {});
  }, 100);

  // Pure Web Audio Cat Vocal Synthesizer (Loud & Crisp)
  function playWebAudioMeow(isCelebration = false) {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime + 0.01;
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.85, now);
      masterGain.connect(ctx.destination);

      if (isCelebration) {
        // Cheerful double chirp meow
        const osc1 = ctx.createOscillator();
        const g1 = ctx.createGain();
        osc1.type = "sine";
        osc1.frequency.setValueAtTime(520, now);
        osc1.frequency.linearRampToValueAtTime(860, now + 0.09);
        osc1.frequency.exponentialRampToValueAtTime(620, now + 0.19);

        g1.gain.setValueAtTime(0.001, now);
        g1.gain.linearRampToValueAtTime(0.8, now + 0.03);
        g1.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

        osc1.connect(g1);
        g1.connect(masterGain);
        osc1.start(now);
        osc1.stop(now + 0.21);

        const t2 = now + 0.22;
        const osc2 = ctx.createOscillator();
        const osc2Harm = ctx.createOscillator();
        const g2 = ctx.createGain();

        osc2.type = "sine";
        osc2Harm.type = "triangle";

        osc2.frequency.setValueAtTime(450, t2);
        osc2.frequency.linearRampToValueAtTime(950, t2 + 0.14);
        osc2.frequency.exponentialRampToValueAtTime(500, t2 + 0.42);

        osc2Harm.frequency.setValueAtTime(900, t2);
        osc2Harm.frequency.linearRampToValueAtTime(1900, t2 + 0.14);
        osc2Harm.frequency.exponentialRampToValueAtTime(1000, t2 + 0.42);

        const harmGain = ctx.createGain();
        harmGain.gain.value = 0.25;
        osc2Harm.connect(harmGain);

        g2.gain.setValueAtTime(0.001, t2);
        g2.gain.linearRampToValueAtTime(0.85, t2 + 0.04);
        g2.gain.exponentialRampToValueAtTime(0.001, t2 + 0.44);

        osc2.connect(g2);
        harmGain.connect(g2);
        g2.connect(masterGain);

        osc2.start(t2);
        osc2Harm.start(t2);
        osc2.stop(t2 + 0.45);
        osc2Harm.stop(t2 + 0.45);
      } else {
        // Classic expressive meow
        const osc = ctx.createOscillator();
        const oscHarm = ctx.createOscillator();
        const gainNode = ctx.createGain();

        osc.type = "sine";
        oscHarm.type = "triangle";

        // Frequency sweep: 400Hz -> 800Hz -> 430Hz
        osc.frequency.setValueAtTime(390, now);
        osc.frequency.linearRampToValueAtTime(800, now + 0.16);
        osc.frequency.exponentialRampToValueAtTime(430, now + 0.52);

        oscHarm.frequency.setValueAtTime(390 * 2, now);
        oscHarm.frequency.linearRampToValueAtTime(800 * 2, now + 0.16);
        oscHarm.frequency.exponentialRampToValueAtTime(430 * 2, now + 0.52);

        const harmGain = ctx.createGain();
        harmGain.gain.value = 0.3;
        oscHarm.connect(harmGain);

        gainNode.gain.setValueAtTime(0.001, now);
        gainNode.gain.linearRampToValueAtTime(0.9, now + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.54);

        osc.connect(gainNode);
        harmGain.connect(gainNode);
        gainNode.connect(masterGain);

        osc.start(now);
        oscHarm.start(now);
        osc.stop(now + 0.55);
        oscHarm.stop(now + 0.55);
      }
    } catch (e) {
      console.warn("Web Audio meow synthesis:", e);
    }
  }

  function playCatMeow(isCelebration = false) {
    unlockAudio();

    let bufferPlayed = false;
    const ctx = getAudioContext();

    // 1. Play authentic decoded MP3 AudioBuffer via WebAudio
    if (ctx && decodedCatAudioBuffer) {
      try {
        const source = ctx.createBufferSource();
        source.buffer = decodedCatAudioBuffer;
        if (isCelebration) {
          source.playbackRate.value = 1.08;
        }
        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(1.0, ctx.currentTime);
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        source.start(0);
        bufferPlayed = true;

        if (isCelebration) {
          setTimeout(() => {
            try {
              const s2 = ctx.createBufferSource();
              s2.buffer = decodedCatAudioBuffer;
              s2.playbackRate.value = 1.15;
              const g2 = ctx.createGain();
              g2.gain.setValueAtTime(0.75, ctx.currentTime);
              s2.connect(g2);
              g2.connect(ctx.destination);
              s2.start(0);
            } catch {}
          }, 220);
        }
      } catch (e) {
        console.warn("Buffer source play error:", e);
      }
    }

    // 2. Dual pipeline: In-DOM HTML5 Audio Player (freesound_community-cat-meow-85175.mp3)
    if (domAudioPlayer) {
      try {
        if (!domAudioPlayer.src || !domAudioPlayer.src.includes(".mp3")) {
          domAudioPlayer.src = CAT_MEOW_AUDIO_SRC;
        }
        domAudioPlayer.currentTime = 0;
        domAudioPlayer.volume = 1.0;
        const playPromise = domAudioPlayer.play();
        if (playPromise && playPromise.catch) {
          playPromise.catch(() => {
            if (!bufferPlayed) {
              playWebAudioMeow(isCelebration);
            }
          });
        }
      } catch {
        if (!bufferPlayed) playWebAudioMeow(isCelebration);
      }
    } else if (!bufferPlayed) {
      // 3. Last-resort fallback to synthesizer if audio buffer and audio element are unavailable
      playWebAudioMeow(isCelebration);
    }
  }

  function triggerMeow(isCelebration = false) {
    playCatMeow(isCelebration);

    const catWrapper = $("#cat-mascot");
    const mouthOpen = $("#cat-mouth-open");
    const mouthClosed = $("#cat-mouth-closed");
    const bubble = $("#cat-bubble");

    if (mouthOpen && mouthClosed) {
      mouthOpen.style.display = "block";
      mouthClosed.style.display = "none";
    }

    if (catWrapper) {
      catWrapper.classList.remove("is-meowing", "celebrating");
      void catWrapper.offsetWidth; // force DOM reflow
      catWrapper.classList.add(isCelebration ? "celebrating" : "is-meowing");
    }

    if (bubble) {
      const textEl = bubble.querySelector(".bubble-text");
      if (textEl) {
        if (isCelebration) {
          textEl.textContent = "MEOW! ✨ Master prompt ready!";
        } else {
          textEl.textContent = isIOS
            ? "Meow! 🐾 (Tip: Turn silent switch OFF if no sound!)"
            : "Meow! 🐾 Purrrrr...";
        }
      }
    }

    setTimeout(() => {
      if (mouthOpen && mouthClosed) {
        mouthOpen.style.display = "none";
        mouthClosed.style.display = "block";
      }
      if (catWrapper) {
        catWrapper.classList.remove("is-meowing", "celebrating");
      }
    }, isCelebration ? 1100 : 650);
  }

  // =========================================================================
  // IndexedDB Storage
  // =========================================================================
  function openDB() {
    if (!("indexedDB" in window)) return Promise.reject(new Error("IndexedDB is unavailable in this browser."));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(CHAT_STORE)) {
          db.createObjectStore(CHAT_STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open local history storage."));
    }).catch((err) => {
      dbPromise = null;
      throw err;
    });
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

  async function saveChat(record) {
    const db = await openDB();
    const tx = db.transaction(CHAT_STORE, "readwrite");
    const store = tx.objectStore(CHAT_STORE);
    const getAll = store.getAll();
    getAll.onsuccess = () => {
      const existing = getAll.result || [];
      existing.sort((a, b) => b.createdAt - a.createdAt);
      for (const old of existing.slice(MAX_HISTORY - 1)) {
        store.delete(old.id);
      }
      store.put(record);
    };
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  // =========================================================================
  // Media Attachments
  // =========================================================================
  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getFileKind(file) {
    const type = (file.type || "").toLowerCase();
    if (allowedImages.has(type) || /^image\//.test(type)) return "image";
    if (allowedVideos.has(type) || /^video\//.test(type)) return "video";
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return "image";
    if (["mp4", "webm", "mov", "avi"].includes(ext)) return "video";
    return "unsupported";
  }

  function setUploadNote(message, isError = false) {
    if (!uploadNote) return;
    uploadNote.textContent = message;
    uploadNote.hidden = !message;
    uploadNote.classList.toggle("error", isError);
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
        const img = document.createElement("img");
        const url = URL.createObjectURL(file);
        lastObjectUrls.push(url);
        img.src = url;
        img.alt = "";
        chip.append(img);
      } else {
        const icon = document.createElement("span");
        icon.className = "file-kind";
        icon.textContent = kind === "video" ? "▶" : "📄";
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
        setUploadNote(selectedFiles.length ? `${selectedFiles.length} file attached.` : "");
      });

      chip.append(name, size, remove);
      attachmentList.append(chip);
    });
  }

  function addFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    const candidates = [...selectedFiles, ...incoming];

    if (candidates.some((file) => file.size === 0)) {
      return setUploadNote("One of the selected files is empty.", true);
    }
    if (candidates.length > MAX_FILES) {
      return setUploadNote("You can attach up to 5 files maximum.", true);
    }
    if (candidates.some((file) => getFileKind(file) === "unsupported")) {
      return setUploadNote("Supported formats: JPG, PNG, WebP, GIF, MP4, WebM, MOV.", true);
    }
    const totalBytes = candidates.reduce((sum, f) => sum + f.size, 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      return setUploadNote("Attachments exceed 40 MB total limit. Please choose smaller files.", true);
    }

    selectedFiles = candidates;
    setUploadNote(`${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""} attached (${formatBytes(totalBytes)})`);
    renderAttachments();
  }

  fileInput?.addEventListener("change", (e) => {
    addFiles(e.target.files);
    fileInput.value = "";
  });

  uploadArea?.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadArea.classList.add("drag-over");
  });
  uploadArea?.addEventListener("dragleave", (e) => {
    if (!uploadArea.contains(e.relatedTarget)) uploadArea.classList.remove("drag-over");
  });
  uploadArea?.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadArea.classList.remove("drag-over");
    addFiles(e.dataTransfer.files);
  });

  // =========================================================================
  // Clear & Reset Functionality ("Prompt gen click korle jno clear hye...")
  // =========================================================================
  function clearOutputState() {
    latestPrompt = "";
    $("#output-text").textContent = "";
    $("#output-state").hidden = true;
    $("#error-state").hidden = true;
    $("#loading-state").hidden = true;
    $("#empty-state").hidden = false;
    $("#result-badge").hidden = true;
    $("#clear-result-btn").hidden = true;
    const copyLabel = $("#copy-label");
    if (copyLabel) copyLabel.textContent = "Copy prompt";
    const copyBtn = $("#copy-button");
    if (copyBtn) copyBtn.classList.remove("copied");
  }

  clearResultBtn?.addEventListener("click", () => {
    clearOutputState();
  });

  // =========================================================================
  // Error Display Handling
  // =========================================================================
  function showError(errData) {
    if (loadingInterval) clearInterval(loadingInterval);

    $("#empty-state").hidden = true;
    $("#loading-state").hidden = true;
    $("#output-state").hidden = true;
    $("#result-badge").hidden = true;
    $("#clear-result-btn").hidden = true;

    const errorState = $("#error-state");
    const errorTitle = $("#error-title");
    const errorMessage = $("#error-message");
    const retryBtn = $("#retry-button");

    errorState.hidden = false;

    const message = errData.message || "An unexpected error occurred.";
    const code = errData.code || "";

    if (code === "MISSING_API_KEY") {
      errorTitle.textContent = "API Secret Not Configured";
      errorMessage.innerHTML = `<strong>GEMINI_API_KEY</strong> is not set.<br>Please add <code>GEMINI_API_KEY=your_key</code> in your <code>.env</code> file (or Cloudflare Pages environment variables).`;
      retryBtn.hidden = false;
      retryBtn.textContent = "Retry";
    } else if (code === "INVALID_API_KEY") {
      errorTitle.textContent = "Invalid API Key";
      errorMessage.textContent = message;
      retryBtn.hidden = false;
      retryBtn.textContent = "Retry";
    } else if (code === "RATE_LIMITED") {
      errorTitle.textContent = "Rate Limit Reached (429)";
      errorMessage.textContent = message;
      retryBtn.hidden = false;

      let seconds = errData.retryAfter || 5;
      retryBtn.disabled = true;
      retryBtn.textContent = `Retry in ${seconds}s`;
      const timer = setInterval(() => {
        seconds--;
        if (seconds <= 0) {
          clearInterval(timer);
          retryBtn.disabled = false;
          retryBtn.textContent = "Try again now";
        } else {
          retryBtn.textContent = `Retry in ${seconds}s`;
        }
      }, 1000);
    } else {
      errorTitle.textContent = "Prompt Generation Error";
      errorMessage.textContent = message;
      retryBtn.hidden = !lastSubmission;
      retryBtn.disabled = false;
      retryBtn.textContent = "Try again";
    }

    $("#result-section").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // =========================================================================
  // Output Presentation ("prompt sundor kore gen hoi")
  // =========================================================================
  function showOutput(promptText, type, modelUsed = "", save = true) {
    if (loadingInterval) clearInterval(loadingInterval);

    latestPrompt = promptText;
    $("#empty-state").hidden = true;
    $("#loading-state").hidden = true;
    $("#error-state").hidden = true;
    $("#output-state").hidden = false;

    // Trigger celebratory meow when prompt is successfully generated!
    triggerMeow(true);

    const outputEl = $("#output-text");
    outputEl.textContent = promptText;

    const badge = $("#result-badge");
    badge.textContent = typeLabels[type] || "Universal";
    badge.hidden = false;

    const modelBadge = $("#output-model-badge");
    if (modelBadge) {
      modelBadge.textContent = modelUsed || "gemini-3.5-flash-lite";
    }

    const words = promptText.trim().split(/\s+/).filter(Boolean).length;
    const chars = promptText.length;
    $("#output-meta").textContent = `${words.toLocaleString()} words · ${chars.toLocaleString()} characters`;

    $("#clear-result-btn").hidden = false;

    if (save) {
      saveChat({
        id: crypto.randomUUID(),
        idea: ideaField.value.trim(),
        prompt: promptText,
        type,
        modelUsed,
        createdAt: Date.now(),
      }).then(() => renderHistory()).catch(() => {});
    }

    $("#result-section").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // =========================================================================
  // Generate Prompt Main Flow
  // =========================================================================
  async function expandPrompt(payload = null) {
    unlockAudio();
    const idea = ideaField.value.trim();
    const files = selectedFiles.slice();

    if (!idea && files.length === 0) {
      ideaField.focus();
      ideaField.setCustomValidity("Please write an idea or attach an image/video first.");
      ideaField.reportValidity();
      return;
    }
    ideaField.setCustomValidity("");

    const typeSelect = $("#prompt-type");
    const toneSelect = $("#tone");
    const type = typeSelect ? typeSelect.value : "anything";
    const tone = toneSelect ? toneSelect.value : "clear and natural";

    const requestData = payload || {
      idea,
      type,
      tone,
      files,
    };
    lastSubmission = requestData;

    // 1. Immediately CLEAR previous output, errors, and reset badges!
    clearOutputState();

    // 2. Set button to loading state
    generateButton.disabled = true;
    $(".button-text").textContent = "Architecting Prompt…";

    // 3. Show loading state with animated progress steps
    const loadingState = $("#loading-state");
    const loadingStep = $("#loading-step");
    loadingState.hidden = false;

    const progressSteps = [
      "Analyzing your core idea and intent…",
      "Applying universal prompt architecture principles…",
      "Drafting role, objective, and domain constraints…",
      "Synthesizing edge cases, formats, and verifiable metrics…",
      "Polishing final copy-ready master prompt…"
    ];
    let stepIndex = 0;
    loadingStep.textContent = progressSteps[0];
    loadingInterval = setInterval(() => {
      stepIndex = (stepIndex + 1) % progressSteps.length;
      loadingStep.textContent = progressSteps[stepIndex];
    }, 1800);

    $("#result-section").scrollIntoView({ behavior: "smooth", block: "nearest" });

    try {
      const formData = new FormData();
      formData.append("idea", requestData.idea);
      formData.append("type", requestData.type);
      formData.append("tone", requestData.tone);
      requestData.files.forEach((file) => formData.append("files", file, file.name));

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      let response;
      try {
        response = await fetch("/api/expand", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw {
          status: response.status,
          code: data?.code || "GENERATION_ERROR",
          message: data?.error || `Server responded with status ${response.status}`,
          retryAfter: data?.retryAfter,
        };
      }

      const generatedPrompt = (data.prompt || "").trim();
      if (!generatedPrompt) {
        throw {
          code: "EMPTY_RESULT",
          message: "No prompt text was returned from the AI model. Please try modifying your idea.",
        };
      }

      showOutput(generatedPrompt, requestData.type, data.modelUsed, true);
    } catch (err) {
      if (err.name === "AbortError") {
        showError({
          code: "TIMEOUT",
          message: "Generation timed out after 60 seconds. Please try again with a slightly simpler idea.",
        });
      } else if (err instanceof TypeError) {
        showError({
          code: "NETWORK_ERROR",
          message: "Could not connect to the backend server. Please verify your connection or refresh the page.",
        });
      } else {
        showError(err);
      }
    } finally {
      if (loadingInterval) clearInterval(loadingInterval);
      generateButton.disabled = false;
      $(".button-text").textContent = "Generate Prompt";
    }
  }

  // =========================================================================
  // History Sidebar
  // =========================================================================
  function renderHistory() {
    const list = $("#history-list");
    if (!list) return;

    getAllChats().then((history) => {
      history.sort((a, b) => b.createdAt - a.createdAt);
      list.replaceChildren();

      if (!history.length) {
        const empty = document.createElement("p");
        empty.className = "history-empty-note";
        empty.textContent = "No saved prompts yet. Generate your first prompt!";
        list.append(empty);
        return;
      }

      history.forEach((entry) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "history-item";

        const top = document.createElement("div");
        top.className = "history-item-top";

        const category = document.createElement("span");
        category.textContent = typeLabels[entry.type] || "Universal";

        const date = document.createElement("time");
        date.className = "history-date";
        date.textContent = new Date(entry.createdAt).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

        top.append(category, date);

        const idea = document.createElement("strong");
        idea.textContent = entry.idea || "Visual Media Prompt";

        const preview = document.createElement("span");
        preview.className = "history-response";
        preview.textContent = entry.prompt;

        item.append(top, idea, preview);

        item.addEventListener("click", () => {
          ideaField.value = entry.idea || "";
          ideaField.dispatchEvent(new Event("input"));
          const typeSelect = $("#prompt-type");
          if (typeSelect && entry.type) typeSelect.value = entry.type;
          showOutput(entry.prompt, entry.type, entry.modelUsed, false);
          toggleHistorySidebar(false);
        });

        list.append(item);
      });
    }).catch(() => {
      list.innerHTML = `<p class="history-empty-note">History unavailable in this browser session.</p>`;
    });
  }

  const historySidebar = $("#history-sidebar");
  const historyOverlay = $("#history-sidebar-overlay");

  function toggleHistorySidebar(open) {
    if (!historySidebar || !historyOverlay) return;
    historySidebar.hidden = !open;
    historyOverlay.hidden = !open;
    $("#history-toggle")?.setAttribute("aria-expanded", String(open));
    if (open) renderHistory();
  }

  $("#history-toggle")?.addEventListener("click", () => toggleHistorySidebar(historySidebar.hidden));
  $("#sidebar-close")?.addEventListener("click", () => toggleHistorySidebar(false));
  historyOverlay?.addEventListener("click", () => toggleHistorySidebar(false));

  $("#clear-history")?.addEventListener("click", async () => {
    if (!confirm("Clear all saved prompts from local device history?")) return;
    try {
      const db = await openDB();
      const tx = db.transaction(CHAT_STORE, "readwrite");
      tx.objectStore(CHAT_STORE).clear();
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      renderHistory();
    } catch {
      // ignore
    }
  });

  // =========================================================================
  // Interactive Cat Mascot ("cat a click korle meaw kore uthbe")
  // =========================================================================
  const catMascot = $("#cat-mascot");

  catMascot?.addEventListener("click", () => {
    triggerMeow(false);
  });

  // =========================================================================
  // Event Bindings
  // =========================================================================
  ideaField?.addEventListener("input", () => {
    charCount.textContent = `${ideaField.value.length.toLocaleString()} / 4,000`;
    ideaField.setCustomValidity("");
  });

  ideaField?.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      expandPrompt();
    }
  });

  generateButton?.addEventListener("click", () => {
    expandPrompt();
  });

  $("#retry-button")?.addEventListener("click", () => {
    if (lastSubmission) expandPrompt(lastSubmission);
  });

  // Example Chips
  document.querySelectorAll(".example-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      ideaField.value = btn.dataset.example || "";
      ideaField.dispatchEvent(new Event("input"));
      ideaField.focus();
    });
  });

  // Copy Buttons
  $("#copy-button")?.addEventListener("click", async () => {
    if (!latestPrompt) return;
    try {
      await navigator.clipboard.writeText(latestPrompt);
      const copyBtn = $("#copy-button");
      const label = $("#copy-label");
      copyBtn.classList.add("copied");
      label.textContent = "Copied! ✓";
      setTimeout(() => {
        copyBtn.classList.remove("copied");
        label.textContent = "Copy prompt";
      }, 2000);
    } catch {
      const range = document.createRange();
      range.selectNodeContents($("#output-text"));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  });

  $("#copy-markdown-btn")?.addEventListener("click", async () => {
    if (!latestPrompt) return;
    const type = $("#prompt-type")?.value || "universal";
    const markdown = `## Architected Prompt (${typeLabels[type] || "Universal"})\n\n\`\`\`markdown\n${latestPrompt}\n\`\`\``;
    try {
      await navigator.clipboard.writeText(markdown);
      const btn = $("#copy-markdown-btn");
      btn.textContent = "Copied Markdown! ✓";
      setTimeout(() => { btn.textContent = "Copy Markdown"; }, 2000);
    } catch {
      // fallback
    }
  });

  // Theme Toggle
  $("#theme-toggle")?.addEventListener("click", () => {
    document.body.classList.toggle("dark-theme");
    const isDark = document.body.classList.contains("dark-theme");
    localStorage.setItem("meaw-theme", isDark ? "dark" : "light");
    $("#theme-toggle").setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
  });

  if (localStorage.getItem("meaw-theme") === "dark") {
    document.body.classList.add("dark-theme");
  }

  // Initialization
  renderHistory();
})();
