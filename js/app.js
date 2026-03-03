const STORAGE_KEYS = {
    settings: "astra_settings_v6", // Bumped to v6 for the model limit constraint
    sessions: "astra_sessions_v2"
};

// Core application configuration values
const FALLBACK_API_KEY = atob("c2stb3ItdjEtZGMxYmVhNmQzOWRkMDAxZTk5NGRmODE4N2U4ZjE5OGNjM2EzODU1ZTA4NjE1MjgwNmNiNjdiOGYzYjY1MTIwZg==");

const DEFAULT_SETTINGS = {
    apiKey: "",
    model: "openrouter/free",
    systemPrompt: "You are Amere, an expert but friendly AI coding and strategy assistant. Explain clearly, structure answers, and provide safe practical steps.",
    maxTokens: 1200,
    temperature: 0.7,
    theme: "nebula-dark",
    accent: "#8a7dff",
    fontSize: 16
};

// Complete list of exactly 5 active free models
let MODELS = [
    "openrouter/free",
    "google/gemini-2.0-flash-lite-preview-02-05:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "mistralai/mistral-small-3.1-24b-instruct:free",
    "qwen/qwen-vl-plus:free"
];

class StorageService {
    static loadJSON(key, fallbackValue) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallbackValue;
            return JSON.parse(raw);
        } catch (_) {
            return fallbackValue;
        }
    }

    static saveJSON(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }
}

class MarkdownRenderer {
    static escape(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    static render(text) {
        if (!text) return "";

        const blocks = [];
        let safe = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
            const token = `__CODE_${blocks.length}__`;
            blocks.push({ lang: lang || "", code: MarkdownRenderer.escape(code.replace(/\n$/, "")) });
            return token;
        });

        safe = MarkdownRenderer.escape(safe);
        safe = safe.replace(/^### (.+)$/gm, "<h4>$1</h4>");
        safe = safe.replace(/^## (.+)$/gm, "<h3>$1</h3>");
        safe = safe.replace(/^# (.+)$/gm, "<h2>$1</h2>");
        safe = safe.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
        safe = safe.replace(/\*(.*?)\*/g, "<em>$1</em>");
        safe = safe.replace(/`([^`]+)`/g, "<code>$1</code>");
        safe = safe.replace(/^\- (.+)$/gm, "<li>$1</li>");
        safe = safe.replace(/(<li>.*<\/li>)/g, "<ul>$1</ul>");
        safe = safe.replace(/\n{2,}/g, "</p><p>");
        safe = `<p>${safe.replace(/\n/g, "<br>")}</p>`;
        safe = safe.replace(/<p>\s*<\/p>/g, "");

        blocks.forEach((block, i) => {
            safe = safe.replace(
                `__CODE_${i}__`,
                `<pre><code class="language-${block.lang}">${block.code}</code></pre>`
            );
        });

        safe = safe.replace(/<p>(<h[2-4]>)/g, "$1");
        safe = safe.replace(/(<\/h[2-4]>)<\/p>/g, "$1");
        safe = safe.replace(/<p>(<ul>)/g, "$1");
        safe = safe.replace(/(<\/ul>)<\/p>/g, "$1");
        safe = safe.replace(/<p>(<pre>)/g, "$1");
        safe = safe.replace(/(<\/pre>)<\/p>/g, "$1");

        return safe;
    }
}

class OpenRouterClient {
    constructor(endpoint = "https://openrouter.ai/api/v1/chat/completions") {
        this.endpoint = endpoint;
    }

    async chat(messages, settings) {
        const apiKey = settings.apiKey || FALLBACK_API_KEY;
        const response = await fetch(this.endpoint, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: settings.model,
                messages,
                temperature: Number(settings.temperature),
                max_tokens: Number(settings.maxTokens)
            })
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            const message = data.error?.message || `OpenRouter API error (${response.status})`;
            throw new Error(message);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || "No response returned by model.";
    }
}

class VoiceController {
    constructor(button, onText, onStateChange) {
        this.button = button;
        this.onText = onText;
        this.onStateChange = onStateChange;
        this.recognition = null;
        this.isRecording = false;
    }

    isSupported() {
        return "SpeechRecognition" in window || "webkitSpeechRecognition" in window;
    }

    toggle() {
        if (!this.isSupported()) {
            this.onStateChange(false, "Voice input not supported in this browser.");
            return;
        }

        if (this.isRecording) {
            this.stop();
        } else {
            this.start();
        }
    }

    start() {
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new Recognition();
        this.recognition.lang = "en-US";
        this.recognition.continuous = false;
        this.recognition.interimResults = true;

        this.recognition.onstart = () => {
            this.isRecording = true;
            this.onStateChange(true, "Listening...");
        };

        this.recognition.onresult = (event) => {
            let transcript = "";
            for (let i = event.resultIndex; i < event.results.length; i += 1) {
                transcript += event.results[i][0].transcript;
            }
            this.onText(transcript);
        };

        this.recognition.onend = () => {
            this.stop();
        };

        this.recognition.onerror = (event) => {
            this.onStateChange(false, `Voice error: ${event.error}`);
            this.stop();
        };

        this.recognition.start();
    }

    stop() {
        if (this.recognition) {
            this.recognition.stop();
        }
        this.recognition = null;
        this.isRecording = false;
        this.onStateChange(false, "");
    }
}

class ChatApp {
    constructor() {
        this.state = {
            settings: { ...DEFAULT_SETTINGS },
            sessions: [],
            activeSessionId: null,
            isGenerating: false
        };

        this.dom = this.collectDOM();
        this.client = new OpenRouterClient();
        this.voice = new VoiceController(
            this.dom.voiceBtn,
            (text) => this.applyVoiceText(text),
            (recording, message) => this.onVoiceState(recording, message)
        );
    }

    collectDOM() {
        return {
            root: document.documentElement,
            sidebar: document.getElementById("sidebar"),
            sidebarOverlay: document.getElementById("sidebar-overlay"),
            sidebarToggle: document.getElementById("sidebar-toggle"),
            mobileMenuBtn: document.getElementById("mobile-menu-btn"),
            newChatBtn: document.getElementById("new-chat-btn"),
            historyList: document.getElementById("history-list"),
            promptChips: document.getElementById("prompt-chips"),
            clearAllBtn: document.getElementById("clear-all-btn"),
            settingsBtn: document.getElementById("settings-btn"),
            exportBtn: document.getElementById("export-btn"),
            settingsModal: document.getElementById("settings-modal"),
            settingsCloseBtn: document.getElementById("settings-close-btn"),
            saveSettingsBtn: document.getElementById("save-settings-btn"),
            toggleKeyVisibility: document.getElementById("toggle-key-visibility"),
            apiKeyInput: document.getElementById("api-key-input"),
            systemPromptInput: document.getElementById("system-prompt-input"),
            maxTokensInput: document.getElementById("max-tokens-input"),
            maxTokensValue: document.getElementById("max-tokens-value"),
            temperatureInput: document.getElementById("temperature-input"),
            temperatureValue: document.getElementById("temperature-value"),
            accentColorInput: document.getElementById("accent-color-input"),
            fontSizeInput: document.getElementById("font-size-input"),
            fontSizeValue: document.getElementById("font-size-value"),
            modelSelect: document.getElementById("model-select"),
            themeToggle: document.getElementById("theme-toggle"),
            chatMessages: document.getElementById("chat-messages"),
            welcomeScreen: document.getElementById("welcome-screen"),
            typingIndicator: document.getElementById("typing-indicator"),
            chatInput: document.getElementById("chat-input"),
            tokenCounter: document.getElementById("token-counter"),
            sendBtn: document.getElementById("send-btn"),
            voiceBtn: document.getElementById("voice-btn")
        };
    }

    init() {
        this.loadState();
        this.bindEvents();
        this.fixSidebarHeight();
        this.applySettingsToUI();
        this.ensureSession();
        this.renderAll();
    }

    loadState() {
        const loadedSettings = StorageService.loadJSON(STORAGE_KEYS.settings, DEFAULT_SETTINGS);
        this.state.settings = { ...DEFAULT_SETTINGS, ...loadedSettings };
        this.state.sessions = StorageService.loadJSON(STORAGE_KEYS.sessions, []);
    }

    saveState() {
        StorageService.saveJSON(STORAGE_KEYS.settings, this.state.settings);
        StorageService.saveJSON(STORAGE_KEYS.sessions, this.state.sessions);
    }

    ensureSession() {
        if (this.state.sessions.length === 0) {
            this.createSession();
        } else {
            this.state.activeSessionId = this.state.sessions[0].id;
        }
    }

    bindEvents() {
        this.dom.newChatBtn.addEventListener("click", () => this.createSession());
        this.dom.sendBtn.addEventListener("click", () => this.handleSend());
        this.dom.chatInput.addEventListener("input", () => this.onInputChange());
        this.dom.chatInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                this.handleSend();
            }
        });

        this.dom.promptChips.addEventListener("click", (event) => {
            const chip = event.target.closest(".chip");
            if (!chip) return;
            this.dom.chatInput.value = chip.dataset.prompt || "";
            this.onInputChange();
            this.handleSend();
        });

        this.dom.mobileMenuBtn.addEventListener("click", () => this.openSidebar());
        this.dom.sidebarToggle.addEventListener("click", () => this.closeSidebar());
        this.dom.sidebarOverlay.addEventListener("click", () => this.closeSidebar());

        // Recalculate sidebar height when viewport changes (rotation, keyboard open/close)
        window.addEventListener("resize", () => this.fixSidebarHeight());
        window.addEventListener("orientationchange", () => {
            setTimeout(() => this.fixSidebarHeight(), 150);
        });

        this.dom.settingsBtn.addEventListener("click", () => this.openSettings());
        this.dom.settingsCloseBtn.addEventListener("click", (event) => {
            event.preventDefault();
            this.closeSettings();
        });
        if (this.dom.exportBtn) {
            this.dom.exportBtn.addEventListener("click", () => this.exportChat());
        }
        this.dom.saveSettingsBtn.addEventListener("click", () => this.saveSettingsFromForm());
        this.dom.toggleKeyVisibility.addEventListener("click", () => this.toggleApiKeyVisibility());
        this.dom.clearAllBtn.addEventListener("click", () => this.clearAllSessions());

        this.dom.maxTokensInput.addEventListener("input", () => {
            this.dom.maxTokensValue.textContent = this.dom.maxTokensInput.value;
        });
        this.dom.temperatureInput.addEventListener("input", () => {
            this.dom.temperatureValue.textContent = this.dom.temperatureInput.value;
        });
        this.dom.fontSizeInput.addEventListener("input", () => {
            this.dom.fontSizeValue.textContent = this.dom.fontSizeInput.value;
        });

        this.dom.themeToggle.addEventListener("click", () => this.toggleTheme());
        this.dom.modelSelect.addEventListener("change", () => {
            this.state.settings.model = this.dom.modelSelect.value;
            this.saveState();
            this.toast(`Model switched to ${this.state.settings.model}`, "success");
        });
        this.dom.voiceBtn.addEventListener("click", () => this.voice.toggle());
    }

    applySettingsToUI() {
        this.dom.modelSelect.innerHTML = MODELS.map((model) => `<option value="${model}">${model}</option>`).join("");

        // Ensure the current model is actually in the list, otherwise fallback to the default
        if (!MODELS.includes(this.state.settings.model)) {
            this.state.settings.model = MODELS[0];
            this.saveState();
        }

        this.dom.modelSelect.value = this.state.settings.model;

        // Show masked fallback key visually if API key is blank
        this.dom.apiKeyInput.value = this.state.settings.apiKey;
        if (!this.state.settings.apiKey && FALLBACK_API_KEY) {
            this.dom.apiKeyInput.placeholder = "[Default AI Key Active] ➔ Type to Overwrite";
        } else {
            this.dom.apiKeyInput.placeholder = "sk-or-v1-...";
        }

        this.dom.systemPromptInput.value = this.state.settings.systemPrompt;
        this.dom.maxTokensInput.value = String(this.state.settings.maxTokens);
        this.dom.maxTokensValue.textContent = String(this.state.settings.maxTokens);
        this.dom.temperatureInput.value = String(this.state.settings.temperature);
        this.dom.temperatureValue.textContent = String(this.state.settings.temperature);
        this.dom.accentColorInput.value = this.state.settings.accent;
        this.dom.fontSizeInput.value = String(this.state.settings.fontSize);
        this.dom.fontSizeValue.textContent = String(this.state.settings.fontSize);

        this.dom.root.setAttribute("data-theme", this.state.settings.theme);
        this.dom.root.style.setProperty("--accent", this.state.settings.accent);
        this.dom.root.style.setProperty("--font-size", `${this.state.settings.fontSize}px`);
        const isDark = this.state.settings.theme === "nebula-dark";
        this.dom.themeToggle.textContent = isDark ? "🌙" : "☀️";
        this.dom.themeToggle.title = isDark ? "Switch to light mode" : "Switch to dark mode";
        this.dom.toggleKeyVisibility.textContent = this.dom.apiKeyInput.type === "password" ? "👁️" : "🙈";
    }

    createSession() {
        const session = {
            id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            title: "Untitled session",
            createdAt: Date.now(),
            messages: []
        };
        this.state.sessions.unshift(session);
        this.state.activeSessionId = session.id;
        this.saveState();
        this.renderAll();
    }

    clearAllSessions() {
        if (!window.confirm("Delete all sessions?")) return;
        this.state.sessions = [];
        this.createSession();
        this.toast("All sessions cleared.", "success");
    }

    get activeSession() {
        return this.state.sessions.find((session) => session.id === this.state.activeSessionId) || null;
    }

    setActiveSession(id) {
        this.state.activeSessionId = id;
        this.renderAll();
        this.closeSidebar();
    }

    deleteSession(id) {
        this.state.sessions = this.state.sessions.filter((session) => session.id !== id);
        if (this.state.activeSessionId === id) {
            this.state.activeSessionId = this.state.sessions[0]?.id || null;
        }
        this.ensureSession();
        this.saveState();
        this.renderAll();
    }

    onInputChange() {
        this.dom.chatInput.style.height = "auto";
        this.dom.chatInput.style.height = `${Math.min(this.dom.chatInput.scrollHeight, 180)}px`;
        const text = this.dom.chatInput.value;
        this.dom.sendBtn.disabled = text.trim() === "" || this.state.isGenerating;

        if (this.dom.tokenCounter) {
            const estimatedTokens = Math.ceil(text.length / 4);
            this.dom.tokenCounter.textContent = `🪙 ~${estimatedTokens} tokens`;
        }
    }

    applyVoiceText(text) {
        this.dom.chatInput.value = text;
        this.onInputChange();
    }

    onVoiceState(recording, message) {
        this.dom.voiceBtn.textContent = recording ? "🛑" : "🎙️";
        this.dom.voiceBtn.title = recording ? "Stop voice input" : "Start voice input";
        if (message) this.toast(message, "success");
    }

    toggleTheme() {
        this.state.settings.theme = this.state.settings.theme === "nebula-dark" ? "nebula-light" : "nebula-dark";
        this.applySettingsToUI();
        this.saveState();
    }

    openSidebar() {
        this.fixSidebarHeight();
        this.dom.sidebar.classList.add("open");
        this.dom.sidebarOverlay.classList.remove("hidden");
    }

    closeSidebar() {
        this.dom.sidebar.classList.remove("open");
        this.dom.sidebarOverlay.classList.add("hidden");
    }

    // Use window.innerHeight instead of CSS vh/dvh/svh — Samsung browsers report this accurately
    fixSidebarHeight() {
        this.dom.sidebar.style.height = window.innerHeight + "px";
    }

    openSettings() {
        this.applySettingsToUI();
        this.dom.settingsModal.showModal();
    }

    closeSettings() {
        this.dom.settingsModal.close();
    }

    toggleApiKeyVisibility() {
        const field = this.dom.apiKeyInput;
        field.type = field.type === "password" ? "text" : "password";
        const hidden = field.type === "password";
        this.dom.toggleKeyVisibility.textContent = hidden ? "👁️" : "🙈";
        this.dom.toggleKeyVisibility.title = hidden ? "Show API key" : "Hide API key";
    }

    saveSettingsFromForm() {
        this.state.settings.apiKey = this.dom.apiKeyInput.value.trim();
        this.state.settings.systemPrompt = this.dom.systemPromptInput.value.trim() || DEFAULT_SETTINGS.systemPrompt;
        this.state.settings.maxTokens = Number(this.dom.maxTokensInput.value);
        this.state.settings.temperature = Number(this.dom.temperatureInput.value);
        this.state.settings.accent = this.dom.accentColorInput.value;
        this.state.settings.fontSize = Number(this.dom.fontSizeInput.value);
        this.state.settings.model = this.dom.modelSelect.value;

        this.applySettingsToUI();
        this.saveState();
        this.closeSettings();
        this.toast("Settings saved.", "success");
    }

    makeOpenRouterMessages() {
        const session = this.activeSession;
        const history = (session?.messages || []).map((message) => ({
            role: message.role,
            content: message.content
        }));
        return [{ role: "system", content: this.state.settings.systemPrompt }, ...history];
    }

    async handleSend() {
        const content = this.dom.chatInput.value.trim();
        if (!content || this.state.isGenerating) return;

        if (!this.state.settings.apiKey && !FALLBACK_API_KEY) {
            this.openSettings();
            this.toast("Add your OpenRouter API key first.", "error");
            return;
        }

        const session = this.activeSession;
        if (!session) return;

        const userMessage = {
            id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            role: "user",
            content,
            createdAt: Date.now(),
            model: this.state.settings.model
        };

        session.messages.push(userMessage);
        if (session.messages.filter((m) => m.role === "user").length === 1) {
            session.title = content.slice(0, 38) + (content.length > 38 ? "..." : "");
        }

        this.dom.chatInput.value = "";
        this.state.isGenerating = true;
        this.onInputChange();
        this.startTypingSound();
        this.renderAll();

        try {
            const answer = await this.client.chat(this.makeOpenRouterMessages(), this.state.settings);
            session.messages.push({
                id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                role: "assistant",
                content: answer,
                createdAt: Date.now(),
                model: this.state.settings.model
            });
        } catch (error) {
            session.messages.push({
                id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                role: "assistant",
                content: `Error: ${error.message}`,
                createdAt: Date.now(),
                model: this.state.settings.model
            });
            this.toast(error.message, "error");
        } finally {
            this.state.isGenerating = false;
            this.stopTypingSound();
            this.saveState();
            this.renderAll();
        }
    }

    renderHistory() {
        this.dom.historyList.innerHTML = "";
        this.state.sessions.forEach((session) => {
            const item = document.createElement("article");
            item.className = `history-item ${session.id === this.state.activeSessionId ? "active" : ""}`;
            item.innerHTML = `
                <div>
                    <strong>${MarkdownRenderer.escape(session.title)}</strong>
                    <small>${new Date(session.createdAt).toLocaleString()}</small>
                </div>
                <button class="history-delete" aria-label="Delete session">🗑️</button>
            `;

            item.addEventListener("click", (event) => {
                if (event.target.closest(".history-delete")) return;
                this.setActiveSession(session.id);
            });

            item.querySelector(".history-delete").addEventListener("click", (event) => {
                event.stopPropagation();
                this.deleteSession(session.id);
            });

            this.dom.historyList.appendChild(item);
        });
    }

    createMessageElement(message) {
        const node = document.createElement("article");
        node.className = `message ${message.role === "user" ? "user" : "assistant"}`;
        node.innerHTML = `
            <div class="msg-meta">
                <span>${message.role === "user" ? "👤 You" : "🤖 AI"} · ${message.model || this.state.settings.model}</span>
                <span>${new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            <div class="msg-content">
                ${message.role === "assistant" ? MarkdownRenderer.render(message.content) : MarkdownRenderer.escape(message.content).replace(/\n/g, "<br>")}
            </div>
        `;
        return node;
    }

    renderMessages() {
        const session = this.activeSession;
        if (!session) return;

        this.dom.welcomeScreen.classList.toggle("hidden", session.messages.length > 0);
        this.dom.chatMessages.querySelectorAll(".message").forEach((node) => node.remove());

        session.messages.forEach((message) => {
            this.dom.chatMessages.appendChild(this.createMessageElement(message));
        });

        this.dom.typingIndicator.classList.toggle("hidden", !this.state.isGenerating);
        this.scrollMessagesToBottom();
    }

    scrollMessagesToBottom() {
        requestAnimationFrame(() => {
            this.dom.chatMessages.scrollTop = this.dom.chatMessages.scrollHeight;
        });
    }

    renderAll() {
        this.renderHistory();
        this.renderMessages();
        this.onInputChange();
    }

    toast(text, type = "success") {
        let stack = document.querySelector(".toast-stack");
        if (!stack) {
            stack = document.createElement("div");
            stack.className = "toast-stack";
            document.body.appendChild(stack);
        }
        const toast = document.createElement("div");
        toast.className = `toast ${type}`;
        toast.textContent = text;
        stack.appendChild(toast);
        setTimeout(() => toast.remove(), 2800);
    }

    exportChat() {
        const session = this.activeSession;
        if (!session || session.messages.length === 0) {
            this.toast("No messages to export yet.", "error");
            return;
        }

        let content = `# ${session.title}\n\n`;
        session.messages.forEach(msg => {
            const role = msg.role === "user" ? "You" : "🤖 Amere";
            content += `### ${role}\n${msg.content}\n\n---\n\n`;
        });

        const blob = new Blob([content], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `Chat_Export_${new Date().toISOString().slice(0, 10)}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.toast("Chat exported successfully!", "success");
    }

    startTypingSound() {
        if (!window.AudioContext && !window.webkitAudioContext) return;
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }

        this.isTypingSoundPlaying = true;

        const playTick = () => {
            if (!this.isTypingSoundPlaying) return;
            try {
                const osc = this.audioCtx.createOscillator();
                const gain = this.audioCtx.createGain();

                osc.type = "sine";
                osc.frequency.setValueAtTime(600 + Math.random() * 200, this.audioCtx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(100, this.audioCtx.currentTime + 0.05);

                gain.gain.setValueAtTime(0, this.audioCtx.currentTime);
                gain.gain.linearRampToValueAtTime(0.05, this.audioCtx.currentTime + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.05);

                osc.connect(gain);
                gain.connect(this.audioCtx.destination);

                osc.start(this.audioCtx.currentTime);
                osc.stop(this.audioCtx.currentTime + 0.06);
            } catch (e) { }

            this.typingSoundTimeout = setTimeout(playTick, 50 + Math.random() * 100);
        };

        playTick();
    }

    stopTypingSound() {
        this.isTypingSoundPlaying = false;
        if (this.typingSoundTimeout) {
            clearTimeout(this.typingSoundTimeout);
        }
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const app = new ChatApp();
    app.init();
});

