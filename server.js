const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Game Data
let words = [];
try {
    const indianData = fs.readFileSync(path.join(__dirname, 'data', 'words_indian.json'), 'utf8');
    words = JSON.parse(indianData);
    console.log(`Loaded ${words.length} curated Indian words.`);
} catch (err) {
    console.warn("Indian words list not found, trying large list fallback.");
    try {
        const largeData = fs.readFileSync(path.join(__dirname, 'data', 'words_large.txt'), 'utf8');
        words = largeData.split('\n').map(w => w.trim()).filter(w => w.length > 4);
    } catch (e) {
        words = ["pizza", "beach", "mountain", "school", "phone", "doctor", "car", "football", "computer", "movie"];
    }
}

// Room management
// rooms[roomCode] = { players: {socketId: {name, score, role, word}}, status: 'lobby'|'playing', hostId, turnOrder: [], currentTurnIndex: 0, clues: [], secretWord: '', imposterId: '', votes: {}, gameOver: false }
const rooms = {};

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 7).toUpperCase();
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('createRoom', ({ playerName }) => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            players: {
                [socket.id]: { id: socket.id, name: playerName, score: 0 }
            },
            status: 'lobby',
            hostId: socket.id,
            clues: [],
            votes: {},
            turnOrder: []
        };
        socket.join(roomCode);
        socket.emit('roomCreated', { roomCode, players: Object.values(rooms[roomCode].players) });
    });

    socket.on('joinRoom', ({ roomCode, playerName }) => {
        if (rooms[roomCode]) {
            if (rooms[roomCode].status !== 'lobby') {
                return socket.emit('error', 'Game already in progress.');
            }
            rooms[roomCode].players[socket.id] = { id: socket.id, name: playerName, score: 0 };
            socket.join(roomCode);
            io.to(roomCode).emit('playerJoined', { players: Object.values(rooms[roomCode].players) });
            socket.emit('joinedSuccess', { roomCode, hostId: rooms[roomCode].hostId });
        } else {
            socket.emit('error', 'Invalid room code.');
        }
    });

    socket.on('startGame', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (room && room.hostId === socket.id) {
            const playerIds = Object.keys(room.players);
            if (playerIds.length < 3) {
                return socket.emit('error', 'Need at least 3 players to start.');
            }

            room.status = 'playing';
            room.secretWord = words[Math.floor(Math.random() * words.length)];
            room.imposterId = playerIds[Math.floor(Math.random() * playerIds.length)];
            room.clues = [];
            room.votes = {};
            room.turnOrder = [...playerIds].sort(() => Math.random() - 0.5);
            room.currentTurnIndex = 0;
            room.currentRound = 1;

            // Notify each player of their role/word
            playerIds.forEach(id => {
                const player = room.players[id];
                if (id === room.imposterId) {
                    player.role = 'imposter';
                    player.word = null;
                    io.to(id).emit('gameStarted', { role: 'imposter', turnOrder: room.turnOrder.map(pid => room.players[pid].name), currentTurn: room.players[room.turnOrder[0]].name, roundInfo: "Round 1 / 2" });
                } else {
                    player.role = 'player';
                    player.word = room.secretWord;
                    io.to(id).emit('gameStarted', { role: 'player', word: room.secretWord, turnOrder: room.turnOrder.map(pid => room.players[pid].name), currentTurn: room.players[room.turnOrder[0]].name, roundInfo: "Round 1 / 2" });
                }
            });
        }
    });

    socket.on('sendClue', ({ roomCode, clue }) => {
        const room = rooms[roomCode];
        if (room && room.status === 'playing') {
            const currentPlayerId = room.turnOrder[room.currentTurnIndex];
            if (socket.id === currentPlayerId) {
                room.clues.push({ name: room.players[socket.id].name, clue });
                room.currentTurnIndex++;

                if (room.currentTurnIndex >= room.turnOrder.length) {
                    // Check if we should do another round (Total 2 rounds)
                    room.currentRound = (room.currentRound || 1) + 1;
                    if (room.currentRound > 2) {
                        // Notify everyone of the last clue and impending transition
                        io.to(roomCode).emit('clueUpdate', { clues: room.clues, currentTurn: 'Voting starts in 3s...' });
                        
                        // Delay voting phase by 3 seconds
                        setTimeout(() => {
                            if (rooms[roomCode] && rooms[roomCode].status === 'playing') {
                                rooms[roomCode].status = 'voting';
                                io.to(roomCode).emit('votingPhase', { clues: rooms[roomCode].clues, players: Object.values(rooms[roomCode].players).map(p => ({ id: p.id, name: p.name })) });
                            }
                        }, 3000);
                    } else {
                        // Start next round of clues
                        room.currentTurnIndex = 0;
                        const firstPlayerId = room.turnOrder[0];
                        io.to(roomCode).emit('clueUpdate', { 
                            clues: room.clues, 
                            currentTurn: room.players[firstPlayerId].name,
                            roundInfo: `Round ${room.currentRound} / 2`
                        });
                    }
                } else {
                    const nextPlayerId = room.turnOrder[room.currentTurnIndex];
                    io.to(roomCode).emit('clueUpdate', { 
                        clues: room.clues, 
                        currentTurn: room.players[nextPlayerId].name,
                        roundInfo: `Round ${room.currentRound || 1} / 2`
                    });
                }
            }
        }
    });

    socket.on('votePlayer', ({ roomCode, targetId }) => {
        const room = rooms[roomCode];
        if (room && room.status === 'voting') {
            room.votes[socket.id] = targetId;
            const voteCount = Object.keys(room.votes).length;
            const totalPlayers = Object.keys(room.players).length;

            if (voteCount === totalPlayers) {
                // Calculate results
                const tallies = {};
                Object.values(room.votes).forEach(vid => {
                    tallies[vid] = (tallies[vid] || 0) + 1;
                });

                let maxVotes = 0;
                let votedOutId = null;
                for (const pid in tallies) {
                    if (tallies[pid] > maxVotes) {
                        maxVotes = tallies[pid];
                        votedOutId = pid;
                    }
                }

                if (votedOutId === room.imposterId) {
                    // Imposter caught
                    room.status = 'ended';
                    // Update scores
                    Object.keys(room.players).forEach(pid => {
                        if (pid !== room.imposterId) room.players[pid].score += 1;
                    });
                    io.to(roomCode).emit('gameResult', {
                        winner: 'players',
                        imposterName: room.players[room.imposterId].name,
                        secretWord: room.secretWord,
                        scores: Object.values(room.players).map(p => ({ name: p.name, score: p.score }))
                    });
                } else {
                    // Imposter survived -> Instant win as requested
                    room.status = 'ended';
                    room.players[room.imposterId].score += 2;
                    io.to(roomCode).emit('gameResult', {
                        winner: 'imposter',
                        imposterName: room.players[room.imposterId].name,
                        secretWord: room.secretWord,
                        votedOutName: room.players[votedOutId].name,
                        scores: Object.values(room.players).map(p => ({ name: p.name, score: p.score }))
                    });
                }
            }
        }
    });

    socket.on('imposterGuess', ({ roomCode, guess }) => {
        const room = rooms[roomCode];
        if (room && room.status === 'imposterGuessing' && socket.id === room.imposterId) {
            room.status = 'ended';
            if (guess.toLowerCase() === room.secretWord.toLowerCase()) {
                room.players[room.imposterId].score += 3;
                io.to(roomCode).emit('gameResult', {
                    winner: 'imposter',
                    imposterName: room.players[room.imposterId].name,
                    secretWord: room.secretWord,
                    guess: guess,
                    scores: Object.values(room.players).map(p => ({ name: p.name, score: p.score }))
                });
            } else {
                Object.keys(room.players).forEach(pid => {
                    if (pid !== room.imposterId) room.players[pid].score += 1;
                });
                io.to(roomCode).emit('gameResult', {
                    winner: 'players',
                    imposterName: room.players[room.imposterId].name,
                    secretWord: room.secretWord,
                    guess: guess,
                    scores: Object.values(room.players).map(p => ({ name: p.name, score: p.score }))
                });
            }
        }
    });

    socket.on('nextRound', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (room && room.hostId === socket.id) {
            room.status = 'lobby';
            room.clues = [];
            room.votes = {};
            room.secretWord = '';
            room.imposterId = '';
            io.to(roomCode).emit('lobbyUpdate', { players: Object.values(room.players) });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Clean up rooms
        for (const roomCode in rooms) {
            if (rooms[roomCode].players[socket.id]) {
                delete rooms[roomCode].players[socket.id];
                if (Object.keys(rooms[roomCode].players).length === 0) {
                    delete rooms[roomCode];
                } else {
                    if (rooms[roomCode].hostId === socket.id) {
                        rooms[roomCode].hostId = Object.keys(rooms[roomCode].players)[0];
                    }
                    io.to(roomCode).emit('playerLeft', { players: Object.values(rooms[roomCode].players), hostId: rooms[roomCode].hostId });
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
