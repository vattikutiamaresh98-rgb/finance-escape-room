const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/host', (req, res) => {
 res.set('Cache-Control', 'no-store');
 res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

app.get('/play', (req, res) => {
 res.set('Cache-Control', 'no-store');
 res.sendFile(path.join(__dirname, 'public', 'play.html'));
});

const gameState = { teams: {}, started: false, startTime: null, puzzleCount: 6 };

const puzzleAnswers = {
 1: '42', 2: 'depreciation', 3: 'revenue',
 4: '375000', 5: 'accrual', 6: '2468'
};

const puzzleHints = {
 1: 'Look at the pattern in the variance column — what operation connects budget to actual?',
 2: 'Each letter is shifted by 3 positions in the alphabet (Caesar cipher). Start with G → D',
 3: 'It\'s the top line of any Income Statement — what comes in before expenses go out?',
 4: 'Calculate 25% of the total budget. Remember: 25% = multiply by 0.25',
 5: 'Rearrange the letters. It\'s an accounting method — the opposite of "cash basis"',
 6: 'Look at the sequence: each number increases by 2. What comes after 6?'
};

io.on('connection', (socket) => {
 socket.emit('teamsUpdate', getTeamsForHost());
 if (gameState.started) {
   socket.emit('gameStarted', { startTime: gameState.startTime });
 }

 socket.on('joinTeam', ({ teamName, playerName }) => {
   if (!gameState.teams[teamName]) {
     gameState.teams[teamName] = {
       name: teamName, players: [], currentPuzzle: 1,
       solvedPuzzles: [], hintsUsed: 0, finished: false, finishTime: null
     };
   }
   const team = gameState.teams[teamName];
   const existing = team.players.find(p => p.name === playerName);
   if (existing) {
     existing.id = socket.id;
   } else {
     team.players.push({ id: socket.id, name: playerName });
   }
   socket.join(teamName);
   socket.teamName = teamName;
   socket.playerName = playerName;
   socket.emit('gameState', { started: gameState.started, team: gameState.teams[teamName] });
   io.emit('teamsUpdate', getTeamsForHost());
 });

 socket.on('startGame', () => {
   gameState.started = true;
   gameState.startTime = Date.now();
   Object.values(gameState.teams).forEach(team => {
     team.currentPuzzle = 1; team.solvedPuzzles = [];
     team.hintsUsed = 0; team.finished = false; team.finishTime = null;
   });
   io.emit('gameStarted', { startTime: gameState.startTime });
   io.emit('teamsUpdate', getTeamsForHost());
 });

 socket.on('submitAnswer', ({ puzzleNumber, answer }) => {
   const teamName = socket.teamName;
   if (!teamName || !gameState.teams[teamName]) return;
   const team = gameState.teams[teamName];
   if (team.finished) return;
   const isCorrect = answer.toString().toLowerCase().trim() === puzzleAnswers[puzzleNumber].toLowerCase();
   if (isCorrect) {
     team.solvedPuzzles.push(puzzleNumber);
     if (team.solvedPuzzles.length >= gameState.puzzleCount) {
       team.finished = true;
       team.finishTime = Date.now() - gameState.startTime;
       team.currentPuzzle = 'DONE';
       io.to(teamName).emit('puzzleResult', { correct: true, puzzleNumber, finished: true, finishTime: team.finishTime });
       if (Object.values(gameState.teams).filter(t => t.finished).length === 1) {
         io.emit('firstFinisher', { teamName: team.name, time: team.finishTime });
       }
     } else {
       team.currentPuzzle = puzzleNumber + 1;
       io.to(teamName).emit('puzzleResult', { correct: true, puzzleNumber, nextPuzzle: team.currentPuzzle, finished: false });
     }
   } else {
     io.to(teamName).emit('puzzleResult', { correct: false, puzzleNumber });
   }
   io.emit('teamsUpdate', getTeamsForHost());
 });

 socket.on('requestHint', ({ puzzleNumber }) => {
   const teamName = socket.teamName;
   if (!teamName || !gameState.teams[teamName]) return;
   gameState.teams[teamName].hintsUsed++;
   io.to(teamName).emit('hintReceived', { puzzleNumber, hint: puzzleHints[puzzleNumber] || 'No hint available' });
   io.emit('teamsUpdate', getTeamsForHost());
 });

 socket.on('resetGame', () => {
   gameState.started = false; gameState.startTime = null;
   Object.keys(gameState.teams).forEach(key => delete gameState.teams[key]);
   io.emit('gameReset');
 });

 socket.on('disconnect', () => {
   io.emit('teamsUpdate', getTeamsForHost());
 });
});

function getTeamsForHost() {
 return Object.values(gameState.teams).map(team => ({
   name: team.name, playerCount: team.players.length,
   players: team.players.map(p => p.name), currentPuzzle: team.currentPuzzle,
   solvedCount: team.solvedPuzzles.length, totalPuzzles: gameState.puzzleCount,
   hintsUsed: team.hintsUsed, finished: team.finished, finishTime: team.finishTime
 })).sort((a, b) => {
   if (a.finished && b.finished) return a.finishTime - b.finishTime;
   if (a.finished) return -1; if (b.finished) return 1;
   return b.solvedCount - a.solvedCount;
 });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
