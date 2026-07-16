// --- OFFICIAL project CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyAKGgBoLeUcsoEwA9u6f3RdvxJYRwKID0g",
    databaseURL: "https://den-of-thieves-bridge-default-rtdb.firebaseio.com",
    projectId: "den-of-thieves-bridge"
};

const STUN_CONFIGURATION = {
    iceServers: [
        { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }
    ]
};

// --- CLIENT STATE VARIABLES ---
let roomCode = "";
let playerId = "";
let peerConnection = null;
let dataChannel = null;
let pollingInterval = null;

// --- INITIALIZE EVENT HANDLING LAYER ---
window.addEventListener("DOMContentLoaded", () => {
    // Unique device session token initialization
    playerId = "client_" + Math.random().toString(36).substring(2, 9) + Date.now().toString().substring(7);
    console.log("Device unique session initialized:", playerId);

    // Dynamic parameter sniffing from companion QR URLs
    const urlParams = new URLSearchParams(window.location.search);
    const scannedRoom = urlParams.get("room");
    if (scannedRoom) {
        document.getElementById("room-input").value = scannedRoom.toUpperCase();
    }

    document.getElementById("join-form").addEventListener("submit", handleJoinRequest);
});

/**
 * Executes authorization requests and runs local WebRTC allocation blocks.
 */
async function handleJoinRequest(event) {
    event.preventDefault();
    roomCode = document.getElementById("room-input").value.trim().toUpperCase();
    const playerName = document.getElementById("name-input").value.trim() || "Sneaky Thief";
    const errorBanner = document.getElementById("error-msg");

    // Hide any previous error messages
    errorBanner.style.display = "none";

    if (!roomCode || roomCode.length !== 4) {
        errorBanner.innerText = "Invalid Lobby Code Length!";
        errorBanner.style.display = "block";
        return;
    }

    try {
        // 🌟 STEP 1: VALIDATION CHECK (Verify Room Metadata Exists)
        const roomCheckResponse = await fetch(`${firebaseConfig.databaseURL}/rooms/${roomCode}/room_metadata.json`);
        const roomMetadata = await roomCheckResponse.json();

        // If Firebase returns null, it means the room code does not exist
        if (!roomMetadata) {
            errorBanner.innerText = "Lobby Code Not Found!";
            errorBanner.style.display = "block";
            return;
        }

        // 🌟 STEP 2: PROCEED WITH CONNECTION (If Room Is Valid)
        updateUIVisibility("connecting");

        peerConnection = new RTCPeerConnection(STUN_CONFIGURATION);

        dataChannel = peerConnection.createDataChannel("game_controls", {
            ordered: true
        });
        setupDataChannelSignals(dataChannel);

        peerConnection.onicecandidate = (e) => {
            if (e.candidate) {
                uploadLocalCandidateToFirebase(e.candidate);
            }
        };

        const localOffer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(localOffer);

        const registrationPayload = {
            name: playerName,
            offer: {
                type: localOffer.type,
                sdp: localOffer.sdp
            }
        };

        const response = await fetch(`${firebaseConfig.databaseURL}/rooms/${roomCode}/players/${playerId}.json`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(registrationPayload)
        });

        if (!response.ok) throw new Error("Database directory allocation failed.");
        console.log("Registration successfully uploaded to active Firebase buffer lanes.");

        startFirebaseAnswerPolling();

    } catch (err) {
        console.error("Handshake initialization failure:", err);
        errorBanner.innerText = "Network Error. Try Again.";
        errorBanner.style.display = "block";
        updateUIVisibility("lobby");
    }
}

/**
 * Handles WebRTC data channel events.
 */
function setupDataChannelSignals(channel) {
    channel.onopen = () => {
        console.log("⚡ P2P Direct Transit Pipe Established! Firebase signaling can drop out.");
        clearInterval(pollingInterval); // Stop polling cloud database nodes
        updateUIVisibility("gamepad");
        bindGamepadInputs();
    };

    channel.onclose = () => {
        console.log("Connection severed cleanly by host boundary layers.");
        handleGracefulShutdown();
    };
}

/**
 * Poll-checking loop parsing the explicit player child directory.
 */
function startFirebaseAnswerPolling() {
    pollingInterval = setInterval(async () => {
        try {
            const res = await fetch(`${firebaseConfig.databaseURL}/rooms/${roomCode}/players/${playerId}/answer.json`);
            const answerData = await res.json();

            if (answerData && answerData.sdp) {
                clearInterval(pollingInterval);
                console.log("Answer SDP compiled from Godot host received.");
                
                // Finalize local handshake tracking values
                await peerConnection.setRemoteDescription(new RTCSessionDescription(answerData));
            }
        } catch (e) {
            console.error("Error checking answer loops:", e);
        }
    }, 1500);
}

/**
 * Posts local ICE candidate pathways sequentially into an array structure.
 */
async function uploadLocalCandidateToFirebase(candidate) {
    if (!roomCode || !playerId) return;
    
    const payload = {
        media: candidate.sdpMid,
        index: candidate.sdpMLineIndex,
        name: candidate.candidate
    };

    try {
        await fetch(`${firebaseConfig.databaseURL}/rooms/${roomCode}/players/${playerId}/caller_candidates.json`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        console.error("Failed uploading candidate:", e);
    }
}

/**
 * Maps screen interaction updates to real-time WebRTC string packages.
 */
function bindGamepadInputs() {
    const inputButtons = document.querySelectorAll(".game-btn");
    
    inputButtons.forEach(button => {
        const actionName = button.getAttribute("data-action");

        const sendInput = (state) => {
            if (dataChannel && dataChannel.readyState === "open") {
                const payload = {
                    type: "input",
                    button: actionName,
                    state: state // "pressed" or "released"
                };
                dataChannel.send(JSON.stringify(payload));
            }
        };

        // Parallel mapping handling mobile touch arrays alongside testing desktops
        button.addEventListener("touchstart", (e) => { e.preventDefault(); sendInput("pressed"); });
        button.addEventListener("touchend", (e) => { e.preventDefault(); sendInput("released"); });
        button.addEventListener("mousedown", () => sendInput("pressed"));
        button.addEventListener("mouseup", () => sendInput("released"));
    });
}

/**
 * Document view display management module.
 */
function updateUIVisibility(state) {
    document.getElementById("lobby-screen").style.display = state === "lobby" ? "block" : "none";
    document.getElementById("connecting-screen").style.display = state === "connecting" ? "block" : "none";
    document.getElementById("gamepad-screen").style.display = state === "gamepad" ? "block" : "none";
}

function handleGracefulShutdown() {
    if (pollingInterval) clearInterval(pollingInterval);
    if (dataChannel) dataChannel.close();
    if (peerConnection) peerConnection.close();
    updateUIVisibility("lobby");
    alert("Disconnected from host session.");
}

// Perform automated data removal queries if user intentionally leaves the session page
window.addEventListener("beforeunload", () => {
    if (roomCode && playerId) {
        navigator.sendBeacon(`${firebaseConfig.databaseURL}/rooms/${roomCode}/players/${playerId}.json?x-http-method-override=DELETE`, "");
    }
});