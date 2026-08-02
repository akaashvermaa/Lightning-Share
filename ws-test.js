const http = require('http');
const { WebSocketServer } = require('ws');
const { parse } = require('url');

const server = http.createServer((req, res) => res.end('ok'));

const wss1 = new WebSocketServer({ noServer: true });
wss1.on('connection', (ws) => {
  console.log('wss1 connected');
  ws.on('close', () => console.log('wss1 closed'));
});

const wss2 = new WebSocketServer({ noServer: true });
wss2.on('connection', (ws) => {
  console.log('wss2 connected');
  ws.on('close', () => console.log('wss2 closed'));
});

server.on('upgrade', (request, socket, head) => {
  const { pathname } = parse(request.url);

  if (pathname === '/ws1') {
    wss1.handleUpgrade(request, socket, head, (ws) => {
      wss1.emit('connection', ws, request);
    });
  } else if (pathname === '/ws2') {
    wss2.handleUpgrade(request, socket, head, (ws) => {
      wss2.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

server.listen(3001, () => {
  console.log('Server started on 3001');
  const WebSocket = require('ws');
  const ws = new WebSocket('ws://localhost:3001/ws1');
  ws.on('open', () => {
    console.log('client connected to /ws1');
    setTimeout(() => {
      console.log('Test successful');
      process.exit(0);
    }, 1000);
  });
  ws.on('close', () => {
    console.log('client closed');
    process.exit(1);
  });
});
