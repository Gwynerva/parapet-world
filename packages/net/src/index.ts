/**
 * @parapet-world/net: the client side of the netcode as pure state machines (no DOM, no sockets,
 * no timers): the step clock, own-runner prediction with resyncs, remote runner buffers and the
 * NetClient the game drives. See README.md.
 */
export { StepClock, STEP_MS, SLACK_LOW, SLACK_HIGH, RESYNC_BEHIND } from './clock.ts';
export { RemoteRunner, REMOTE_DELAY, type RemoteFrame } from './remote.ts';
export { NetClient, type NetClientOptions, type NetPhase, type Transport } from './client.ts';
