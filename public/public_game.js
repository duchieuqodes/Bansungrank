// Socket connection
const socket = io();

// Audio setup
const audioFiles = {
    shoot: [
        'https://pfst.cf2.poecdn.net/base/audio/85bd1b0984335df4a8bc4602ad42532326a7aac16b441db7406420295be8523d',
        'https://pfst.cf2.poecdn.net/base/audio/9aa78cb116aeae0e4f8b450e90296f618d9d4c27b94d128111d2f8a973faf7f7',
        'https://pfst.cf2.poecdn.net/base/audio/8df3ece31c5a2ef6733d91dba97adfbc446a8fc3e744565149bd7a6610009186',
        'https://pfst.cf2.poecdn.net/base/audio/85bd1b0984335df4a8bc4602ad42532326a7aac16b441db7406420295be8523d'
    ],
    kill: 'https://pfst.cf2.poecdn.net/base/audio/4ae78434b4884ae0dd5e7fb1dba76f853cf2b62513e6e6a1f21640556464ff27',
    background: 'https://pfst.cf2.poecdn.net/base/audio/975e4b1e2ce226bf3e664514f5dc43f88d4dba86a1c38eccde63aa7cda3a2b65'
};

const backgroundMusic = new Audio(audioFiles.background);
backgroundMusic.loop = true;
backgroundMusic.volume = 0.3;

const killSound = new Audio(audioFiles.kill);
killSound.volume = 0.5;

const shootSounds = audioFiles.shoot.map(url => {
    const sounds = [];
    for (let i = 0; i < 5; i++) {
        const audio = new Audio(url);
        audio.volume = 0.4;
        sounds.push(audio);
    }
    return sounds;
});

let currentShootSoundIndex = [0, 0, 0, 0];

function playShootSound(characterType) {
    const soundPool = shootSounds[characterType];
    const sound = soundPool[currentShootSoundIndex[characterType]];
    sound.currentTime = 0;
    sound.play().catch(() => {});
    currentShootSoundIndex[characterType] = (currentShootSoundIndex[characterType] + 1) % soundPool.length;
}

function playKillSound() {
    killSound.currentTime = 0;
    killSound.play().catch(() => {});
}

function startBackgroundMusic() {
    backgroundMusic.play().catch(() => {});
}

// Game state
let selectedCharacter = null;
let playerName = '';
let currentRoomId = null;
let isHost = false;
let myPlayerId = null;
let gameStarted = false;

// Character images
const characterImages = [
    'https://pfst.cf2.poecdn.net/base/image/04747f0995816d23333a1ed56795f73a74c760325548d5e0ff7c4e65ed31200f?w=238&h=233',
    'https://pfst.cf2.poecdn.net/base/image/9fa1da8cd2232199c07084f9e27a5ac4a64ff5bc862a5502063611ebc298e8d5?w=358&h=218',
    'https://pfst.cf2.poecdn.net/base/image/aa44c494b1cc58fad5dde0729346378098b2277ac6d2cff55ec584965314d597?w=350&h=338',
    'https://pfst.cf2.poecdn.net/base/image/06555f53352386a765f0d6f4d17574fb898c88b7c9ad1f8a952e171a05f7a4f6?w=294&h=260'
];

// Bullet animations
const bulletAnimations = {
    0: [null, null, null],
    1: [
        'https://pfst.cf2.poecdn.net/base/image/25114c36cc8a649117a459dc7c4cf415df9b7e6140de3db792d7628b5c131441?w=244&h=95',
        'https://pfst.cf2.poecdn.net/base/image/1b0713d4e63b1611dc49e0f60690f5f703f50440fbd1024713ba14ea73c9a928?w=244&h=201',
        'https://pfst.cf2.poecdn.net/base/image/f2b221b4e6264545e23bfc57398ce6311ed16fa395f6c396220f9e25b7d66bbb?w=244&h=210'
    ],
    2: [
        'https://pfst.cf2.poecdn.net/base/image/f2c50908c6a225a23fd9c0b73074fafb37d26a2ecce01f35cb8c20c8c047cb30?w=275&h=86',
        'https://pfst.cf2.poecdn.net/base/image/9e3a00f99e48adc1379da415c4cada7b7f9f63866bbc9da6dca5450ba1b7361a?w=244&h=243',
        'https://pfst.cf2.poecdn.net/base/image/2201e3268d9310f8e72dc931168c02250b60245d5c43d157f8e5171b4db9b771?w=243&h=223'
    ],
    3: [
        'https://pfst.cf2.poecdn.net/base/image/8d9fb30d1e4f7e7da1c65b68e31c2fe41d07d5ecd93857f34f5d7d3eb5fcfcf7?w=244&h=90',
        'https://pfst.cf2.poecdn.net/base/image/47cb4fea386f16f95f2c0e5cdb88faccb9a86fc137076da07312ae77e02abb6b?w=207&h=131',
        'https://pfst.cf2.poecdn.net/base/image/9aefc40f23531f47fba43d59b58d0cea8eace1fa1ed8b647be0990deef0c7ad0?w=251&h=234',
        'https://pfst.cf2.poecdn.net/base/image/2a6fea1f3e73843c05197339dbbf499751711d251a0ab9e84e3d20b619292bdb?w=251&h=234'
    ]
};

// Load images
const loadedCharImages = {};
const loadedBulletImages = {};

characterImages.forEach((url, i) => {
    const img = new Image();
    img.src = url;
    loadedCharImages[i] = img;
});

Object.keys(bulletAnimations).forEach(char => {
    loadedBulletImages[char] = bulletAnimations[char].map(url => {
        if (!url) return null;
        const img = new Image();
        img.src = url;
        return img;
    });
});

// Background
const bgImg = new Image();
bgImg.src = 'https://pfst.cf2.poecdn.net/base/image/7f353029f5c4ef28f24de395cdbeba5829a9a10fe4a9611fc1cf21e205800c8b?w=1024&h=1024';

// Canvas setup
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 2000;

let camera = { x: 0, y: 0 };
let particles = [];

// Virtual controls
let joystickActive = false;
let joystickAngle = 0;
let joystickDistance = 0;
let isShooting = false;
let lastShootTime = 0;

// Character selection
const characterCards = document.querySelectorAll('.character-card');
const playerNameInput = document.getElementById('playerNameInput');
const createRoomButton = document.getElementById('createRoomButton');
const joinRoomButton = document.getElementById('joinRoomButton');

characterCards.forEach(card => {
    card.addEventListener('click', () => {
        characterCards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedCharacter = parseInt(card.dataset.character);
        updateButtons();
    });
});

playerNameInput.addEventListener('input', () => {
    playerName = playerNameInput.value.trim();
    updateButtons();
});

function updateButtons() {
    const enabled = selectedCharacter !== null && playerName.length > 0;
    createRoomButton.disabled = !enabled;
    joinRoomButton.disabled = !enabled;
}

createRoomButton.addEventListener('click', () => {
    socket.emit('create-room', {
        playerName: playerName,
        characterType: selectedCharacter
    });
});

joinRoomButton.addEventListener('click', () => {
    document.getElementById('characterSelect').style.display = 'none';
    document.getElementById('joinRoomScreen').style.display = 'flex';

    // Get available rooms
    socket.emit('get-rooms');
});

document.getElementById('joinByIdButton').addEventListener('click', () => {
    const roomId = document.getElementById('roomIdInput').value.trim().toUpperCase();
    if (roomId.length === 6) {
        socket.emit('join-room', {
            roomId: roomId,
            playerName: playerName,
            characterType: selectedCharacter
        });
    } else {
        showNotification('Mã phòng phải có 6 ký tự!');
    }
});

document.getElementById('backFromJoinButton').addEventListener('click', () => {
    document.getElementById('joinRoomScreen').style.display = 'none';
    document.getElementById('characterSelect').style.display = 'flex';
});

document.getElementById('startGameButton').addEventListener('click', () => {
    socket.emit('start-game');
});

document.getElementById('leaveRoomButton').addEventListener('click', () => {
    location.reload();
});

document.getElementById('backToLobbyButton').addEventListener('click', () => {
    location.reload();
});

// Socket events
socket.on('room-created', (data) => {
    currentRoomId = data.roomId;
    isHost = data.isHost;
    myPlayerId = socket.id;

    document.getElementById('characterSelect').style.display = 'none';
    document.getElementById('roomScreen').style.display = 'flex';
    document.getElementById('roomIdDisplay').textContent = currentRoomId;

    if (isHost) {
        document.getElementById('startGameButton').style.display = 'block';
    }
});

socket.on('room-joined', (data) => {
    currentRoomId = data.roomId;
    isHost = data.isHost;
    myPlayerId = socket.id;

    document.getElementById('joinRoomScreen').style.display = 'none';
    document.getElementById('roomScreen').style.display = 'flex';
    document.getElementById('roomIdDisplay').textContent = currentRoomId;

    if (isHost) {
        document.getElementById('startGameButton').style.display = 'block';
    }
});

socket.on('room-update', (data) => {
    const playersList = document.getElementById('playersList');
    playersList.innerHTML = '';

    data.players.forEach(player => {
        const item = document.createElement('div');
        item.className = 'player-item';
        if (player.id === data.hostId) {
            item.classList.add('host');
        }
        item.innerHTML = `
            <span>${player.name}</span>
            <span>${player.id === data.hostId ? '👑 Trưởng phòng' : ''}</span>
        `;
        playersList.appendChild(item);
    });
});

socket.on('rooms-list', (rooms) => {
    const roomsList = document.getElementById('roomsList');
    roomsList.innerHTML = '';

    if (rooms.length === 0) {
        roomsList.innerHTML = '<div class="loading">Không có phòng nào</div>';
        return;
    }

    rooms.forEach(room => {
        const item = document.createElement('div');
        item.className = 'room-item';
        item.innerHTML = `
            <span>Phòng: ${room.id}</span>
            <span>👥 ${room.playerCount}/8</span>
        `;
        item.addEventListener('click', () => {
            socket.emit('join-room', {
                roomId: room.id,
                playerName: playerName,
                characterType: selectedCharacter
            });
        });
        roomsList.appendChild(item);
    });
});

socket.on('join-error', (data) => {
    showNotification(data.message);
});

socket.on('start-error', (data) => {
    showNotification(data.message);
});

socket.on('game-started', () => {
    gameStarted = true;
    document.getElementById('roomScreen').style.display = 'none';
    document.getElementById('gameCanvas').style.display = 'block';
    document.getElementById('gameUI').style.display = 'block';

    startBackgroundMusic();
    resizeCanvas();
    setupControls();
    requestAnimationFrame(gameLoop);
});

socket.on('game-state', (state) => {
    updateGame(state);
});

socket.on('game-ended', (data) => {
    gameStarted = false;
    showGameEnd(data.rankings);
});

socket.on('skill-ready', () => {
    showNotification('Kỹ năng sẵn sàng!');
});

// Resize canvas
function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

window.addEventListener('resize', resizeCanvas);

// Setup controls
function setupControls() {
    const joystick = document.getElementById('joystick');
    const joystickStick = document.getElementById('joystickStick');
    const shootButton = document.getElementById('shootButton');
    const skillButton = document.getElementById('skillButton');

    joystick.addEventListener('touchstart', handleJoystickStart);
    joystick.addEventListener('touchmove', handleJoystickMove);
    joystick.addEventListener('touchend', handleJoystickEnd);

    shootButton.addEventListener('touchstart', (e) => {
        e.preventDefault();
        isShooting = true;
    });

    shootButton.addEventListener('touchend', (e) => {
        e.preventDefault();
        isShooting = false;
    });

    skillButton.addEventListener('click', () => {
        socket.emit('player-skill');
    });
}

function handleJoystickStart(e) {
    e.preventDefault();
    joystickActive = true;
}

function handleJoystickMove(e) {
    e.preventDefault();
    if (!joystickActive) return;

    const rect = e.currentTarget.getBoundingClientRect();
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

    document.getElementById('joystickStick').style.transform =
        `translate(calc(-50% + ${stickX}px), calc(-50% + ${stickY}px))`;
}

function handleJoystickEnd(e) {
    e.preventDefault();
    joystickActive = false;
    joystickDistance = 0;
    document.getElementById('joystickStick').style.transform = 'translate(-50%, -50%)';
}

// Game loop
let lastUpdateTime = Date.now();
let localPlayer = null;

function gameLoop() {
    if (!gameStarted) return;

    const now = Date.now();
    const deltaTime = now - lastUpdateTime;
    lastUpdateTime = now;

    updateLocalPlayer(deltaTime);
    render();

    requestAnimationFrame(gameLoop);
}

function updateLocalPlayer(dt) {
    if (!localPlayer) return;

    // Movement
    if (joystickActive) {
        const speed = localPlayer.stats.speed;
        localPlayer.vx = Math.cos(joystickAngle) * joystickDistance * speed;
        localPlayer.vy = Math.sin(joystickAngle) * joystickDistance * speed;

        if (localPlayer.vx < -0.5) {
            localPlayer.facingLeft = true;
        } else if (localPlayer.vx > 0.5) {
            localPlayer.facingLeft = false;
        }
    } else {
        localPlayer.vx *= 0.9;
        localPlayer.vy *= 0.9;
    }

    localPlayer.x += localPlayer.vx;
    localPlayer.y += localPlayer.vy;

    localPlayer.x = Math.max(50, Math.min(WORLD_WIDTH - 50, localPlayer.x));
    localPlayer.y = Math.max(50, Math.min(WORLD_HEIGHT - 50, localPlayer.y));

    // Send position to server
    socket.emit('player-move', {
        x: localPlayer.x,
        y: localPlayer.y,
        vx: localPlayer.vx,
        vy: localPlayer.vy,
        facingLeft: localPlayer.facingLeft
    });

    // Shooting
    if (isShooting && Date.now() - lastShootTime > localPlayer.stats.fireRate) {
        // Check if stunned
        const hasStunned = localPlayer.statusEffects.some(e => e.type === 'stunned');
        if (!hasStunned) {
            socket.emit('player-shoot', {});
            playShootSound(localPlayer.characterType);
            lastShootTime = Date.now();
        }
    }

    // Update particles
    particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 2;
    });
    particles = particles.filter(p => p.life > 0);
}

function updateGame(state) {
    // Find local player
    localPlayer = state.players.find(p => p.id === myPlayerId);

    if (!localPlayer) return;

    // Update camera
    camera.x = localPlayer.x - canvas.width / 2;
    camera.y = localPlayer.y - canvas.height / 2;
    camera.x = Math.max(0, Math.min(WORLD_WIDTH - canvas.width, camera.x));
    camera.y = Math.max(0, Math.min(WORLD_HEIGHT - canvas.height, camera.y));

    // Update UI
    updateUI(state);

    // Check items for pickup
    state.items.forEach(item => {
        const dx = localPlayer.x - item.x;
        const dy = localPlayer.y - item.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 40) {
            socket.emit('pickup-item', { itemId: item.id });
        }
    });
}

function updateUI(state) {
    if (!localPlayer) return;

    // Health bar
    const healthPercent = Math.max(0, Math.min(100, (localPlayer.health / localPlayer.maxHealth) * 100));
    document.getElementById('healthFill').style.width = healthPercent + '%';

    // Armor bar
    const armorBar = document.getElementById('armorBar');
    if (localPlayer.armor > 0) {
        armorBar.style.display = 'block';
        const armorPercent = Math.max(0, Math.min(100, (localPlayer.armor / localPlayer.maxArmor) * 100));
        document.getElementById('armorFill').style.width = armorPercent + '%';
    } else {
        armorBar.style.display = 'none';
    }

    // Timer
    if (state.timeRemaining !== null) {
        const minutes = Math.floor(state.timeRemaining / 60000);
        const seconds = Math.floor((state.timeRemaining % 60000) / 1000);
        document.getElementById('timerDisplay').textContent =
            `Thời gian: ${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    // Skill button
    const now = Date.now();
    const skillCooldownRemaining = Math.max(0, localPlayer.stats.skillCooldown - (now - localPlayer.lastSkillTime));
    const skillButton = document.getElementById('skillButton');

    if (skillCooldownRemaining > 0) {
        skillButton.disabled = true;
        const seconds = Math.ceil(skillCooldownRemaining / 1000);
        document.getElementById('skillCooldown').textContent = `${seconds}s`;
    } else {
        skillButton.disabled = false;
        document.getElementById('skillCooldown').textContent = 'Sẵn sàng';
    }

    // Leaderboard
    const sorted = [...state.players].sort((a, b) => {
        if (b.kills !== a.kills) return b.kills - a.kills;
        return a.deaths - b.deaths;
    });

    const leaderboardContent = document.getElementById('leaderboardContent');
    leaderboardContent.innerHTML = '';

    sorted.slice(0, 5).forEach((player, index) => {
        const item = document.createElement('div');
        item.className = 'leaderboard-item';
        if (player.id === myPlayerId) {
            item.classList.add('self');
        }
        item.innerHTML = `
            <span>#${index + 1} ${player.name}</span>
            <span>${player.kills} kills</span>
        `;
        leaderboardContent.appendChild(item);
    });
}

function render() {
    if (!gameStarted) return;

    // Clear
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw background
    const bgScale = 0.5;
    const bgX = -camera.x * bgScale;
    const bgY = -camera.y * bgScale;

    if (bgImg.complete) {
        const pattern = ctx.createPattern(bgImg, 'repeat');
        ctx.save();
        ctx.translate(bgX % bgImg.width, bgY % bgImg.height);
        ctx.fillStyle = pattern;
        ctx.fillRect(-bgImg.width, -bgImg.height,
                    canvas.width + bgImg.width * 2,
                    canvas.height + bgImg.height * 2);
        ctx.restore();
    }

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    // Draw particles
    particles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life / 100;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    });
    ctx.globalAlpha = 1;

    // Get game state from socket (we'll store it)
    if (window.lastGameState) {
        const state = window.lastGameState;

        // Draw items
        state.items.forEach(item => {
            let color, emoji;
            switch (item.type) {
                case 'health':
                    color = '#00ff00';
                    emoji = '+';
                    break;
                case 'armor':
                    color = '#4ecdc4';
                    emoji = '🛡';
                    break;
                case 'speed':
                    color = '#ffff00';
                    emoji = '⚡';
                    break;
            }

            ctx.fillStyle = color;
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(item.x, item.y, 15, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#fff';
            ctx.font = 'bold 20px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(emoji, item.x, item.y + 7);
        });

        // Draw players
        state.players.forEach(player => {
            if (loadedCharImages[player.characterType] && loadedCharImages[player.characterType].complete) {
                ctx.save();
                ctx.translate(player.x, player.y);
                if (player.facingLeft) {
                    ctx.scale(-1, 1);
                }
                const size = player.stats.size;
                ctx.drawImage(loadedCharImages[player.characterType], -size/2, -size/2, size, size);
                ctx.restore();
            }

            // Draw name and health bar
            ctx.fillStyle = '#fff';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 3;
            ctx.font = 'bold 14px Arial';
            ctx.textAlign = 'center';
            ctx.strokeText(player.name, player.x, player.y - player.stats.size/2 - 30);
            ctx.fillText(player.name, player.x, player.y - player.stats.size/2 - 30);

            // Health bar
            const barWidth = 50;
            const barHeight = 6;
            const healthPercent = player.health / player.maxHealth;

            ctx.fillStyle = '#333';
            ctx.fillRect(player.x - barWidth/2, player.y - player.stats.size/2 - 20, barWidth, barHeight);

            ctx.fillStyle = '#00ff00';
            ctx.fillRect(player.x - barWidth/2, player.y - player.stats.size/2 - 20, barWidth * healthPercent, barHeight);

            // Status effects
            if (player.statusEffects && player.statusEffects.length > 0) {
                let offsetY = -player.stats.size/2 - 50;
                player.statusEffects.forEach(effect => {
                    let emoji;
                    switch (effect.type) {
                        case 'poison': emoji = '☠️'; break;
                        case 'stunned': emoji = '⚡'; break;
                        case 'frozen': emoji = '❄️'; break;
                    }
                    if (emoji) {
                        ctx.font = 'bold 20px Arial';
                        ctx.fillText(emoji, player.x, player.y + offsetY);
                        offsetY -= 25;
                    }
                });
            }
        });

        // Draw bullets
        state.bullets.forEach(bullet => {
            const imgs = loadedBulletImages[bullet.charType];

            if (bullet.impacting && imgs && imgs.length > 1) {
                const impactIndex = Math.min(
                    1 + Math.floor(bullet.impactFrame / 5),
                    imgs.length - 1
                );
                const impactImg = imgs[impactIndex];

                if (impactImg && impactImg.complete) {
                    const size = 80;
                    ctx.save();
                    ctx.translate(bullet.x, bullet.y);
                    ctx.drawImage(impactImg, -size/2, -size/2, size, size);
                    ctx.restore();
                }
            } else if (!bullet.impacting && imgs && imgs[0]) {
                const bulletImg = imgs[0];
                if (bulletImg && bulletImg.complete) {
                    const size = 60;
                    ctx.save();
                    ctx.translate(bullet.x, bullet.y);
                    ctx.drawImage(bulletImg, -size/2, -size/2, size, size);
                    ctx.restore();
                }
            } else {
                ctx.fillStyle = '#ffff00';
                ctx.shadowColor = '#ffff00';
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.arc(bullet.x, bullet.y, 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.shadowBlur = 0;
            }

            // Show skill effect
            if (bullet.skillEffect && !bullet.impacting) {
                let emoji;
                switch (bullet.skillEffect) {
                    case 'poison': emoji = '☠️'; break;
                    case 'electric': emoji = '⚡'; break;
                    case 'ice': emoji = '❄️'; break;
                    case 'fire': emoji = '🔥'; break;
                }
                if (emoji) {
                    ctx.font = 'bold 16px Arial';
                    ctx.fillText(emoji, bullet.x, bullet.y - 20);
                }
            }
        });
    }

    ctx.restore();
}

// Store game state
socket.on('game-state', (state) => {
    window.lastGameState = state;
    updateGame(state);
});

function showGameEnd(rankings) {
    document.getElementById('gameEndScreen').style.display = 'flex';

    const rankingsDiv = document.getElementById('finalRankings');
    rankingsDiv.innerHTML = '';

    rankings.forEach((rank, index) => {
        const item = document.createElement('div');
        item.className = 'rank-item';
        if (index < 3) {
            item.classList.add('top3');
        }
        item.innerHTML = `
            <div>
                <div style="font-size: 24px; font-weight: bold;">#${rank.rank} ${rank.name}</div>
                <div style="font-size: 14px; color: #666;">Kills: ${rank.kills} | Deaths: ${rank.deaths}</div>
            </div>
            <div style="font-size: 36px;">
                ${index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : ''}
            </div>
        `;
        rankingsDiv.appendChild(item);
    });
}

function showNotification(message) {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.style.display = 'block';

    setTimeout(() => {
        notification.style.display = 'none';
    }, 3000);
}

function createParticles(x, y, color) {
    for (let i = 0; i < 15; i++) {
        particles.push({
            x: x,
            y: y,
            vx: (Math.random() - 0.5) * 8,
            vy: (Math.random() - 0.5) * 8,
            life: 100,
            color: color
        });
    }
}
