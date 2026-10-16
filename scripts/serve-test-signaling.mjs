import { PeerServer } from 'peer';
PeerServer({ host: '127.0.0.1', port: 4174, path: '/', allow_discovery: false });
console.log('Test-only PeerServer: http://127.0.0.1:4174/');
