/**
 * The client's step clock. The server runs a global step counter at 30 steps per second; a
 * runner's step k is due on the server at global step `origin + k`. The client estimates the
 * server's current global step from Tick messages and the round-trip time, and runs its own runner
 * `lead` steps ahead of it, so each input arrives just before the server needs it:
 * `lead = ceil(halfRtt / 33) + 1`, then nudged by one step at most once a second to keep the slack
 * the server reports between 1 and 3 steps.
 */
export const STEP_MS = 1000 / 30;
export const SLACK_LOW = 1;
export const SLACK_HIGH = 3;
/** Further behind than this, the client asks for a resync instead of catching up. */
export const RESYNC_BEHIND = 60;

export class StepClock {
  /** Server global step minus local time in steps, smoothed. */
  private offset = 0;
  private synced = false;
  rtt = 100;
  lead = 3;
  private slackSum = 0;
  private slackCount = 0;
  private lastNudge = 0;

  /** A Tick or Welcome received at local time `now` (ms) saying the server was at `serverStep`. */
  sample(serverStep: number, now: number): void {
    const est = serverStep + this.rtt / 2 / STEP_MS - now / STEP_MS;
    if (!this.synced) {
      this.offset = est;
      this.synced = true;
      this.lead = Math.ceil(this.rtt / 2 / STEP_MS) + 1;
      this.lastNudge = now;
      return;
    }
    // Late packets only ever make the estimate smaller; follow increases quickly, decreases slowly.
    const k = est > this.offset ? 0.25 : 0.05;
    this.offset += (est - this.offset) * k;
  }

  /** A measured round trip in ms. */
  roundTrip(ms: number): void {
    this.rtt = this.rtt * 0.8 + ms * 0.2;
  }

  /** The server's slack report for the newest input, and the nudge it may cause. */
  slack(slack: number, now: number): void {
    this.slackSum += slack;
    this.slackCount++;
    if (now - this.lastNudge < 1000 || this.slackCount < 3) return;
    const avg = this.slackSum / this.slackCount;
    if (avg < SLACK_LOW) this.lead++;
    else if (avg > SLACK_HIGH && this.lead > 1) this.lead--;
    this.slackSum = 0;
    this.slackCount = 0;
    this.lastNudge = now;
  }

  get ready(): boolean {
    return this.synced;
  }

  /** The server's global step now, as a fraction. */
  serverNow(now: number): number {
    return this.offset + now / STEP_MS;
  }

  /** The own runner's target step (fractional): the server's step plus the lead, minus the origin. */
  target(now: number, origin: number): number {
    return this.serverNow(now) - origin + this.lead;
  }
}
