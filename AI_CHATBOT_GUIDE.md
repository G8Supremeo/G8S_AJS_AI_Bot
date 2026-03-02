# Amere Chat Lab - The Ultimate Beginner's Step-by-Step Tutorial

Welcome! If you are a beginner looking to build an advanced, fully functional AI chatbot completely from scratch, you are in the right place. 

This tutorial will hold your hand and explain **every single detail and intricacy** of how this project works. By the end, you will be able to build this off the top of your head! No React, no heavy frameworks—just pure, native **HTML, CSS, and JavaScript**.

Let's build Amere!

---

## Step 1: Setting Up the Foundation (HTML)

Every great app starts with a skeleton. HTML provides the "containers" that hold our content.

**1. Create a file named `index.html`**
**2. Add this structural code:**

```html
<!DOCTYPE html>
<html lang="en" data-theme="nebula-dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Amere Chat Lab</title>
    <!-- We link our CSS file here so the browser knows how to style the page -->
    <link rel="stylesheet" href="./css/style.css">
</head>
<body>
    <!-- The main layout grid -->
    <div class="layout" id="app">
        
        <!-- SIDEBAR: Holds chat history and settings -->
        <aside class="sidebar" id="sidebar">
            <h1>Amere AI</h1>
            <button id="new-chat-btn">✨ New Session</button>
            <div id="history-list"></div> <!-- JavaScript will inject chats here -->
            <button id="settings-btn">⚙️ Settings</button>
        </aside>

        <!-- MAIN AREA: Holds the actual chat window -->
        <main class="main">
            <header class="topbar">
                <select id="model-select">
                    <!-- Users can choose which AI model they want to talk to -->
                    <option value="google/gemini-2.0-flash-lite-preview-02-05:free">Gemini 2.0</option>
                </select>
                <button id="theme-toggle">🌙</button>
            </header>

            <!-- CHAT MESSAGES: Where the conversation appears -->
            <section class="chat-stream" id="chat-messages"></section>

            <!-- COMPOSER: Where the user types -->
            <section class="composer">
                <textarea id="chat-input" placeholder="Type your prompt..."></textarea>
                <button id="send-btn">🚀 Send</button>
            </section>
        </main>
    </div>
    
    <!-- We link our JavaScript at the very end so it loads after the HTML -->
    <script src="./js/app.js"></script>
</body>
</html>
```

### The Intricacy Explained:
- We use `id="..."` on almost every element. Why? Because later, JavaScript needs a way to "grab" these specific elements using `document.getElementById()`.
- We use semantic tags like `<aside>`, `<main>`, and `<section>` instead of just `<div>` to make the code highly professional and readable.

---

## Step 2: Styling and Mobile Layout (CSS)

A naked HTML file looks terrible. We need CSS to make it beautiful and responsive (mobile-friendly).

**1. Create a folder named `css` and a file inside named `style.css`**
**2. Add the dynamic CSS variables and layout logic:**

```css
/* SETUP: Define global color themes using variables */
:root[data-theme="nebula-dark"] {
    --bg-card: rgba(12, 16, 33, 0.7);
    --border: rgba(255, 255, 255, 0.1);
    --text: #ffffff;
    --accent: #8a7dff; /* The primary purple color */
}

/* BASE STYLES: Reset default browser margins */
* {
    margin: 0;
    box-sizing: border-box;
    font-family: sans-serif;
}
body {
    background-color: #050810;
    color: var(--text);
}

/* MOBILE FIRST: We design for phones FIRST */
.main {
    display: flex;
    flex-direction: column;
    height: 100dvh; /* 100dvh ensures it fits perfectly on mobile screens */
    padding: 10px;
}

/* Critical Fix: The chat area must scroll if messages overflow */
.chat-stream {
    flex: 1; /* Pushes the chat box to fill empty space */
    overflow-y: auto; /* Adds a scrollbar automatically */
    min-height: 0; /* Prevents the box from breaking out of the screen */
}

/* SIDEBAR: Hidden off-screen on mobile by default */
.sidebar {
    position: fixed;
    top: 0; left: 0; bottom: 0;
    width: 300px;
    background: var(--bg-card);
    transform: translateX(-100%); /* Slides it off the screen to the left */
    transition: transform 0.3s ease; /* Makes it slide smoothly */
    overflow-y: auto; /* Lets the user scroll down to the bottom buttons! */
}
/* When Javascript adds the 'open' class, the sidebar slides into view! */
.sidebar.open {
    transform: translateX(0);
}

/* DESKTOP LAYOUT */
@media (min-width: 900px) {
    .layout {
        display: grid;
        grid-template-columns: 300px 1fr; /* Sidebar takes 300px, main takes the rest (1fr) */
    }
    .sidebar {
        position: relative;
        transform: none; /* Always visible on desktop! */
    }
}
```

### The Intricacy Explained:
- Notice `overflow-y: auto;` in the `.sidebar`. If you have lots of chat history chips, a mobile screen is too short. This ensures the user can scroll down to hit the "Settings" button.
- Notice `flex: 1` and `min-height: 0` in `.chat-stream`. This is a secret CSS trick! It forces the chat box to stop growing and instead contain its children with a scrollbar.

---

## Step 3: Giving the App a Brain (JavaScript)

This is where the magic happens. We will use Object-Oriented Programming (OOP) to organize our logic into "Classes". 

**1. Create a folder named `js` and a file inside named `app.js`**

### Step 3A: Connecting to the AI directly (The API Client)
We need a way to talk to OpenRouter's servers over the internet. We use the native `fetch()` function.

```javascript
// app.js

class OpenRouterClient {
    // This method takes the user's messages and sends them to the AI 
    async chat(messages, apiKey, model) {
        
        // fetch() is how browsers make network requests
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST", // We are sending data
            headers: {
                "Authorization": `Bearer ${apiKey}`, // This proves who we are
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: model, // Tells OpenRouter Which AI to use (e.g. Gemini)
                messages: messages // The actual conversation text
            })
        });

        // The AI responds with JSON data. We pull the answer out!
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error.message); // If the API fails, throw an error
        }
        
        return data.choices[0].message.content; // Return the AI's actual text
    }
}
```

### Step 3B: The Main App Controller
Now we need the master brain that listens to button clicks, updates the UI, and actually calls the API Client we just built.

```javascript
class ChatApp {
    constructor() {
        // Find our HTML elements
        this.chatInput = document.getElementById("chat-input");
        this.sendBtn = document.getElementById("send-btn");
        this.chatMessages = document.getElementById("chat-messages");
        
        // Instantiate our API client!
        this.client = new OpenRouterClient();
        
        // Hardcoded fallback key so the app works instantly
        this.apiKey = "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";

        // Listen for the user clicking "Send"
        this.sendBtn.addEventListener("click", () => this.handleSend());
    }

    async handleSend() {
        const text = this.chatInput.value;
        if (!text) return; // Do nothing if box is empty

        // 1. Show the user's message on screen
        this.chatMessages.innerHTML += `<div><b>You:</b> ${text}</div>`;
        this.chatInput.value = ""; // Clear the box

        // 2. Prepare the payload for the AI
        const payload = [{ role: "user", content: text }];

        try {
            // 3. Ask the AI for an answer! (This pauses and waits because of 'await')
            const answer = await this.client.chat(
                payload, 
                this.apiKey, 
                "google/gemini-2.0-flash-lite-preview-02-05:free"
            );

            // 4. Show the AI's answer on screen!
            this.chatMessages.innerHTML += `<div><b>Amere:</b> ${answer}</div>`;
        } catch (error) {
            // If something goes wrong, show the error in red
            this.chatMessages.innerHTML += `<div style="color:red;">Error: ${error.message}</div>`;
        }
    }
}

// Finally, start the app when the page loads!
document.addEventListener("DOMContentLoaded", () => {
    new ChatApp();
});
```

### The Intricacy Explained:
- **`async` / `await`**: These keywords are absolute lifesavers. Talking to a server takes time (latency). Instead of freezing the browser, `await` securely pauses that specific function until OpenRouter finishes generating the text and sends it back!
- **JSON.stringify**: Browsers and Servers speak via text. We use stringify to turn our complex JavaScript Objects into a flat text string that the OpenRouter server can parse.

---

## Final Review: Why it Works
If you read the above carefully:
1. The **HTML** sets up the visual placeholder boxes.
2. The **CSS** manipulates those boxes, adds scrollbars (`overflow-y: auto`), and organizes them via Grid and Flexbox so they resize on mobile phones gracefully.
3. The **JavaScript** waits for you to click "Send", packages your text into a standard JSON payload, `fetch()`es an answer across the internet from Gemini using a secure API Key, and injects the returned text right back into the HTML dynamically!

You have now mastered the core loop of an Advanced AI Application! You can take these exact concepts and scale them up infinitely.
