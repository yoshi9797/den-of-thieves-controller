(function () {
    "use strict";

    // --- State ---
    var socket = null;
    var connected = false;
    var reconnectTimer = null;
    var controlsEnabled = false;   // global gate: all controls start disabled
    var controlStates = {};        // per-control enabled state
    var tillValues = {};           // cached till display values

    // --- DOM refs ---
    var statusEl = document.getElementById("status-indicator");
    var statusText = document.getElementById("status-text");
    var hostInput = document.getElementById("host-input");
    var connectBtn = document.getElementById("connect-btn");
    var gamepadEl = document.getElementById("gamepad");
    var bustBtn = document.getElementById("bust-btn");
    var acceptBtn = document.getElementById("btn-accept");
    var cheatBtn = document.getElementById("btn-cheat");
    var voteBtn = document.getElementById("btn-vote");
    var tillEls = {
        left_player: document.getElementById("till-left-player"),
        my_left: document.getElementById("till-my-left"),
        my_right: document.getElementById("till-my-right"),
        right_player: document.getElementById("till-right-player")
    };

    // --- Helpers ---
    function connectToGlobalGame() {
        var roomCode = document.getElementById("room-code").value.trim().toUpperCase();
        
        // Query your free public database for where the Steam host is hiding
        fetch(`https://https://den-of-thieves-bridge-default-rtdb.firebaseio.com/rooms/${roomCode}.json`)
        .then(response => response.json())
        .then(roomData => {
            if (!roomData || !roomData.host_active) {
                alert("Room not found! Check the TV screen code.");
                return;
            }
            
            // Connect directly via raw WebRTC right through the cellular gateway!
            setupWebRTCHandshake(roomCode);
        });
    }

    function setStatus(state, msg) {
        statusEl.className = "status-" + state;
        statusText.textContent = msg;
    }

    function getHost() {
        // Query parameter ?host=... overrides the input field
        var params = new URLSearchParams(window.location.search);
        var qHost = params.get("host");
        if (qHost) {
            hostInput.value = qHost;
            return qHost;
        }
        return hostInput.value.trim() || "http://localhost:3000";
    }

    // --- Socket.IO connection ---
    function connect() {
        if (socket) {
            socket.disconnect();
            socket = null;
        }

        controlStates = {};
        setControlsEnabled(false);
        var host = getHost();
        setStatus("connecting", "Connecting...");
        connectBtn.disabled = true;

        socket = io(host, {
            transports: ["websocket"],
            forcenew: true
        });

        socket.on("connect", function () {
            connected = true;
            setStatus("connected", "Connected");
            connectBtn.disabled = false;
            connectBtn.textContent = "Disconnect";

            // Grab the room code from the URL or your room code input element
            var params = new URLSearchParams(window.location.search);
            var roomCode = params.get("room") || ""; 

            // Tell the backend server exactly which match we are joining!
            socket.emit("join_room", { 
                room: roomCode.toUpperCase(), 
                playerName: "Mobile Player" 
            });

            socket.emit("controller_ready", {});
        });

        socket.on("disconnect", function (reason) {
            connected = false;
            controlStates = {};
            setControlsEnabled(false);
            setStatus("disconnected", "Disconnected (" + reason + ")");
            connectBtn.disabled = false;
            connectBtn.textContent = "Connect";
        });

        socket.on("connect_error", function (err) {
            connected = false;
            controlStates = {};
            setControlsEnabled(false);
            setStatus("disconnected", "Error: " + err.message);
            connectBtn.disabled = false;
            connectBtn.textContent = "Connect";
        });

        socket.on("reconnect_attempt", function (attempt) {
            setStatus("connecting", "Reconnecting (" + attempt + ")...");
        });

        socket.on("reconnect", function () {
            connected = true;
            setStatus("connected", "Reconnected");
            socket.emit("controller_ready", {});
        });

        // --- Inbound PC signal listeners for control gating ---
        socket.on("controller_state", handleControlState);
        socket.on("enable_controls", handleControlState);
        socket.on("controls_enabled", handleControlState);
        socket.on("control_state", handleControlState);

        // --- Server GUILTY event: one-second vibration ---
        socket.on("GUILTY", function () {
            if (typeof navigator.vibrate === "function") {
                navigator.vibrate(1000); // 1-second continuous shake
            }
        });
    }

    function disconnect() {
        if (socket) {
            socket.disconnect();
            socket = null;
        }
        connected = false;
        controlStates = {};
        setControlsEnabled(false);
        setStatus("disconnected", "Disconnected");
        connectBtn.disabled = false;
        connectBtn.textContent = "Connect";
    }

    function toggleConnection() {
        if (connected) {
            disconnect();
        } else {
            connect();
        }
    }

    // --- Input emission ---
    function emitAction(action, pressed) {
        if (!socket || !connected) return;
        // Only gate press events. Releases are allowed to clear a held input.
        if (pressed && !isControlEnabled(action)) return;
        socket.emit("controller_input", {
            action: action,
            pressed: pressed
        });
    }

    // --- Control gating (PC-authoritative) ---
    // Control name mapping: accepts snake_case and common display forms
    var CONTROL_LOOKUP = {
        "bust": "bust", "Bust": "bust",
        "accept_move": "accept_move", "accept move": "accept_move", "Accept Move": "accept_move",
        "cheat": "cheat", "Cheat": "cheat",
        "vote": "vote", "Vote": "vote",
        "move_up": "move_up", "move up": "move_up", "Move Up": "move_up",
        "move_down": "move_down", "move down": "move_down", "Move Down": "move_down",
        "move_left": "move_left", "move left": "move_left", "Move Left": "move_left",
        "move_right": "move_right", "move right": "move_right", "Move Right": "move_right"
    };

    // Till key aliases
    var TILL_LOOKUP = {
        "left_player": "left_player", "player_left": "left_player",
        "player to my left": "left_player", "Player Left": "left_player",
        "my_left": "my_left", "my left": "my_left", "My Left": "my_left",
        "my_right": "my_right", "my right": "my_right", "My Right": "my_right",
        "right_player": "right_player", "player_right": "right_player",
        "player to my right": "right_player", "Player Right": "right_player"
    };

    function resolveControl(name) {
        return CONTROL_LOOKUP[name] || TILL_LOOKUP[name] || name;
    }

    function resolveTill(name) {
        return TILL_LOOKUP[name] || name;
    }

    function isControlEnabled(key) {
        if (!controlsEnabled) return false;
        var hasPerControlState = Object.keys(controlStates).length > 0;
        if (!hasPerControlState) return true;
        if (!Object.prototype.hasOwnProperty.call(controlStates, key)) return false;
        return controlStates[key] === true;
    }

    function refreshControlVisuals() {
        var controls = gamepadEl.querySelectorAll("[data-action], [data-till]");
        controls.forEach(function (el) {
            var key = el.getAttribute("data-action");
            if (!key) key = resolveTill(el.getAttribute("data-till"));
            var enabled = isControlEnabled(key);
            el.classList.toggle("control-disabled", !enabled);
            el.classList.toggle("control-active", enabled);
            if (el.hasAttribute("data-till")) {
                el.disabled = !enabled;
            }
        });
    }

    function setControlsEnabled(enabled) {
        controlsEnabled = !!enabled;
        gamepadEl.classList.toggle("disabled", !controlsEnabled);
        refreshControlVisuals();
    }

    function applyControlStates(states) {
        controlStates = {};
        if (!states || typeof states !== "object") {
            setControlsEnabled(false);
            return;
        }
        for (var name in states) {
            if (Object.prototype.hasOwnProperty.call(states, name)) {
                var key = resolveControl(name);
                controlStates[key] = states[name] === true;
            }
        }
        setControlsEnabled(Object.keys(controlStates).length > 0);
    }

    function enableControls(names) {
        if (!Array.isArray(names)) return;
        // Reset per-control states, then enable only named controls
        controlStates = {};
        for (var i = 0; i < names.length; i++) {
            var key = resolveControl(names[i]);
            controlStates[key] = true;
        }
        setControlsEnabled(names.length > 0);
    }

    function updateTills(tills) {
        if (!tills || typeof tills !== "object") return;
        for (var name in tills) {
            if (tills.hasOwnProperty(name)) {
                var key = resolveTill(name);
                tillValues[key] = tills[name];
            }
        }
        renderTills();
    }

    function renderTills() {
        for (var key in tillEls) {
            if (tillEls.hasOwnProperty(key) && tillEls[key]) {
                var val = tillValues[key];
                tillEls[key].textContent = val !== undefined ? val : "---";
            }
        }
    }

    // --- PC-signal handler (tolerant parser) ---
    // Accepts payload shapes:
    //   { enabled: { bust: true, accept_move: false, ... } }   per-control map
    //   { enabled: ["bust", "accept_move"] }                   enabled array
    //   { controls: ["bust", "accept_move"] }                  controls array
    //   true / false                                            global toggle
    //   { tills: { left_player: 100, my_left: 200, ... } }     till values
    function handleControlState(payload) {
        if (payload === null || payload === undefined) return;

        // Global boolean toggle
        if (typeof payload === "boolean") {
            controlStates = {};
            setControlsEnabled(payload);
            return;
        }

        if (typeof payload !== "object") return;

        // { enabled: true/false } global toggle
        if (payload.enabled !== undefined && typeof payload.enabled === "boolean") {
            controlStates = {};
            setControlsEnabled(payload.enabled);
        }

        // { enabled: { bust: true, ... } } per-control map
        if (payload.enabled !== undefined && typeof payload.enabled === "object" && !Array.isArray(payload.enabled)) {
            applyControlStates(payload.enabled);
        }

        // { enabled: ["bust", "accept_move"] } enabled array
        if (Array.isArray(payload.enabled)) {
            enableControls(payload.enabled);
        }

        // { controls: ["bust", "accept_move"] } controls array
        if (Array.isArray(payload.controls)) {
            enableControls(payload.controls);
        }

        // { tills: { left_player: 100, ... } } till values
        // Secured implementation
        if (payload.tills !== undefined && payload.tills !== null && typeof payload.tills === "object") {
            updateTills(payload.tills);
        }
    }

    // Set up pointer/touch events on each dpad button
    var dpadBtns = document.querySelectorAll(".dpad-btn");
    dpadBtns.forEach(function (btn) {
        var action = btn.getAttribute("data-action");
        if (!action) return;

        function pressStart(e) {
            e.preventDefault();
            if (!isControlEnabled(action)) return;
            btn.classList.add("pressed");
            emitAction(action, true);
        }

        function pressEnd(e) {
            e.preventDefault();
            btn.classList.remove("pressed");
            emitAction(action, false);
        }

        // Pointer Events (modern browsers, covers touch + mouse)
        btn.addEventListener("pointerdown", pressStart);
        btn.addEventListener("pointerup", pressEnd);
        btn.addEventListener("pointerleave", pressEnd);
        btn.addEventListener("pointercancel", pressEnd);

        // Fallback for basic touch (safety net)
        btn.addEventListener("touchstart", function (e) {
            // pointerdown should fire first, but catch edge cases
            pressStart(e);
        }, { passive: false });
        btn.addEventListener("touchend", function (e) {
            pressEnd(e);
        }, { passive: false });
        btn.addEventListener("touchcancel", function (e) {
            pressEnd(e);
        }, { passive: false });

        // Prevent context menu on long-press
        btn.addEventListener("contextmenu", function (e) {
            e.preventDefault();
        });
    });

    // --- Bust tap (immediate emit, no pressed field) ---
    (function () {
        var action = bustBtn.getAttribute("data-action");
        if (!action) return;

        function emitBustTap() {
            if (!socket || !connected) return;
            if (!isControlEnabled(action)) return;
            socket.emit("controller_input", { action: "bust" });
        }

        function startBust(e) {
            e.preventDefault();
            if (!isControlEnabled(action)) return;
            bustBtn.classList.add("pressed");
            emitBustTap();
        }
        function endBust(e) {
            e.preventDefault();
            bustBtn.classList.remove("pressed");
            // Do NOT emit a release for Bust - only the single tap event
        }

        bustBtn.addEventListener("pointerdown", startBust);
        bustBtn.addEventListener("pointerup", endBust);
        bustBtn.addEventListener("pointerleave", endBust);
        bustBtn.addEventListener("pointercancel", endBust);
        bustBtn.addEventListener("touchstart", startBust, { passive: false });
        bustBtn.addEventListener("touchend", endBust, { passive: false });
        bustBtn.addEventListener("touchcancel", endBust, { passive: false });
        bustBtn.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    })();

    // --- Action buttons ---
    function wireActionBtn(btn) {
        var action = btn.getAttribute("data-action");
        if (!action) return;

        function startAction(e) {
            e.preventDefault();
            if (!isControlEnabled(action)) return;
            btn.classList.add("pressed");
            emitAction(action, true);
        }
        function endAction(e) {
            e.preventDefault();
            btn.classList.remove("pressed");
            emitAction(action, false);
        }

        btn.addEventListener("pointerdown", startAction);
        btn.addEventListener("pointerup", endAction);
        btn.addEventListener("pointerleave", endAction);
        btn.addEventListener("pointercancel", endAction);
        btn.addEventListener("touchstart", startAction, { passive: false });
        btn.addEventListener("touchend", endAction, { passive: false });
        btn.addEventListener("touchcancel", endAction, { passive: false });
        btn.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    }

    [acceptBtn, cheatBtn, voteBtn].forEach(function (btn) {
        if (btn) wireActionBtn(btn);
    });

    // --- Wire connect button ---
    connectBtn.addEventListener("click", toggleConnection);

    // --- Auto-connect on page load (if host is set) ---
    connect();

    // --- Expose for debugging ---
    window.__controller = {
        socket: function () { return socket; },
        connected: function () { return connected; },
        connect: connect,
        disconnect: disconnect
    };
})();
