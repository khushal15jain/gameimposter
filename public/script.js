const socket = io();

// State
let myId = null;
let myName = "";
let currentRoom = null;
let isHost = false;
let selectedVoteId = null;

// UI Elements
const screens = {
    landing: document.getElementById('landing-screen'),
    lobby: document.getElementById('lobby-screen'),
    game: document.getElementById('game-screen'),
    voting: document.getElementById('voting-screen'),
    imposterGuess: document.getElementById('imposter-guess-screen'),
    result: document.getElementById('result-screen')
};

function showScreen(screenId) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screenId].classList.add('active');
}

// Landing Controls
const btnCreate = document.getElementById('btn-create');
const btnJoinToggle = document.getElementById('btn-join-toggle');
const btnJoinFinal = document.getElementById('btn-join-final');
const playerNameInput = document.getElementById('player-name');
const roomCodeInput = document.getElementById('room-code-input');
const joinRoomBox = document.getElementById('join-room-box');
const joinActionBox = document.getElementById('join-action-box');

btnCreate.onclick = () => {
    myName = playerNameInput.value.trim();
    if (!myName) return showError("Please enter your name");
    socket.emit('createRoom', { playerName: myName });
};

btnJoinToggle.onclick = () => {
    joinRoomBox.style.display = 'block';
    joinActionBox.style.display = 'block';
    btnCreate.style.display = 'none';
    btnJoinToggle.style.display = 'none';
};

btnJoinFinal.onclick = () => {
    myName = playerNameInput.value.trim();
    const code = roomCodeInput.value.trim().toUpperCase();
    if (!myName || !code) return showError("Name and Code required");
    socket.emit('joinRoom', { roomCode: code, playerName: myName });
};

// Lobby Controls
const btnStart = document.getElementById('btn-start');
const playerListLobby = document.getElementById('player-list-lobby');
const roomCodeDisplay = document.getElementById('room-code-display');
const hostControls = document.getElementById('host-controls');
const waitMessage = document.getElementById('wait-message');

btnStart.onclick = () => {
    socket.emit('startGame', { roomCode: currentRoom });
};

// Game Controls
const clueInput = document.getElementById('clue-input');
const btnSubmitClue = document.getElementById('btn-submit-clue');
const clueInputBox = document.getElementById('clue-input-box');
const clueList = document.getElementById('clue-list');
const currentPlayerName = document.getElementById('current-player-name');

btnSubmitClue.onclick = () => {
    const clue = clueInput.value.trim();
    if (!clue) return;
    if (clue.split(' ').length > 1) return showError("Only ONE word allowed!");
    socket.emit('sendClue', { roomCode: currentRoom, clue });
    clueInput.value = "";
    clueInputBox.style.display = 'none';
};

// Voting Controls
const votingGrid = document.getElementById('voting-grid');
const btnSubmitVote = document.getElementById('btn-submit-vote');

btnSubmitVote.onclick = () => {
    if (selectedVoteId) {
        socket.emit('votePlayer', { roomCode: currentRoom, targetId: selectedVoteId });
        btnSubmitVote.style.display = 'none';
        votingGrid.innerHTML = `<p style="text-align:center; width:100%;">Vote cast! Waiting for others...</p>`;
    }
};

// Imposter Guess Controls
const imposterGuessInput = document.getElementById('imposter-guess-input');
const btnSubmitGuess = document.getElementById('btn-submit-guess');
const imposterInputBox = document.getElementById('imposter-input-box');

btnSubmitGuess.onclick = () => {
    const guess = imposterGuessInput.value.trim();
    if (!guess) return;
    socket.emit('imposterGuess', { roomCode: currentRoom, guess });
};

// Result Controls
const btnNextRound = document.getElementById('btn-next-round');
btnNextRound.onclick = () => {
    socket.emit('nextRound', { roomCode: currentRoom });
};

// Socket Events
socket.on('connect', () => {
    myId = socket.id;
});

socket.on('roomCreated', ({ roomCode, players }) => {
    currentRoom = roomCode;
    isHost = true;
    roomCodeDisplay.innerText = roomCode;
    updatePlayerList(players);
    hostControls.style.display = 'block';
    waitMessage.style.display = 'none';
    showScreen('lobby');
});

socket.on('joinedSuccess', ({ roomCode, hostId }) => {
    currentRoom = roomCode;
    isHost = (socket.id === hostId);
    roomCodeDisplay.innerText = roomCode;
    if (isHost) {
        hostControls.style.display = 'block';
        waitMessage.style.display = 'none';
    }
    showScreen('lobby');
});

socket.on('playerJoined', ({ players }) => {
    updatePlayerList(players);
});

socket.on('playerLeft', ({ players, hostId }) => {
    updatePlayerList(players);
    isHost = (socket.id === hostId);
    if (isHost) {
        hostControls.style.display = 'block';
        waitMessage.style.display = 'none';
    }
});

socket.on('gameStarted', ({ role, word, turnOrder, currentTurn }) => {
    document.getElementById('role-text').innerText = role === 'imposter' ? 'YOU ARE THE IMPOSTER' : 'YOUR WORD IS';
    document.getElementById('role-display').className = `role-box ${role}`;
    document.getElementById('word-text').innerText = role === 'imposter' ? 'GUESS IT!' : word;
    
    clueList.innerHTML = "";
    updateTurnIndicator(currentTurn);
    showScreen('game');
});

socket.on('clueUpdate', ({ clues, currentTurn }) => {
    renderClues(clues);
    updateTurnIndicator(currentTurn);
});

socket.on('votingPhase', ({ clues, players }) => {
    renderClues(clues);
    votingGrid.innerHTML = "";
    players.forEach(p => {
        if (p.id === socket.id) return; // Can't vote for self
        const btn = document.createElement('div');
        btn.className = 'vote-btn';
        btn.innerText = p.name;
        btn.onclick = () => {
            document.querySelectorAll('.vote-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedVoteId = p.id;
            btnSubmitVote.style.display = 'block';
        };
        votingGrid.appendChild(btn);
    });
    showScreen('voting');
});

socket.on('imposterSurvival', ({ votedOutName, imposterId }) => {
    document.getElementById('survival-msg').innerText = `${votedOutName} was voted out, but they were NOT the imposter!`;
    if (socket.id === imposterId) {
        imposterInputBox.style.display = 'block';
    } else {
        document.getElementById('imposter-wait-msg').style.display = 'block';
    }
    showScreen('imposterGuess');
});

socket.on('promptGuess', () => {
    // Handled in survival
});

socket.on('gameResult', ({ winner, imposterName, secretWord, guess, scores }) => {
    const title = document.getElementById('result-title');
    if ((winner === 'players' && document.getElementById('role-text').innerText !== 'YOU ARE THE IMPOSTER') ||
        (winner === 'imposter' && document.getElementById('role-text').innerText === 'YOU ARE THE IMPOSTER')) {
        title.innerText = "VICTORY 🎉";
        confetti({
            particleCount: 150,
            spread: 70,
            origin: { y: 0.6 }
        });
    } else {
        title.innerText = "DEFEAT 💀";
    }

    document.getElementById('res-imposter-name').innerText = imposterName;
    document.getElementById('res-secret-word').innerText = secretWord;
    document.getElementById('res-guess-info').innerText = guess ? `Imposter guessed: ${guess}` : "";
    
    const scoreList = document.getElementById('scoreboard-list');
    scoreList.innerHTML = "";
    scores.sort((a,b) => b.score - a.score).forEach(s => {
        scoreList.innerHTML += `<li class="player-item"><span>${s.name}</span><span>${s.score} pts</span></li>`;
    });

    if (isHost) {
        document.getElementById('restart-controls').style.display = 'block';
    }
    showScreen('result');
});

socket.on('lobbyUpdate', ({ players }) => {
    updatePlayerList(players);
    hostControls.style.display = isHost ? 'block' : 'none';
    waitMessage.style.display = isHost ? 'none' : 'block';
    // Reset game UIs
    document.getElementById('clue-input-box').style.display = 'none';
    document.getElementById('imposter-input-box').style.display = 'none';
    document.getElementById('imposter-wait-msg').style.display = 'none';
    document.getElementById('restart-controls').style.display = 'none';
    showScreen('lobby');
});

socket.on('error', (msg) => {
    showError(msg);
});

// Helpers
function updatePlayerList(players) {
    playerListLobby.innerHTML = players.map(p => `
        <li class="player-item">
            <span>${p.name} ${p.id === socket.id ? '(You)' : ''}</span>
            <span style="color: var(--primary-neon)">${p.id === myId ? '' : ''}</span>
        </li>
    `).join('');
}

function updateTurnIndicator(turnName) {
    currentPlayerName.innerText = turnName;
    if (turnName === myName) {
        clueInputBox.style.display = 'block';
        document.getElementById('turn-indicator').classList.add('pulse');
    } else {
        clueInputBox.style.display = 'none';
        document.getElementById('turn-indicator').classList.remove('pulse');
    }
}

function renderClues(clues) {
    clueList.innerHTML = clues.map(c => `
        <div class="clue-item">
            <div class="clue-author">${c.name}</div>
            <div style="font-weight: 600;">${c.clue}</div>
        </div>
    `).join('');
    clueList.scrollTop = clueList.scrollHeight;
}

function showError(msg) {
    const toast = document.getElementById('error-toast');
    toast.innerText = msg;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 3000);
}
