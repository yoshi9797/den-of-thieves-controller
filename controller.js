// --- 1. FIREBASE CONFIGURATION ---
// Paste your actual config object found in the Firebase Console settings
const firebaseConfig = {
    apiKey: "AIzaSyAKGgBoLeUcsoEwA9u6f3RdvxJYRwKID0g",
    databaseURL: "https://den-of-thieves-bridge-default-rtdb.firebaseio.com",
    projectId: "den-of-thieves-bridge"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// --- 2. WEBRTC NETWORKING VARIABLES ---
let peerConnection = null;
let dataChannel = null;
let roomCode = "";
let myPeerId = Math.floor(Math.random() * 100000) + 2; // Unique Player ID (2+)

// --- 3. CONNECT TO STEAM HOST VIA CLOUD ROOM CODE ---
function connectToLobby() {
    roomCode = document.getElementById("room-code").value.trim().toUpperCase();
    const name = document.getElementById("player-name").value.trim();
    
    if (roomCode.length !== 4 || !name) {
        updateStatus("Enter a valid name and 4-letter room code.");
        return;
    }

    updateStatus("Searching for room " + roomCode + "...");

    // Query Firebase for this room's reference path
    const roomRef = database.ref(`rooms/${roomCode}`);
    
    roomRef.once('value').then((snapshot) => {
        const roomData = snapshot.val();
        if (!roomData || !roomData.host_online) {
            updateStatus("Room not found! Check the host monitor.");
            return;
        }

        // Initialize WebRTC
        setupWebRTCPeer(roomRef, name);
    });
}

function setupWebRTCPeer(roomRef, playerName) {
    updateStatus("Connecting directly to game host..." + roomRef + "  " + playerName);
    
    // Use free public STUN servers so firewalls don't block the phone
    peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    // Create the high-speed data transmission channel
    dataChannel = peerConnection.createDataChannel("game-inputs", { ordered: false });

    dataChannel.onopen = () => {
        updateStatus("Connected!");
        document.getElementById("login-screen").classList.add("hidden");
        document.getElementById("gamepad-screen").classList.remove("hidden");
        
        // Send introduction handshake packet
        sendInput("player_join", playerName);
    };

    dataChannel.onclose = () => {
        resetToLogin("Disconnected from game session.");
    };

    // Create the WebRTC Connection "Offer" to hand to the host
    peerConnection.createOffer().then((offer) => {
        return peerConnection.setLocalDescription(offer);
    }).then(() => {
        // Upload our mobile phone's handshake signal directly into the room's database slot
        roomRef.child(`players/${myPeerId}`).set({
            name: playerName,
            offer: JSON.stringify(peerConnection.localDescription)
        });
        print(`players/${myPeerId}`)
    });

    // Listen for the host PC's WebRTC response ("Answer")
    roomRef.child(`players/${myPeerId}/answer`).on('value', (snapshot) => {
        const answer = snapshot.val();
        if (answer && peerConnection.signalingState !== "stable") {
            peerConnection.setRemoteDescription(new RTCSessionDescription(JSON.parse(answer)));
        }
    });
}

// --- 4. STREAM CONTROLLER ACTIONS TO GODOT ENGINE ---
function sendInput(actionName, value) {
    if (dataChannel && dataChannel.readyState === "open") {
        const packet = JSON.stringify({
            peer_id: myPeerId,
            action: actionName,
            pressed: value
        });
        dataChannel.send(packet);
    }
}

function updateStatus(msg) {
    document.getElementById("status-text").textContent = msg;
}

function resetToLogin(msg) {
    document.getElementById("login-screen").classList.remove("hidden");
    document.getElementById("gamepad-screen").classList.add("hidden");
    updateStatus(msg);
}