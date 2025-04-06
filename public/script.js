// === Socket.IO Connection ===
let socket;
const SERVER_URL = '/';

// === DOM Elements (Khai báo biến trước) ===
let joinSection, watchSection, usernameInput, roomIdInput, joinBtn, joinError, roomInfoDisplay,
    playerWrapper, playerElement, playBtn, pauseBtn, seekBar, timeDisplay,
    videoIdInput, changeVideoBtn, userList, chatOutput, chatInput, sendChatBtn, errorDisplay;

// === State Variables ===
let player; let playerReady = false; let currentRoomId = null;
let myUsername = localStorage.getItem('coupleflix_username_basic') || ''; // Giữ key cũ
let localStateChange = false; // Flag to indicate if change was initiated by server sync
let seekUpdateInterval;
let lastSyncData = {}; // Store last received sync data for comparison

// === FUNCTION DEFINITIONS ===

function getDOMElements() {
    console.log("Getting DOM Elements...");
    joinSection = document.getElementById('join-section');
    watchSection = document.getElementById('watch-section');
    usernameInput = document.getElementById('username-input');
    roomIdInput = document.getElementById('room-id-input');
    joinBtn = document.getElementById('join-btn');
    joinError = document.getElementById('join-error');
    roomInfoDisplay = document.getElementById('room-id-display');
    playerWrapper = document.getElementById('player-wrapper');
    playerElement = document.getElementById('player');
    playBtn = document.getElementById('play-btn'); // Nút control cũ
    pauseBtn = document.getElementById('pause-btn'); // Nút control cũ
    seekBar = document.getElementById('seek-bar');   // Seek bar cũ
    timeDisplay = document.getElementById('time-display'); // Time display cũ
    videoIdInput = document.getElementById('video-id-input'); // Input ID cũ
    changeVideoBtn = document.getElementById('change-video-btn');
    userList = document.getElementById('user-list');
    chatOutput = document.getElementById('chat-output');
    chatInput = document.getElementById('chat-input');
    sendChatBtn = document.getElementById('send-chat-btn');
    errorDisplay = document.getElementById('error-display');
    console.log("DOM Elements obtained.");
}

function connectSocket() {
    if (socket && socket.connected) { console.log("Socket already connected."); return; }
    if (socket) socket.disconnect();
    console.log("Connecting to Socket.IO...");
    try {
        socket = io(SERVER_URL);
        setupSocketListeners();
    } catch(error){
        console.error("Socket connection failed immediately:", error);
        displayGlobalError("Không thể kết nối tới server.");
    }
}

function setupSocketListeners(){
    if (!socket) { console.error("Socket not initialized for listeners."); return; }
    console.log("Setting up socket listeners...");
    // Remove previous listeners first
    socket.off('connect'); socket.off('disconnect'); socket.off('connect_error');
    socket.off('room_state'); socket.off('video_action_sync'); socket.off('user_joined');
    socket.off('user_left'); socket.off('chat_message'); socket.off('system_message');
    socket.off('error_message'); socket.off('join_error');

    // Add new listeners
    socket.on('connect', () => { console.log('Connected!', socket.id); displayGlobalError(''); if(joinBtn) joinBtn.disabled = false; });
    socket.on('disconnect', (reason) => { console.warn('Disconnected:', reason); displayGlobalError(`Mất kết nối: ${reason}`); resetUI(); if(joinBtn) joinBtn.disabled = true; });
    socket.on('connect_error', (err) => { console.error('Connection Error:', err); displayGlobalError(`Lỗi kết nối: ${err.message}`); resetUI(); if(joinBtn) joinBtn.disabled = true; });
    socket.on('room_state', handleRoomState);
    socket.on('video_action_sync', handleVideoActionSync);
    socket.on('user_joined', handleUserJoined);
    socket.on('user_left', handleUserLeft);
    socket.on('chat_message', handleChatMessage);
    socket.on('system_message', (message) => addChatMessage(message, 'Hệ thống', true));
    socket.on('error_message', displayJoinError);
    socket.on('join_error', displayJoinError);
    console.log("Socket listeners set up.");
}

// --- Event Handlers ---
function handleRoomState(data) {
    console.log('Room State Received:', data);
    if (!data || !data.videoId || !data.roomId) { console.error("Invalid room_state received"); return; }
    currentRoomId = data.roomId; // Set room ID from server confirmation
    showWatchSection(); // Show the watch area
    updateUserList(data.users);
    updateRoomInfo(currentRoomId, Object.keys(data.users || {}).length);
    syncPlayerState(data.videoId, data.state, data.time); // Sync player
}

function handleVideoActionSync(data) {
     console.log(`<<< Sync Received: Action=${data.action}, Time=${data.time?.toFixed(2)}`, data);
     if (!playerReady) { console.warn("Sync ignored: Player not ready."); return; }

     // Store last sync data for potential comparison in state change handler
     lastSyncData = { action: data.action, time: data.time, receivedAt: Date.now() };
     localStateChange = true; // Mark as server-initiated change *before* actions

     try {
        let currentState = player.getPlayerState();
        let targetTime = data.time !== undefined ? data.time : player.getCurrentTime();

        switch (data.action) {
            case 'play':
                // Only play if not already playing/buffering
                if (currentState !== YT.PlayerState.PLAYING && currentState !== YT.PlayerState.BUFFERING) {
                    console.log("<<< Sync Action: Playing video");
                    player.playVideo(); // Player API call
                } else {
                     console.log("<<< Sync Action: Play ignored, state is already", currentState);
                     localStateChange = false; // No action taken, reset flag immediately
                }
                break;
            case 'pause':
                 // Seek first if needed, using targetTime
                 if (Math.abs(player.getCurrentTime() - targetTime) > 1.5) {
                     console.log(`<<< Sync Action: Seeking to ${targetTime.toFixed(2)} before pausing`);
                     // Note: Seeking might trigger its own state change, localStateChange should handle it
                     player.seekTo(targetTime, true); // Player API call
                 }
                 // Only pause if currently playing
                 if (currentState === YT.PlayerState.PLAYING) {
                    console.log("<<< Sync Action: Pausing video");
                    player.pauseVideo(); // Player API call
                 } else {
                      console.log("<<< Sync Action: Pause ignored, state is", currentState);
                      // Still update seek bar display to the sync time
                      updateSeekBarDisplayWithValue(targetTime);
                      localStateChange = false; // No action taken, reset flag immediately
                 }
                break;
            case 'seek':
                 if (data.time !== undefined) {
                     const current = player.getCurrentTime();
                     if (Math.abs(current - data.time) > 1.0) { // Seek threshold
                         console.log(`<<< Sync Action: Seeking from ${current.toFixed(2)} to ${data.time.toFixed(2)}`);
                         player.seekTo(data.time, true); // Player API call
                         updateSeekBarDisplayWithValue(data.time); // Update UI immediately
                     } else {
                         console.log(`<<< Sync Action: Seek diff small (${Math.abs(current-data.time)}), skipping.`);
                         localStateChange = false; // No action taken, reset flag immediately
                     }
                 } else {
                      console.warn("<<< Sync Action: Seek received without time.");
                      localStateChange = false; // Reset flag
                 }
                break;
            default:
                 console.warn(`<<< Sync Action: Unknown action '${data.action}'`);
                 localStateChange = false; // Reset flag
                 break;
        }
     } catch (e) {
         console.error("Error applying video sync:", e);
         localStateChange = false; // Reset flag on error
    }
    // Do NOT reset flag with timeout here. Let onPlayerStateChange handle it.
}
function handleUserJoined(data) { if (!data?.username || !data?.users) return; addChatMessage(`${data.username} đã tham gia.`, 'Hệ thống', true); updateUserList(data.users); updateRoomInfo(currentRoomId, Object.keys(data.users).length); }
function handleUserLeft(data) { if (!data?.username || !data?.users) return; addChatMessage(`${data.username} đã rời phòng.`, 'Hệ thống', true); updateUserList(data.users); updateRoomInfo(currentRoomId, Object.keys(data.users).length); }
function handleChatMessage(data) { if (!data?.user || !data?.message) return; const isMyMsg = data.user === myUsername; addChatMessage(data.message, data.user, false, isMyMsg); }

// === UI Update Functions ===
function showWatchSection() { if(joinSection) joinSection.classList.add('hidden'); if(watchSection) watchSection.classList.remove('hidden'); }
function showJoinSection() { if(watchSection) watchSection.classList.add('hidden'); if(joinSection) joinSection.classList.remove('hidden'); }
function updateRoomInfo(roomId, userCount) { if(roomInfoDisplay) roomInfoDisplay.innerHTML = `Phòng: <strong>${roomId || 'N/A'}</strong> | Người xem: <strong>${userCount}</strong>`; }
function updateUserList(usersObj = {}) { if (!userList) return; userList.innerHTML = ''; const users = Object.values(usersObj || {}); if (users.length === 0 && currentRoomId) { userList.innerHTML = '<li>Chỉ có mình bạn</li>'; return; } if (!currentRoomId) { userList.innerHTML = '<li>Chưa vào phòng</li>'; return; } users.forEach(username => { const li = document.createElement('li'); li.textContent = username; if (username === myUsername) li.classList.add('you'); userList.appendChild(li); }); }
function addChatMessage(message, user, isSystem = false, isMyMessage = false) { if (!chatOutput) return; const p = document.createElement('p'); if (isSystem) { p.classList.add('system'); p.textContent = message; } else { p.classList.add(isMyMessage ? 'my-message' : 'other-message'); const strong = document.createElement('strong'); strong.textContent = user + ': '; if (!isMyMessage) p.appendChild(strong); p.appendChild(document.createTextNode(message)); } chatOutput.appendChild(p); chatOutput.scrollTop = chatOutput.scrollHeight; }
function displayJoinError(message) { if(joinError) joinError.textContent = message; }
function displayGlobalError(message) { if(errorDisplay) errorDisplay.textContent = message; clearTimeout(window.globalErrorTimeout); if (message) window.globalErrorTimeout = setTimeout(() => { if(errorDisplay) errorDisplay.textContent = ''; }, 8000); }
function resetUI() { showJoinSection(); if(roomInfoDisplay) roomInfoDisplay.textContent = 'Chưa kết nối'; if(userList) userList.innerHTML = '<li>(Chưa kết nối)</li>'; if (playerReady) { try { player.stopVideo(); } catch (e) {} } resetSeekBarDisplay(); stopSeekBarUpdate(); currentRoomId = null; if(playBtn) playBtn.disabled = true; if(pauseBtn) pauseBtn.disabled = true; if(seekBar) seekBar.disabled = true;}

// === Player Controls & Sync ===
function syncPlayerState(videoId, state, time) {
    if (!playerReady) { console.warn("Sync: Player not ready."); return; }
    console.log(`Syncing Full State: ID=${videoId}, State=${state}, Time=${time?.toFixed(2)}`);
    localStateChange = true; // Mark changes as server-initiated

    try {
        const currentId = player.getVideoData()?.video_id;
        let videoChanged = currentId !== videoId;

        if (videoChanged && videoId) {
            console.log(`Sync: Loading video ${videoId}`);
            // Store intended state/time to apply AFTER video loads
            player._intendedState = state;
            player._intendedTime = time || 0;
            player.loadVideoById(videoId);
            resetSeekBarDisplay();
            // Let onPlayerStateChange handle syncing after load
            return;
        }

        // --- If video ID is the same ---
        console.log("Sync: Same video. Setting time/state.");
        const targetTime = time || 0;
        const currentTime = player.getCurrentTime();
        const currentState = player.getPlayerState();

        // 1. Seek IF NEEDED (significant difference)
        let seekNeeded = Math.abs(currentTime - targetTime) > 1.5;
        if (seekNeeded) {
            console.log(`Sync (same video): Seeking to ${targetTime.toFixed(2)}`);
            player.seekTo(targetTime, true);
        }

        // 2. Set Play/Pause State IF NEEDED
        // Wait slightly ONLY if seek happened, otherwise apply immediately
        setTimeout(() => {
             localStateChange = true; // Ensure flag is true before action
             const currentStateAfterSeek = player.getPlayerState(); // Check state again
             if (state === YT.PlayerState.PLAYING && currentStateAfterSeek !== YT.PlayerState.PLAYING && currentStateAfterSeek !== YT.PlayerState.BUFFERING) {
                 console.log("Sync (same video): Playing"); player.playVideo();
             } else if (state !== YT.PlayerState.PLAYING && currentStateAfterSeek === YT.PlayerState.PLAYING) {
                 console.log("Sync (same video): Pausing"); player.pauseVideo();
             } else {
                  // No state change needed, potentially reset flag earlier if seek also didn't happen
                  if (!seekNeeded) localStateChange = false;
             }
             // Update UI immediately after attempting state change
             updateSeekBarDisplayWithValue(player.getCurrentTime()); // Use actual player time after actions

             // Reset flag after a very short delay
             setTimeout(() => { if (localStateChange) { console.log("Resetting localStateChange (timeout after same video sync)"); localStateChange = false; } }, 100);

        }, seekNeeded ? 150 : 0); // Delay only if seek occurred

    } catch (e) { console.error("Sync Player Error:", e); localStateChange = false; }
    // Don't reset flag globally here
}
function emitVideoAction(action, time = null) { if (!socket || !currentRoomId || !playerReady) return; const data = { action: action }; if (time !== null && typeof time === 'number') data.time = time; console.log('Emit:', data); socket.emit('video_action', data); }
function formatTime(seconds) { if (isNaN(seconds) || seconds < 0) return "0:00"; const min = Math.floor(seconds / 60); const sec = Math.floor(seconds % 60); return `${min}:${sec < 10 ? '0' : ''}${sec}`; }
function updateSeekBarDisplay() { if (!playerReady || !player.getDuration || !seekBar || !timeDisplay) return; const cur = player.getCurrentTime() || 0; const dur = player.getDuration() || 0; if (dur > 0) { seekBar.max = dur; seekBar.value = cur; timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`; } else { resetSeekBarDisplay(); } }
function updateSeekBarDisplayWithValue(time) { if (!playerReady || !player.getDuration || !seekBar || !timeDisplay) return; const dur = player.getDuration() || 0; if (dur > 0) { seekBar.max = dur; seekBar.value = time; timeDisplay.textContent = `${formatTime(time)} / ${formatTime(dur)}`; } else { resetSeekBarDisplay(); } }
function resetSeekBarDisplay() { if (!seekBar || !timeDisplay) return; seekBar.max = 1; seekBar.value = 0; timeDisplay.textContent = "0:00 / 0:00"; }
function startSeekBarUpdate() { stopSeekBarUpdate(); seekUpdateInterval = setInterval(() => { if (playerReady && player.getPlayerState && player.getPlayerState() === YT.PlayerState.PLAYING) updateSeekBarDisplay(); }, 1000); }
function stopSeekBarUpdate() { clearInterval(seekUpdateInterval); }
function updateVideoDuration() { if (playerReady && player.getDuration && seekBar) { const dur = player.getDuration() || 0; if (dur > 0) seekBar.max = dur; updateSeekBarDisplay(); } }
function extractYouTubeId(urlOrId) {
    // console.log(`--- extractYouTubeId called with: "${urlOrId}"`);
    if (!urlOrId) return null;
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = urlOrId.match(regex);
    if (match && match[1]) return match[1];
    if (urlOrId.length === 11 && /^[a-zA-Z0-9_-]+$/.test(urlOrId)) return urlOrId;
    console.warn("--- extractYouTubeId: No valid ID found.");
    return null;
}

// *** Define YT Player Callbacks FIRST ***
function onPlayerReady(event) {
    console.log("Player Is Ready!");
    playerReady = true;
    if(playBtn) playBtn.disabled = false; if(pauseBtn) pauseBtn.disabled = false; if(seekBar) seekBar.disabled = false;
    updateSeekBarDisplay(); startSeekBarUpdate();
}
function onPlayerStateChange(event) {
    if (!playerReady) return;
    const newState = event.data;
    const playerCurrentTime = player.getCurrentTime();
    console.log(`Player State Changed: ${newState}, Current Time: ${playerCurrentTime.toFixed(2)}`);
    updateVideoDuration();

    // *** CRITICAL: Reset localStateChange if this event was triggered by a sync action ***
    if (localStateChange) {
        console.log(`   [State Change during Sync] Flag is true. Last sync: Action=${lastSyncData.action}, Time=${lastSyncData.time?.toFixed(2)}`);
        // More robust check: Is the NEW state CONSISTENT with the sync action?
        // e.g., after PLAY sync, state becomes PLAYING or BUFFERING
        // e.g., after PAUSE sync, state becomes PAUSED
        // e.g., after SEEK sync, state might change briefly then return, or stay same. Check time.
        let matchesSync = false;
        if (lastSyncData.action === 'play' && (newState === YT.PlayerState.PLAYING || newState === YT.PlayerState.BUFFERING)) matchesSync = true;
        else if (lastSyncData.action === 'pause' && newState === YT.PlayerState.PAUSED) matchesSync = true;
        else if (lastSyncData.action === 'seek' && Math.abs(playerCurrentTime - (lastSyncData.time || 0)) < 1.5) matchesSync = true;
         // Check state after loadVideoById (state should be CUED(5) or UNSTARTED(-1) initially)
        else if (lastSyncData.action === 'change_video' && (newState === YT.PlayerState.CUED || newState === YT.PlayerState.UNSTARTED)) matchesSync = true;

        if (matchesSync) {
            console.log("   [State Change during Sync] New state consistent with sync. Resetting flag.");
            localStateChange = false; // Reset flag
        } else {
             // This might be an intermediate state (like BUFFERING after seek before PLAYING)
             // or an unexpected state. Keep the flag true for now.
             console.warn("   [State Change during Sync] New state might be intermediate or unexpected. Flag kept true.");
        }

        // Update UI based on the *actual* new state
        if (newState === YT.PlayerState.PLAYING) startSeekBarUpdate(); else stopSeekBarUpdate();

         // *** Apply intended state/time after video loads and cues ***
         if (player._intendedState !== undefined && (newState === YT.PlayerState.CUED || newState === YT.PlayerState.PLAYING || newState === YT.PlayerState.PAUSED)) {
             console.log(`Applying intended state after load: State=${player._intendedState}, Time=${player._intendedTime?.toFixed(2)}`);
             const intendedState = player._intendedState;
             const intendedTime = player._intendedTime;
             delete player._intendedState; delete player._intendedTime; // Clear stored state

             localStateChange = true; // Mark as sync-initiated

             if (Math.abs(player.getCurrentTime() - intendedTime) > 0.5) {
                 console.log(`Applying intended seek: ${intendedTime.toFixed(2)}`);
                 player.seekTo(intendedTime, true);
             }
             setTimeout(() => { // Delay play/pause slightly after seek
                 localStateChange = true;
                 const stateAfterSeek = player.getPlayerState();
                 if (intendedState === YT.PlayerState.PLAYING && stateAfterSeek !== YT.PlayerState.PLAYING && stateAfterSeek !== YT.PlayerState.BUFFERING) {
                     console.log("Applying intended Play"); player.playVideo();
                 } else if (intendedState !== YT.PlayerState.PLAYING && stateAfterSeek === YT.PlayerState.PLAYING) {
                     console.log("Applying intended Pause"); player.pauseVideo();
                 } else {
                      localStateChange = false; // No state change needed
                 }
                 updateSeekBarDisplay();
                 setTimeout(() => { if (localStateChange) { console.log("Resetting localStateChange (timeout after intended state)"); localStateChange = false; } }, 100);
             }, 100);
         }

        return; // IMPORTANT: Stop processing if it was a sync-triggered change
    }

    // If change was NOT from sync (local user interaction, video end, etc.)
    if (!socket || !currentRoomId) return;
    console.log("State change seems local/natural, emitting action...");
    switch (newState) { case YT.PlayerState.PLAYING: emitVideoAction('play'); startSeekBarUpdate(); break; case YT.PlayerState.PAUSED: emitVideoAction('pause', player.getCurrentTime()); stopSeekBarUpdate(); break; case YT.PlayerState.ENDED: stopSeekBarUpdate(); break; case YT.PlayerState.BUFFERING: stopSeekBarUpdate(); break; }
}
function onPlayerError(event) { console.error("YT Player Error Code:", event.data); displayGlobalError(`Lỗi YouTube Player: ${event.data}`); }

// === YouTube API Callback (Global Scope) ===
function onYouTubeIframeAPIReady() { console.log("YT API Ready callback fired."); if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', createYTPlayer); } else { createYTPlayer(); } }
function createYTPlayer() { console.log("Attempting YT Player creation..."); const playerDiv = document.getElementById('player'); if (!playerDiv) { console.error("Player element (#player) not found."); return; } try { player = new YT.Player(playerDiv, { height: '100%', width: '100%', videoId: 'dQw4w9WgXcQ', playerVars: { 'playsinline': 1, 'controls': 0, 'disablekb': 1, 'modestbranding': 1, 'rel': 0 }, events: { 'onReady': onPlayerReady, 'onStateChange': onPlayerStateChange, 'onError': onPlayerError } }); console.log("YT Player instance potentially created."); } catch (error) { console.error("Error creating YT Player instance:", error); displayGlobalError("Không thể khởi tạo trình phát video."); } }

// *** Define sendChatMessage BEFORE setupEventListeners ***
function sendChatMessage() { if (!chatInput) return; const message = chatInput.value.trim(); if (message && socket && currentRoomId) { socket.emit('chat_message', { message: message }); chatInput.value = ''; } }

// === Event Listeners Setup ===
function setupEventListeners() {
    console.log("Setting up event listeners...");
    if (!joinBtn) { console.error("Cannot find Join Button in setupEventListeners!"); return; }

    joinBtn.addEventListener('click', () => {
        console.log(">>> Join button clicked!");
        if (!usernameInput || !roomIdInput) { console.error("!!! Join inputs missing!"); return; }
        const username = usernameInput.value.trim();
        const roomId = roomIdInput.value.trim();
        if (!username || !roomId) return displayJoinError("Nhập đủ tên và ID phòng.");

        myUsername = username; localStorage.setItem('coupleflix_username_basic', myUsername);
        displayJoinError('');
        let attemptedRoomId = roomId;
        console.log(`Attempting to join room: ${attemptedRoomId} as ${username}`);

        if (!socket || !socket.connected) {
             console.warn("!!! Socket not connected. Attempting connection...");
             connectSocket(); // Ensure connection attempt
             joinBtn.disabled = true; joinBtn.textContent = 'Đang kết nối...';
             displayGlobalError("Đang kết nối tới server...");
             setTimeout(() => {
                 if (socket && socket.connected) {
                     console.log(">>> Emitting join_room (after connect)...");
                     socket.emit('join_room', { roomId: attemptedRoomId, username });
                     // Wait for room_state to enable button and switch UI
                 } else {
                     console.error("!!! Failed to connect before joining.");
                     displayGlobalError("Không thể kết nối tới server. Vui lòng thử lại.");
                     joinBtn.disabled = false; joinBtn.textContent = 'Vào'; // Re-enable on failure
                 }
             }, 1500);
        } else {
             console.log(">>> Emitting join_room (connected)...");
             socket.emit('join_room', { roomId: attemptedRoomId, username });
             // Wait for room_state to switch UI
        }
    });
    console.log(">>> Join button listener attached.");

    // Old Controls Listeners
    if (playBtn) playBtn.addEventListener('click', () => { if (playerReady && !localStateChange) emitVideoAction('play'); });
    if (pauseBtn) pauseBtn.addEventListener('click', () => { if (playerReady && !localStateChange) emitVideoAction('pause', player.getCurrentTime()); });
    if (seekBar) {
        seekBar.addEventListener('change', () => { if (playerReady && !localStateChange) emitVideoAction('seek', parseFloat(seekBar.value)); startSeekBarUpdate(); });
        seekBar.addEventListener('input', () => { stopSeekBarUpdate(); if (playerReady && timeDisplay) timeDisplay.textContent = `${formatTime(seekBar.value)} / ${formatTime(player.getDuration() || 0)}`; });
    }
    // Change Video Listener
    if (changeVideoBtn && videoIdInput) {
         changeVideoBtn.addEventListener('click', () => {
             console.log(">>> Change Video button clicked!");
             const input = videoIdInput.value.trim();
             const videoId = extractYouTubeId(input); // Use extractor
             console.log(">>> Extracted Video ID:", videoId);
             if (videoId) {
                 const currentVideoIdOnPlayer = playerReady ? player.getVideoData()?.video_id : null;
                 if (videoId !== currentVideoIdOnPlayer) {
                     console.log(">>> Emitting change_video action for ID:", videoId);
                     socket.emit('video_action', { action: 'change_video', videoId: videoId });
                     videoIdInput.value = '';
                 } else { console.warn(">>> Video ID is the same as current."); displayGlobalError("Video này đang được chọn."); }
             } else { console.warn(">>> Invalid YouTube URL or ID."); displayGlobalError("Nhập YouTube Video ID hoặc Link hợp lệ."); }
         });
         console.log(">>> Change video listener attached.");
    } else { console.error("!!! Change video button or input not found!");}

    // Chat Listeners
    if (sendChatBtn && chatInput) {
        sendChatBtn.addEventListener('click', sendChatMessage);
        chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChatMessage(); });
    } else { console.error("!!! Chat button or input not found!");}

    console.log("Event listeners attached.");
}

// === MAIN EXECUTION ===
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Ready");
    getDOMElements();
    if (!joinBtn || !playerElement) { console.error("CRITICAL: Essential elements missing!"); alert("Lỗi tải giao diện!"); return; }
    setupEventListeners(); // Gắn listener SAU KHI hàm được định nghĩa
    if(usernameInput) usernameInput.value = myUsername; // Điền tên đã lưu
    // Khởi tạo kết nối socket, ban đầu nút join sẽ bị disable
    if (joinBtn) joinBtn.disabled = true;
    connectSocket();
    console.log("Initial script setup complete.");
    resetUI(); // Bắt đầu ở màn hình Join
});

console.log("CoupleFlix Basic Script Loaded (v13 Sync Refined v2). Waiting for DOMContentLoaded...");