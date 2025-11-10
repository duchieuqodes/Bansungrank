// Connect to server
const socket = io();

// Game state
let gameState = 'lobby'; // lobby, waiting, character_select, playing, game_over
let playerName = '';
let roomId = null;
let isRoomOwner = false;
let selectedCharacter = null;
let playerId = null;

// Canvas and context
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Game data
let players = {};
let bullets = [];
let powerups = [];
let statusEffects = {};
let myPlayer = null;
let camera = { x: 0, y: 0 };

// World constants
const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 2000;

// Character definitions
const characterStats = [
    {
        name: 'Poison Witch',
        speed: 6,
        damage: 20,
        fireRate: 400,
        specialCooldown: 20000,
        size: 60,
        health: 100,
        ability: 'poison',
        color: '#9b59b6'
    },
    {
        name: 'Electric Ship',
        speed: 7,
        damage: 15,
        fireRate: 300,
        specialCooldown: 20000,
        size: 70,
        health: 80,
        ability: 'electric',
        color: '#3498db'
    },
    {
        name: 'Fire Pilot',
        speed: 4,
        damage: 35,
        fireRate: 600,
        specialCooldown: 20000,
        size: 65,
        health: 120,
        ability: 'fire',
        color: '#e74c3c'
    },
    {
        name: 'Ice UFO',
        speed: 5.5,
        damage: 25,
        fireRate: 500,
        specialCooldown: 20000,
        size: 65,
        health: 100,
        ability: 'ice',
        color: '#1abc9c'
    }
];

// Controls
let joystickActive = false;
let joystickAngle = 0;
let joystickDistance = 0;
let keys = {};

// Cooldowns
let lastNormalShot = 0;
let lastSpecialShot = 0;

// ===== LOBBY FUNCTIONS =====

document.getElementById('createRoomBtn').addEventListener('click', () => {
    playerName = document.getElementById('playerNameInput').value.trim();
    if (!playerName) {
        showCustomAlert('Vui lòng nhập tên người chơi!');
        return;
    }
    socket.emit('createRoom', { playerName });
});

document.getElementById('refreshRoomsBtn').addEventListener('click', () => {
    socket.emit('getRooms');
});

document.getElementById('leaveRoomBtn').addEventListener('click', () => {
    socket.emit('leaveRoom');
    showLobby();
});

document.getElementById('startGameBtn').addEventListener('click', () => {
    socket.emit('startGame');
});

document.getElementById('confirmCharacterBtn').addEventListener('click', () => {
    if (selectedCharacter !== null) {
        socket.emit('selectCharacter', { characterType: selectedCharacter });
    }
});

document.getElementById('backToLobbyBtn').addEventListener('click', () => {
    socket.emit('leaveRoom');
    showLobby();
});

// Socket events
socket.on('connect', () => {
    console.log('Connected to server');
    socket.emit('getRooms');
});

socket.on('roomsList', (rooms) => {
    displayRooms(rooms);
});

socket.on('roomCreated', (data) => {
    roomId = data.roomId;
    isRoomOwner = true;
    playerId = socket.id;
    showWaitingRoom(data);
});

socket.on('roomJoined', (data) => {
    roomId = data.roomId;
    isRoomOwner = data.isOwner;
    playerId = socket.id;
    showWaitingRoom(data);
});

socket.on('roomUpdate', (data) => {
    updateWaitingRoom(data);
});

socket.on('gameStarting', () => {
    showCharacterSelect();
});

socket.on('gameState', (state) => {
    if (gameState === 'playing') {
        players = state.players;
        bullets = state.bullets;
        powerups = state.powerups;
        statusEffects = state.statusEffects;
        myPlayer = players[playerId];

        updateUI();
        render();
    }
});

socket.on('gameStarted', (data) => {
    gameState = 'playing';
    document.getElementById('characterSelect').style.display = 'none';
    document.getElementById('gameCanvas').style.display = 'block';
    document.getElementById('gameUI').style.display = 'block';
    resizeCanvas();
    gameLoop();
});

socket.on('gameOver', (data) => {
    gameState = 'game_over';
    showGameOver(data.leaderboard);
});

socket.on('playerKilled', (data) => {
    if (data.killerId === playerId) {
        // You got a kill
        showNotification('💀 Bạn đã hạ gục ' + data.victimName + '!', '#00ff00');
    } else if (data.victimId === playerId) {
        // You were killed
        showNotification('☠️ Bạn đã bị ' + data.killerName + ' hạ gục!', '#ff0000');
    }
});

socket.on('error', (message) => {
    showCustomAlert(message);
});

// ===== UI FUNCTIONS =====

function displayRooms(rooms) {
    const roomsList = document.getElementById('roomsList');
    if (rooms.length === 0) {
        roomsList.innerHTML = '<p style="text-align: center; color: #666;">Không có phòng nào. Hãy tạo phòng mới!</p>';
        return;
    }

    roomsList.innerHTML = '';
    rooms.forEach(room => {
        const roomDiv = document.createElement('div');
        roomDiv.className = 'room-item';
        roomDiv.innerHTML = `
            <div class="room-info">
                <div class="room-name">${room.name}</div>
                <div class="room-players">${room.players}/${room.maxPlayers} người chơi</div>
            </div>
            <button class="btn-join" onclick="joinRoom('${room.id}')">Tham gia</button>
        `;
        roomsList.appendChild(roomDiv);
    });
}

function joinRoom(roomIdToJoin) {
    playerName = document.getElementById('playerNameInput').value.trim();
    if (!playerName) {
        showCustomAlert('Vui lòng nhập tên người chơi!');
        return;
    }
    socket.emit('joinRoom', { roomId: roomIdToJoin, playerName });
}

function showLobby() {
    gameState = 'lobby';
    document.getElementById('lobbyScreen').style.display = 'block';
    document.getElementById('roomWaitingScreen').style.display = 'none';
    document.getElementById('characterSelect').style.display = 'none';
    document.getElementById('gameCanvas').style.display = 'none';
    document.getElementById('gameUI').style.display = 'none';
    document.getElementById('gameOverScreen').style.display = 'none';
    socket.emit('getRooms');
}

function showWaitingRoom(data) {
    gameState = 'waiting';
    document.getElementById('lobbyScreen').style.display = 'none';
    document.getElementById('roomWaitingScreen').style.display = 'flex';
    updateWaitingRoom(data);
}

function updateWaitingRoom(data) {
    document.getElementById('roomCode').textContent = 'Mã phòng: ' + data.roomId;

    const playersList = document.getElementById('playersListWaiting');
    playersList.innerHTML = '<h3>Người chơi:</h3>';

    data.players.forEach(player => {
        const playerDiv = document.createElement('div');
        playerDiv.className = 'player-item' + (player.isOwner ? ' owner' : '');
        playerDiv.textContent = player.name + (player.isOwner ? ' (Trưởng phòng)' : '');
        playersList.appendChild(playerDiv);
    });

    // Show start button only for room owner
    const startBtn = document.getElementById('startGameBtn');
    if (isRoomOwner && data.players.length >= 1) {
        startBtn.style.display = 'block';
    } else {
        startBtn.style.display = 'none';
    }
}

function showCharacterSelect() {
    gameState = 'character_select';
    document.getElementById('roomWaitingScreen').style.display = 'none';
    document.getElementById('characterSelect').style.display = 'flex';

    // Character selection
    const characterCards = document.querySelectorAll('.character-card');
    characterCards.forEach(card => {
        card.addEventListener('click', () => {
            characterCards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            selectedCharacter = parseInt(card.dataset.character);
            document.getElementById('confirmCharacterBtn').disabled = false;
        });
    });
}

function showGameOver(leaderboard) {
    document.getElementById('gameOverScreen').style.display = 'flex';

    const leaderboardDisplay = document.getElementById('leaderboardDisplay');
    leaderboardDisplay.innerHTML = '<h2 style="margin-bottom: 20px;">🏆 BẢNG XẾP HẠNG 🏆</h2>';

    leaderboard.forEach((player, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'leaderboard-item';
        if (index === 0) itemDiv.classList.add('top1');
        else if (index === 1) itemDiv.classList.add('top2');
        else if (index === 2) itemDiv.classList.add('top3');

        itemDiv.innerHTML = `
            <span>#${index + 1} ${player.name}</span>
            <span>Kills: ${player.kills} | Deaths: ${player.deaths}</span>
        `;
        leaderboardDisplay.appendChild(itemDiv);
    });
}

function showNotification(message, color) {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 100px;
        left: 50%;
        transform: translateX(-50%);
        background: ${color};
        color: white;
        padding: 15px 30px;
        border-radius: 10px;
        font-size: 18px;
        font-weight: bold;
        z-index: 9999;
        box-shadow: 0 5px 20px rgba(0,0,0,0.5);
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.remove();
    }, 3000);
}

function showCustomAlert(message) {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 99999;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
        background: white;
        padding: 30px;
        border-radius: 15px;
        max-width: 400px;
        text-align: center;
    `;

    content.innerHTML = `
        <p style="font-size: 18px; margin-bottom: 20px; color: #333;">${message}</p>
        <button id="modalOkBtn" style="padding: 10px 30px; font-size: 16px; background: #667eea; color: white; border: none; border-radius: 10px; cursor: pointer;">OK</button>
    `;

    modal.appendChild(content);
    document.body.appendChild(modal);

    document.getElementById('modalOkBtn').onclick = () => {
        modal.remove();
    };
}

// ===== GAME RENDERING =====

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

window.addEventListener('resize', resizeCanvas);

let lastFrameTime = Date.now();
function gameLoop() {
    if (gameState !== 'playing') return;

    const now = Date.now();
    const dt = now - lastFrameTime;
    lastFrameTime = now;

    requestAnimationFrame(gameLoop);
}

function render() {
    if (!myPlayer) return;

    // Clear canvas
    ctx.fillStyle = '#0a0a15';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Update camera
    camera.x = myPlayer.x - canvas.width / 2;
    camera.y = myPlayer.y - canvas.height / 2;
    camera.x = Math.max(0, Math.min(WORLD_WIDTH - canvas.width, camera.x));
    camera.y = Math.max(0, Math.min(WORLD_HEIGHT - canvas.height, camera.y));

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // Draw grid
    drawGrid();

    // Draw powerups
    powerups.forEach(powerup => {
        drawPowerup(powerup);
    });

    // Draw players
    Object.values(players).forEach(player => {
        drawPlayer(player);
    });

    // Draw bullets
    bullets.forEach(bullet => {
        drawBullet(bullet);
    });

    ctx.restore();
}

function drawGrid() {
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;

    const gridSize = 100;
    const startX = Math.floor(camera.x / gridSize) * gridSize;
    const startY = Math.floor(camera.y / gridSize) * gridSize;
    const endX = camera.x + canvas.width;
    const endY = camera.y + canvas.height;

    for (let x = startX; x <= endX; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
        ctx.stroke();
    }

    for (let y = startY; y <= endY; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
        ctx.stroke();
    }
}

function drawPlayer(player) {
    const stats = characterStats[player.characterType];

    // Draw status effects
    if (statusEffects[player.id]) {
        const effects = statusEffects[player.id];
        if (effects.frozen) {
            ctx.fillStyle = 'rgba(100, 200, 255, 0.3)';
            ctx.beginPath();
            ctx.arc(player.x, player.y, stats.size / 2 + 10, 0, Math.PI * 2);
            ctx.fill();
        }
        if (effects.stunned) {
            ctx.fillStyle = 'rgba(255, 255, 100, 0.3)';
            ctx.beginPath();
            ctx.arc(player.x, player.y, stats.size / 2 + 10, 0, Math.PI * 2);
            ctx.fill();
        }
        if (effects.poisoned) {
            ctx.fillStyle = 'rgba(100, 255, 100, 0.3)';
            ctx.beginPath();
            ctx.arc(player.x, player.y, stats.size / 2 + 10, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Draw player circle
    ctx.fillStyle = stats.color;
    ctx.strokeStyle = player.id === playerId ? '#ffd700' : '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(player.x, player.y, stats.size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Draw direction indicator
    ctx.fillStyle = '#ffffff';
    const dirX = player.x + Math.cos(player.angle) * stats.size / 2;
    const dirY = player.y + Math.sin(player.angle) * stats.size / 2;
    ctx.beginPath();
    ctx.arc(dirX, dirY, 5, 0, Math.PI * 2);
    ctx.fill();

    // Draw name
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.strokeText(player.name, player.x, player.y - stats.size / 2 - 25);
    ctx.fillText(player.name, player.x, player.y - stats.size / 2 - 25);

    // Draw health bar
    const barWidth = 60;
    const barHeight = 8;
    const healthPercent = player.health / player.maxHealth;

    ctx.fillStyle = '#333';
    ctx.fillRect(player.x - barWidth / 2, player.y - stats.size / 2 - 15, barWidth, barHeight);

    ctx.fillStyle = healthPercent > 0.5 ? '#00ff00' : healthPercent > 0.25 ? '#ffaa00' : '#ff0000';
    ctx.fillRect(player.x - barWidth / 2, player.y - stats.size / 2 - 15, barWidth * healthPercent, barHeight);
}

function drawBullet(bullet) {
    const color = bullet.isSpecial ? '#ffd700' :
                  bullet.characterType === 0 ? '#9b59b6' :
                  bullet.characterType === 1 ? '#3498db' :
                  bullet.characterType === 2 ? '#e74c3c' : '#1abc9c';

    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, bullet.isSpecial ? 8 : 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
}

function drawPowerup(powerup) {
    const colors = {
        health: '#00ff00',
        armor: '#4ecdc4',
        speed: '#ffff00'
    };

    ctx.fillStyle = colors[powerup.type];
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(powerup.x, powerup.y, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Draw icon
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    const icons = { health: '+', armor: '🛡', speed: '⚡' };
    ctx.fillText(icons[powerup.type], powerup.x, powerup.y + 6);
}

function updateUI() {
    if (!myPlayer) return;

    // Update health bar
    const healthPercent = (myPlayer.health / myPlayer.maxHealth) * 100;
    document.getElementById('healthFill').style.width = healthPercent + '%';

    // Update armor bar
    if (myPlayer.armor > 0) {
        document.getElementById('armorBar').style.display = 'block';
        const armorPercent = (myPlayer.armor / myPlayer.maxArmor) * 100;
        document.getElementById('armorFill').style.width = armorPercent + '%';
    } else {
        document.getElementById('armorBar').style.display = 'none';
    }

    // Update stats
    const allPlayers = Object.values(players).sort((a, b) => b.kills - a.kills);
    const myRank = allPlayers.findIndex(p => p.id === playerId) + 1;
    document.getElementById('statsDisplay').textContent =
        `🏆 Kills: ${myPlayer.kills} | 💀 Deaths: ${myPlayer.deaths} | Rank: #${myRank}/${allPlayers.length}`;

    // Update cooldowns
    const now = Date.now();
    const normalReady = now - lastNormalShot >= 1500;
    const specialReady = now - lastSpecialShot >= 20000;

    document.getElementById('cooldownDisplay').textContent =
        `Chiêu thường: ${normalReady ? '✓' : Math.ceil((1500 - (now - lastNormalShot)) / 1000) + 's'} | ` +
        `Chiêu đặc biệt: ${specialReady ? '✓' : Math.ceil((20000 - (now - lastSpecialShot)) / 1000) + 's'}`;

    const specialBtn = document.getElementById('specialButton');
    if (specialReady) {
        specialBtn.classList.remove('cooldown');
    } else {
        specialBtn.classList.add('cooldown');
    }
}

// ===== CONTROLS =====

// Virtual Joystick
const joystick = document.getElementById('joystick');
const joystickStick = document.getElementById('joystickStick');

joystick.addEventListener('touchstart', handleJoystickStart);
joystick.addEventListener('touchmove', handleJoystickMove);
joystick.addEventListener('touchend', handleJoystickEnd);

function handleJoystickStart(e) {
    e.preventDefault();
    joystickActive = true;
}

function handleJoystickMove(e) {
    e.preventDefault();
    if (!joystickActive) return;

    const rect = joystick.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const touch = e.touches[0];
    const x = touch.clientX - rect.left - centerX;
    const y = touch.clientY - rect.top - centerY;

    const distance = Math.min(Math.sqrt(x * x + y * y), 45);
    const angle = Math.atan2(y, x);

    joystickDistance = distance / 45;
    joystickAngle = angle;

    const stickX = Math.cos(angle) * distance;
    const stickY = Math.sin(angle) * distance;

    joystickStick.style.transform = `translate(calc(-50% + ${stickX}px), calc(-50% + ${stickY}px))`;

    // Send movement to server
    socket.emit('playerMove', { angle, distance: joystickDistance });
}

function handleJoystickEnd(e) {
    e.preventDefault();
    joystickActive = false;
    joystickDistance = 0;
    joystickStick.style.transform = 'translate(-50%, -50%)';
    socket.emit('playerMove', { angle: 0, distance: 0 });
}

// Shoot button
const shootButton = document.getElementById('shootButton');
shootButton.addEventListener('touchstart', (e) => {
    e.preventDefault();
    shootNormal();
});

// Special button
const specialButton = document.getElementById('specialButton');
specialButton.addEventListener('touchstart', (e) => {
    e.preventDefault();
    shootSpecial();
});

function shootNormal() {
    const now = Date.now();
    if (now - lastNormalShot < 1500) return;

    lastNormalShot = now;
    socket.emit('shoot', { isSpecial: false });
}

function shootSpecial() {
    const now = Date.now();
    if (now - lastSpecialShot < 20000) return;

    lastSpecialShot = now;
    socket.emit('shoot', { isSpecial: true });
}

// Keyboard controls (for desktop testing)
document.addEventListener('keydown', (e) => {
    keys[e.key] = true;

    if (e.key === ' ') {
        e.preventDefault();
        shootNormal();
    } else if (e.key === 'e' || e.key === 'E') {
        shootSpecial();
    }
});

document.addEventListener('keyup', (e) => {
    keys[e.key] = false;
});

// Send keyboard movement
setInterval(() => {
    if (gameState !== 'playing') return;

    let dx = 0, dy = 0;
    if (keys['w'] || keys['ArrowUp']) dy = -1;
    if (keys['s'] || keys['ArrowDown']) dy = 1;
    if (keys['a'] || keys['ArrowLeft']) dx = -1;
    if (keys['d'] || keys['ArrowRight']) dx = 1;

    if (dx !== 0 || dy !== 0) {
        const angle = Math.atan2(dy, dx);
        const distance = Math.sqrt(dx * dx + dy * dy);
        socket.emit('playerMove', { angle, distance: Math.min(distance, 1) });
    }
}, 50);
