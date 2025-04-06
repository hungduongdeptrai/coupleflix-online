const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// YT States Constant - Đặt lên đầu
const YT = {
    PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 }
};

app.use(express.static(path.join(__dirname, 'public')));

// --- Data Structures (Simplified) ---
const rooms = {};
// { roomId: { users: { socketId: username }, videoId: '...', state: YT.PlayerState, time: 0 } }

io.on('connection', (socket) => {
    console.log(`[Connect] ${socket.id}`);
    let currentRoomId = null; // Room ID for this specific socket connection
    let currentUsername = 'Guest'; // Username for this specific socket connection

    // --- Join Room ---
    socket.on('join_room', (data) => {
        // Validate input data
        if (!data || !data.roomId || !data.username) {
            console.error(`[Join Error] Missing data from ${socket.id}`, data);
            return socket.emit('join_error', 'Thiếu ID phòng hoặc tên.');
        }

        const { roomId, username } = data;
        const usernameClean = username.trim().substring(0, 20) || 'Guest';

        // Leave previous room if the socket was already in one
        leaveCurrentRoom(socket); // Pass the socket instance

        currentRoomId = roomId; // Update context for this socket
        currentUsername = usernameClean; // Update context for this socket
        socket.join(roomId);
        console.log(`[Join] ${currentUsername} (${socket.id}) joined ${roomId}`);

        // Create room if it's new
        if (!rooms[roomId]) {
            rooms[roomId] = {
                users: {},
                videoId: 'dQw4w9WgXcQ', // Default
                state: YT.PlayerState.PAUSED,
                time: 0
                // Removed host tracking in this basic version for simplicity
            };
            console.log(`[Room Created] ${roomId}`);
        }

        // Add user to the room object
        rooms[roomId].users[socket.id] = currentUsername;

        // Send current room state ONLY to the newly joined user
        socket.emit('room_state', {
            videoId: rooms[roomId].videoId,
            state: rooms[roomId].state,
            time: rooms[roomId].time,
            users: rooms[roomId].users,
            roomId: roomId // Send roomId back for confirmation
        });

        // Notify OTHER users in the room
        socket.to(roomId).emit('user_joined', {
            userId: socket.id,
            username: currentUsername,
            users: rooms[roomId].users // Send updated user list
        });

        // Send system message to the room
        io.to(roomId).emit('system_message', `${currentUsername} đã tham gia.`);
    });

   // --- Video Action (Refined Sync Logic) ---
    socket.on('video_action', (data) => {
        // Validate if the socket is actually in the room it claims to be
        if (!isValidAction(socket, currentRoomId)) {
             console.warn(`[Invalid Action] User ${socket.id} tried action in room ${currentRoomId} but is not verified.`);
             return;
        }
        const room = rooms[currentRoomId];
        console.log(`[Video Action] ${currentRoomId} from ${currentUsername}:`, data);

        let changed = false;
        let requiresFullSync = data.action === 'change_video'; // Full sync chỉ khi đổi video
        let actionBroadcast = { ...data }; // Data to broadcast

        switch (data.action) {
            case 'play':
                if (room.state !== YT.PlayerState.PLAYING) {
                    room.state = YT.PlayerState.PLAYING;
                    // Don't update time on play, let clients sync to playing state
                    changed = true;
                }
                break;
            case 'pause':
                if (room.state !== YT.PlayerState.PAUSED || data.time !== undefined) {
                    room.state = YT.PlayerState.PAUSED;
                    // Always update time when pausing (use client time if available)
                    room.time = typeof data.time === 'number' ? data.time : room.time;
                    actionBroadcast.time = room.time; // Use updated server time for broadcast
                    changed = true;
                }
                break;
            case 'seek':
                const targetSeekTime = typeof data.time === 'number' ? data.time : 0;
                // Update time if seek request received
                room.time = targetSeekTime;
                actionBroadcast.time = room.time; // Use updated server time for broadcast
                changed = true; // Always sync time on seek
                break;
            case 'change_video':
                 // Simplified: Anyone can change video in this version
                 if (!data.videoId || typeof data.videoId !== 'string' || data.videoId.length !== 11) { // Basic ID validation
                      return socket.emit('error_message', 'Video ID không hợp lệ (cần 11 ký tự).');
                 }
                 if (room.videoId === data.videoId) return; // Don't process if ID is the same
                 room.videoId = data.videoId;
                 room.state = YT.PlayerState.PAUSED; // Start new video paused
                 room.time = 0;
                 changed = true;
                 requiresFullSync = true; // Always send full state on video change
                break;
            default:
                 console.warn(`[Unknown Action] Received unknown action: ${data.action}`);
                 return;
        }

        if (changed) {
            if (requiresFullSync) {
                console.log(`[Full Sync] Sending new state for room ${currentRoomId} after video change.`);
                io.to(currentRoomId).emit('room_state', { // Send state to everyone
                     videoId: room.videoId, state: room.state, time: room.time, users: room.users, roomId: currentRoomId
                });
                io.to(currentRoomId).emit('system_message', `${currentUsername} đã đổi video.`);
            } else {
                // *** Luôn gửi cả action và time (quan trọng cho pause/seek) ***
                // For play, time doesn't matter as much, but sending it won't hurt
                const syncData = { action: data.action, time: room.time };
                console.log(`[Action Sync] Broadcasting: ${JSON.stringify(syncData)} to room ${currentRoomId}`);
                // Broadcast to OTHERS only
                socket.to(currentRoomId).emit('video_action_sync', syncData);
            }
        }
    });


    // --- Chat ---
    socket.on('chat_message', (data) => {
        if (!isValidAction(socket, currentRoomId) || !data || !data.message || data.message.trim() === '') return;
        const username = rooms[currentRoomId]?.users[socket.id] || 'Guest';
        // Broadcast to all including sender
        io.to(currentRoomId).emit('chat_message', { user: username, message: data.message });
    });

    // --- Disconnect ---
    socket.on('disconnect', (reason) => {
        console.log(`[Disconnect] ${socket.id}, Reason: ${reason}`);
        leaveCurrentRoom(socket); // Pass socket to identify leaving user
    });

    // --- Helper Functions ---
    function leaveCurrentRoom(socketInstance) {
        const leavingUserId = socketInstance.id;
        // Find the room this socket was *actually* in
        let leavingRoomId = null;
        for (const id of socketInstance.rooms) {
            if (id !== socketInstance.id && rooms[id]) {
                leavingRoomId = id;
                break;
            }
        }

        if (leavingRoomId && rooms[leavingRoomId] && rooms[leavingRoomId].users[leavingUserId]) {
            const leavingUsername = rooms[leavingRoomId].users[leavingUserId]; // Get username before deleting
            console.log(`[Leave] ${leavingUsername} (${leavingUserId}) from ${leavingRoomId}`);

            delete rooms[leavingRoomId].users[leavingUserId];
            // socketInstance.leave(leavingRoomId) is handled by disconnect

            const remainingUsers = rooms[leavingRoomId].users; // Users remaining in the room
            const remainingUserCount = Object.keys(remainingUsers).length;

            if (remainingUserCount === 0) {
                console.log(`[Room Deleted] ${leavingRoomId}`);
                delete rooms[leavingRoomId];
            } else {
                 // Notify others
                 socket.to(leavingRoomId).emit('user_left', { userId: leavingUserId, username: leavingUsername, users: remainingUsers });
                 io.to(leavingRoomId).emit('system_message', `${leavingUsername} đã rời phòng.`);
                 // Simplified host logic for basic version
            }
        } else {
             console.log(`[Leave Ignored] User ${leavingUserId} not found in any active room.`);
        }
        // Reset context for this specific connection (though it's disconnecting anyway)
        // currentRoomId = null; // This context belongs to the closing socket, no need to reset here
        // currentUsername = 'Guest';
    }

    // Check if socket is in a valid, known room
    function isValidAction(socketInstance, roomId) {
        // Check both the socket's context AND if the room/user actually exists server-side
        const roomExists = roomId && rooms[roomId];
        const userInRoom = roomExists && rooms[roomId].users[socketInstance.id];
        // Check if socket is actually in the room according to socket.io
        const socketInActualRoom = socketInstance.rooms.has(roomId);
        if (!roomExists || !userInRoom || !socketInActualRoom) {
             console.warn(`[Invalid Action Check Failed] User: ${socketInstance.id}, Room: ${roomId}, Exists: ${!!roomExists}, UserListed: ${!!userInRoom}, SocketInRoom: ${socketInActualRoom}`);
             return false;
        }
        return true;
    }
    // function isHostAction(socketInstance, roomId) { /* Simplified */ }

    // Get state, including room ID and user list
    function getCurrentRoomState(roomId, targetSocketId = null) {
        const room = rooms[roomId];
        if (!room) return {};
        return {
            videoId: room.videoId,
            state: room.state,
            time: room.time,
            users: room.users, // Send the whole user object {id: name}
            roomId: roomId // Include roomId in the state object
            // Removed host logic for simplicity
        };
    }

     function createSystemMessage(message) {
        return { user: 'Hệ thống', message: message, isSystem: true };
    }
});

// --- Start Server ---
server.listen(PORT, () => {
    console.log(`CoupleFlix Server (v13 Sync Refined) is running on http://localhost:${PORT}`);
});