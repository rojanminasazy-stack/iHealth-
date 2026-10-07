import {
  ConsoleLogger,
  DefaultDeviceController,
  DefaultMeetingSession,
  LogLevel,
  MeetingSessionConfiguration,
  MeetingSessionStatusCode,
  type AudioVideoObserver,
  type MeetingSessionStatus,
  type VideoTileState,
} from "amazon-chime-sdk-js";

/**
 * Video visit page. Loaded inside the iHealthé apps' WebView.
 * The app gets the meeting + attendee from the iHealthé API and injects them as window.__IHEALTHE_JOIN__
 * before this script runs. Nothing about the visit is in the URL, so nothing leaks to logs or history.
 * The page talks back to the app with postMessage: "joined", "left", "ended", "error:<message>".
 */
type Join = { meeting: unknown; attendee: unknown };
declare global {
  interface Window {
    __IHEALTHE_JOIN__?: Join;
    ReactNativeWebView?: { postMessage: (m: string) => void };
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $<HTMLParagraphElement>("status");
const tell = (m: string) => window.ReactNativeWebView?.postMessage(m);
const show = (m: string | null) => {
  statusEl.textContent = m ?? "";
  statusEl.hidden = !m;
};

async function waitForJoin(): Promise<Join> {
  for (let i = 0; i < 100; i++) {
    if (window.__IHEALTHE_JOIN__) return window.__IHEALTHE_JOIN__;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Visit details didn't load. Go back and tap Join again.");
}

async function main() {
  const join = await waitForJoin();
  delete window.__IHEALTHE_JOIN__;
  const logger = new ConsoleLogger("ihealthe", LogLevel.WARN);
  const devices = new DefaultDeviceController(logger);
  const session = new DefaultMeetingSession(new MeetingSessionConfiguration(join.meeting, join.attendee), logger, devices);
  const av = session.audioVideo;

  const mics = await av.listAudioInputDevices();
  if (!mics[0]) throw new Error("No microphone found. Allow microphone access for iHealthé in Settings.");
  await av.startAudioInput(mics[0].deviceId);

  let cams = await av.listVideoInputDevices();
  let camIndex = Math.max(0, cams.findIndex((c: MediaDeviceInfo) => /front|user|facetime/i.test(c.label)));
  if (cams[camIndex]) await av.startVideoInput(cams[camIndex].deviceId);

  await av.bindAudioElement($<HTMLAudioElement>("audio"));

  let remoteSeen = false;
  const observer: AudioVideoObserver = {
    videoTileDidUpdate: (t: VideoTileState) => {
      if (!t.boundAttendeeId || t.tileId == null) return;
      if (t.localTile) av.bindVideoElement(t.tileId, $<HTMLVideoElement>("local"));
      else if (!t.isContent) {
        av.bindVideoElement(t.tileId, $<HTMLVideoElement>("remote"));
        remoteSeen = true;
        show(null);
      }
    },
    videoTileWasRemoved: () => {
      if (remoteSeen) show("The other person turned off their camera or left.");
    },
    audioVideoDidStart: () => {
      show("Waiting for the other person to join…");
      tell("joined");
    },
    audioVideoDidStop: (s: MeetingSessionStatus) => {
      const code = s.statusCode();
      if (code === MeetingSessionStatusCode.MeetingEnded) {
        show("This visit has ended.");
        tell("ended");
      } else if (code === MeetingSessionStatusCode.Left) {
        tell("left");
      } else {
        show("Connection lost. Go back and tap Join to reconnect.");
        tell("error:connection");
      }
    },
  };
  av.addObserver(observer);
  av.start();
  av.startLocalVideoTile();

  const mute = $<HTMLButtonElement>("mute");
  mute.onclick = () => {
    const on = mute.getAttribute("aria-pressed") !== "true";
    if (on) av.realtimeMuteLocalAudio();
    else av.realtimeUnmuteLocalAudio();
    mute.setAttribute("aria-pressed", String(on));
    mute.textContent = on ? "Unmute" : "Mute";
  };
  const cam = $<HTMLButtonElement>("camera");
  cam.onclick = () => {
    const off = cam.getAttribute("aria-pressed") !== "true";
    if (off) av.stopLocalVideoTile();
    else av.startLocalVideoTile();
    cam.setAttribute("aria-pressed", String(off));
    cam.textContent = off ? "Camera on" : "Camera off";
  };
  $<HTMLButtonElement>("flip").onclick = async () => {
    cams = await av.listVideoInputDevices();
    if (cams.length < 2) return;
    camIndex = (camIndex + 1) % cams.length;
    await av.startVideoInput(cams[camIndex]!.deviceId);
  };
  $<HTMLButtonElement>("leave").onclick = async () => {
    av.stopLocalVideoTile();
    await av.stopVideoInput();
    await av.stopAudioInput();
    av.stop();
    tell("left");
  };
}

main().catch((e: Error) => {
  show(e.message || "Something went wrong starting the video.");
  tell(`error:${e.message}`);
});
