const socket = io('http://$HOST:$PORT');
const stat = { session: -1, version: -1 };

socket.on('init', (session, version) => {
    console.log('Connected to HR Server');
    stat.session = session;
    stat.version = version;
    console.log(`HR#${stat.session}.${stat.version}`);
});

socket.on('reload', () => window.location.reload());

setInterval(() => {
    socket.emit('polling', stat.session, stat.version);
}, 5000);
