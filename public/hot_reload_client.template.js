// Copyright 2024 Brad Soellner
// SPDX-License-Identifier: Apache-2.0

/* eslint-disable no-undef */
const socket = io(location.origin);
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
