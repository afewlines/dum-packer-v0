const socket = io("http://$HOST:$PORT");
const stat = { session: -1, version: -1 };
const log_state = () => console.log(`HR#${stat.session}.${stat.version}`);

socket.on("init", (session, version) => {
    console.log('Connected to HR Server');
    stat.session = session;
    stat.version = version;
    log_state();
});

socket.on("reload", () => window.location.reload());

setInterval(() => {
    socket.emit('polling', stat.session, stat.version);
}, 5000);
