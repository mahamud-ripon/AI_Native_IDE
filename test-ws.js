const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8000/api/v1/ai?userId=test&projectId=test');

ws.on('open', () => {
    console.log('WebSocket Connected');
    setTimeout(() => {
    	ws.close();
    }, 5000);
});

ws.on('message', (data) => {
    console.log('Message:', data.toString());
});

ws.on('error', (err) => {
    console.error('Error:', err);
});

ws.on('close', (code, reason) => {
    console.log('Closed:', code, reason.toString());
});
