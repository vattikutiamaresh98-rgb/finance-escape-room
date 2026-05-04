
Purpose: Print server.js

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/host', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

app.get('/play', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'public', 'play.html'));
});

// Game state
const gameState = {
  teams: {},
  started: false,
  startTime: null,
  puzzleCount: 9
};

// Puzzle answers (all lowercase for comparison)
const puzzleAnswers = {
  1: 'wbr',
  2: 'seller',
  3: 'variance',
  4: 'op',
  5: '135',
  6: 'customer obsession',
  7: 'kpi',
  8: 'customer obsession, are right a lot, think big, deliver results',
  9: 'wsv21ck14'
};

// Puzzle hints
const puzzleHints = {
  1: 'It happens every week. Leaders read it before they speak. Three letters.',
  2: 'A=1, B=2... decode each number to a letter. Who does SPS serve?',
  3: 'Budget vs Actual. It can be favorable or unfavorable.',
  4: 'It\'s not a holiday. Finance plans around it. It has two cycles: OP1 and OP2.',
  5: 'Step 1: remove 25% of 200. Step 2: remove 10% of what\'s left.',
  6: 'Unscramble the words first. Two of them form LP #1.',
  7: 'Think dashboards and status indicators. Three letters.',
  8: 'Customer Obsession is #1. Are Right, A Lot is #4. Think Big is #8. Deliver Results is #14.',
  9: 'Combine all fragments in order: W, S, V, 2, 1, C, K, 14'
};

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  // Send current state to any new connection (e.g. host refresh)
  socket.emit('teamsUpdate', getTeamsForHost());
  if (gameState.started) {
    socket.emit('gameStarted', { startTime: gameState.startTime });
  }

  // Team joins the game
  socket.on('joinTeam', ({ teamName, playerName }) => {
    if (!gameState.teams[teamName]) {
      gameState.teams[teamName] = {
        name: teamName,
        players: [],
        currentPuzzle: 1,
        solvedPuzzles: [],
        hintsUsed: 0,
        finished: false,
        finishTime: null
      };
    }
    
    gameState.teams[teamName].players.push({
      id: socket.id,
      name: playerName
    });
    
    socket.join(teamName);
    socket.teamName = teamName;
    socket.playerName = playerName;

    // Send current game state to the player
    socket.emit('gameState', {
      started: gameState.started,
      team: gameState.teams[teamName]
    });

    // Update host with all teams
    io.emit('teamsUpdate', getTeamsForHost());
    
    console.log(`${playerName} joined team ${teamName}`);
  });

  // Host starts the game
  socket.on('startGame', () => {
    gameState.started = true;
    gameState.startTime = Date.now();
    
    // Reset all teams
    Object.values(gameState.teams).forEach(team => {
      team.currentPuzzle = 1;
      team.solvedPuzzles = [];
      team.hintsUsed = 0;
      team.finished = false;
      team.finishTime = null;
    });

    io.emit('gameStarted', { startTime: gameState.startTime });
    io.emit('teamsUpdate', getTeamsForHost());
    console.log('Game started!');
  });

  // Team submits an answer
  socket.on('submitAnswer', ({ puzzleNumber, answer }) => {
    const teamName = socket.teamName;
    if (!teamName || !gameState.teams[teamName]) return;
    
    const team = gameState.teams[teamName];
    if (team.finished) return;
    
    const correctAnswer = puzzleAnswers[puzzleNumber];
    const normalize = s => s.toString().toLowerCase().trim().replace(/\s*,\s*/g, ',').replace(/\s+/g, ' ');
    // For clue 8, also accept "are right, a lot" with the comma
    let isCorrect = normalize(answer) === normalize(correctAnswer);
    if (!isCorrect && puzzleNumber === 8) {
      isCorrect = normalize(answer.replace(/are right,\s*a lot/i, 'are right a lot')) === normalize(correctAnswer);
    }

    if (isCorrect) {
      team.solvedPuzzles.push(puzzleNumber);
      
      if (team.solvedPuzzles.length >= gameState.puzzleCount) {
        team.finished = true;
        team.finishTime = Date.now() - gameState.startTime;
        team.currentPuzzle = 'DONE';
        
        // Notify the team they won
        io.to(teamName).emit('puzzleResult', { 
          correct: true, 
          puzzleNumber,
          finished: true,
          finishTime: team.finishTime
        });
        
        // Check if this is the first team to finish
        const finishedTeams = Object.values(gameState.teams).filter(t => t.finished);
        if (finishedTeams.length === 1) {
          io.emit('firstFinisher', { teamName: team.name, time: team.finishTime });
        }
      } else {
        team.currentPuzzle = puzzleNumber + 1;
        io.to(teamName).emit('puzzleResult', { 
          correct: true, 
          puzzleNumber,
          nextPuzzle: team.currentPuzzle,
          finished: false
        });
      }
    } else {
      io.to(teamName).emit('puzzleResult', { 
        correct: false, 
        puzzleNumber 
      });
    }

    io.emit('teamsUpdate', getTeamsForHost());
  });

  // Team requests a hint
  socket.on('requestHint', ({ puzzleNumber }) => {
    const teamName = socket.teamName;
    if (!teamName || !gameState.teams[teamName]) return;
    
    gameState.teams[teamName].hintsUsed++;
    const hint = puzzleHints[puzzleNumber] || 'No hint available';
    
    io.to(teamName).emit('hintReceived', { puzzleNumber, hint });
    io.emit('teamsUpdate', getTeamsForHost());
  });

  // Reset game
  socket.on('resetGame', () => {
    gameState.started = false;
    gameState.startTime = null;
    Object.keys(gameState.teams).forEach(key => delete gameState.teams[key]);
    io.emit('gameReset');
    console.log('Game reset!');
  });

  socket.on('disconnect', () => {
    if (socket.teamName && gameState.teams[socket.teamName]) {
      const team = gameState.teams[socket.teamName];
      team.players = team.players.filter(p => p.id !== socket.id);
      if (team.players.length === 0) {
        delete gameState.teams[socket.teamName];
      }
      io.emit('teamsUpdate', getTeamsForHost());
    }
  });
});

function getTeamsForHost() {
  return Object.values(gameState.teams).map(team => ({
    name: team.name,
    playerCount: team.players.length,
    players: team.players.map(p => p.name),
    currentPuzzle: team.currentPuzzle,
    solvedCount: team.solvedPuzzles.length,
    totalPuzzles: gameState.puzzleCount,
    hintsUsed: team.hintsUsed,
    finished: team.finished,
    finishTime: team.finishTime
  })).sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.solvedCount - a.solvedCount;
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
  🎮 ═══════════════════════════════════════════════════
  ║                                                     ║
  ║   💰 FINANCE ESCAPE ROOM — SPS FP&A EDITION 💰    ║
  ║                                                     ║
  ║   🖥️  Host Screen:   http://localhost:${PORT}/host   ║
  ║   📱 Player Screen:  http://localhost:${PORT}/play   ║
  ║                                                     ║
  ═══════════════════════════════════════════════════════

  Share the Player link with everyone to join!
  Open the Host link on the big screen!
  `);
});
